#!/usr/bin/env node
/**
 * 관리자 계정 관리 (D1). 기존 scripts/create-admin.js·ADMIN_BOOTSTRAP_PASSWORD 자동 생성을 대신한다.
 *
 *   새 관리자 만들기:   npm run admin -- create  --remote   (로컬 D1은 --local)
 *   기존 회원 승격:     npm run admin -- promote <아이디> --remote
 *
 * 아이디·닉네임·비밀번호는 터미널에서 물어본다(비밀번호는 화면에 표시하지 않음).
 * 비밀번호 해시와 아이디·닉네임 암호화는 이 컴퓨터에서 하고 결과만 D1에 저장한다.
 * 그래서 Worker와 같은 USER_PII_ENCRYPTION_KEY가 필요하다:
 *   --local: .dev.vars의 값을 읽는다.  --remote: 환경 변수에 없으면 물어본다.
 * 자동화용으로 ADMIN_USERNAME / ADMIN_NICKNAME / ADMIN_PASSWORD / USER_PII_ENCRYPTION_KEY 환경 변수도 받는다.
 * Worker 코드(src/lib/*.ts)를 Node의 TypeScript 실행 기능으로 그대로 불러 쓰므로 Node 24 이상이 필요하다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import {
  isValidNicknameChars,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN
} from '../src/lib/accountRules.ts';
import { hashPassword } from '../src/lib/password.ts';
import { getPiiCrypto, normalizeUsername } from '../src/lib/pii.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_NAME = 'priconne-db';
// npx/셸을 거치지 않고 wrangler를 Node로 직접 실행한다 (Windows에서 인자 이스케이프 문제 방지).
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const ADMIN_PROFILE_IMAGE = join(ROOT, 'scripts', 'admin-profile-source.png');
/** 프로필 이미지를 SQL에 나눠 넣는 크기: 80,000자 (D1의 SQL 문 하나 상한 100KB 안) */
const PROFILE_SQL_CHUNK_CHARS = 80_000;

/**
 * Windows의 Node 24에서 wrangler가 끝나는 순간 간헐적으로 죽을 때 나오는 libuv 오류 문구.
 * 이 오류는 SQL 실행 결과와 관계없이 날 수 있어, 실제로 반영됐는지 다시 확인한 뒤 판단한다.
 */
const WRANGLER_EXIT_CRASH_PATTERN = /Assertion failed|UV_HANDLE_CLOSING/;
/** wrangler가 Cloudflare에 로그인되어 있지 않을 때 나오는 문구 */
const WRANGLER_NOT_LOGGED_IN_PATTERN = /not authenticated|CLOUDFLARE_API_TOKEN|wrangler login|without logging in/i;

function exitWithUsage(message) {
  if (message) console.error(`\n오류: ${message}\n`);
  console.error('사용법:');
  console.error('  npm run admin -- create  --remote|--local');
  console.error('  npm run admin -- promote <아이디> --remote|--local');
  process.exit(1);
}

/** SQL 문자열 리터럴. wrangler d1 execute는 바인딩 인자를 받지 않으므로 직접 이스케이프한다. */
function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const readlineInterface = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // 질문 문구만 출력하고, 입력한 글자는 화면에 찍지 않는다.
      readlineInterface._writeToOutput = (text) => {
        if (text.includes(question)) readlineInterface.output.write(question);
      };
    }
    readlineInterface.question(question, (answer) => {
      readlineInterface.close();
      // 원시 모드가 남으면 뒤에 실행하는 wrangler가 콘솔을 다루다 죽을 수 있어 원래 모드로 돌려놓는다.
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** .dev.vars(KEY=VALUE 줄)에서 값 하나를 읽는다. 없으면 빈 문자열 */
function readDevVar(name) {
  const file = join(ROOT, '.dev.vars');
  if (!existsSync(file)) return '';
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === name) return match[2].replace(/^"(.*)"$/, '$1');
  }
  return '';
}

async function resolvePiiKey(target) {
  const fromEnv = String(process.env.USER_PII_ENCRYPTION_KEY || '').trim();
  if (fromEnv) return fromEnv;
  if (target === '--local') {
    const fromDevVars = readDevVar('USER_PII_ENCRYPTION_KEY').trim();
    if (fromDevVars) return fromDevVars;
    exitWithUsage('.dev.vars에 USER_PII_ENCRYPTION_KEY가 없습니다. .dev.vars.example을 복사해 만드세요.');
  }
  const typed = (await ask('USER_PII_ENCRYPTION_KEY (wrangler secret으로 넣은 값과 같게): ', { hidden: true })).trim();
  if (!typed) exitWithUsage('USER_PII_ENCRYPTION_KEY가 필요합니다.');
  return typed;
}

function describeWranglerFailure(output, status) {
  if (WRANGLER_NOT_LOGGED_IN_PATTERN.test(output)) {
    return '이 터미널에서 wrangler가 Cloudflare에 로그인되어 있지 않습니다. `npx.cmd wrangler login`으로 로그인한 뒤 다시 실행하세요.';
  }
  const lines = output.split('\n').map((line) => line.trim()).filter((line) => line && !WRANGLER_EXIT_CRASH_PATTERN.test(line));
  return lines.find((line) => /constraint|error/i.test(line)) || lines.pop() || `wrangler 종료 코드 ${status}`;
}

function buildWranglerError(output, status) {
  const error = new Error(describeWranglerFailure(output, status));
  error.isExitCrash = WRANGLER_EXIT_CRASH_PATTERN.test(output) && !WRANGLER_NOT_LOGGED_IN_PATTERN.test(output);
  return error;
}

function runWrangler(extraArgs, sqlArgs) {
  return spawnSync(process.execPath, [WRANGLER, 'd1', 'execute', DB_NAME, ...extraArgs, ...sqlArgs, '--yes'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, CI: '1' }
  });
}

/** 쓰기는 --file로 보낸다 (프로필 이미지 data URL이 Windows 명령줄 길이 상한을 넘기 때문) */
function runSql(target, sql) {
  const tempDir = mkdtempSync(join(tmpdir(), 'priconne-admin-'));
  const file = join(tempDir, 'admin.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    const result = runWrangler([target, ...PERSIST], ['--file', file]);
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status !== 0) throw buildWranglerError(out, result.status);
    return out;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * 조회 결과 행을 돌려준다. 조회는 --file이 아니라 --command로 보낸다:
 * 원격 D1은 --file을 가져오기(import)로 실행해 실제 행 대신 실행 요약 한 줄만 돌려준다.
 */
function query(target, sql) {
  const result = runWrangler([target, ...PERSIST, '--json'], ['--command', sql]);
  const stdout = result.stdout || '';
  const hasResult = stdout.includes('[') && stdout.trimEnd().endsWith(']');
  const isExitCrash = WRANGLER_EXIT_CRASH_PATTERN.test(`${stdout}${result.stderr || ''}`);
  if (result.status !== 0 && !(isExitCrash && hasResult)) {
    throw buildWranglerError(`${stdout}${result.stderr || ''}`, result.status);
  }
  const json = JSON.parse(stdout.slice(stdout.indexOf('[')));
  const rows = json[0]?.results ?? [];
  if (rows.some((row) => 'Total queries executed' in row)) {
    throw new Error('조회 결과 대신 실행 요약이 돌아왔습니다. wrangler 버전을 확인하세요.');
  }
  return rows;
}

/** 실행 직후 wrangler가 죽었으면 실제 반영 여부를 확인하고, 반영되지 않았을 때만 한 번 더 시도한다. */
function runSqlConfirmed(target, sql, isApplied) {
  try {
    runSql(target, sql);
  } catch (err) {
    if (!err.isExitCrash) throw err;
    if (isApplied()) return;
    console.error('wrangler가 비정상 종료해 한 번 더 시도합니다...');
    runSql(target, sql);
  }
  if (!isApplied()) throw new Error('저장 후 확인에서 계정을 찾지 못했습니다. 다시 실행해 주세요.');
}

function isAdminByBlind(target, usernameBlind) {
  const rows = query(target, `SELECT role FROM users WHERE username_blind = ${quoteSqlString(usernameBlind)}`);
  return rows.length > 0 && rows[0].role === 'admin';
}

function buildProfileImageDataUrl() {
  if (!existsSync(ADMIN_PROFILE_IMAGE)) return null;
  return `data:image/png;base64,${readFileSync(ADMIN_PROFILE_IMAGE).toString('base64')}`;
}

async function create(target) {
  const username = (process.env.ADMIN_USERNAME ?? (await ask('관리자 아이디 (영문 8~20자): '))).trim();
  if (!USERNAME_PATTERN.test(username)) exitWithUsage('아이디는 영문만 사용하고 8~20자여야 합니다.');

  const nickname = (process.env.ADMIN_NICKNAME ?? (await ask(`닉네임 (${NICKNAME_MIN}~${NICKNAME_MAX}자): `))).trim();
  const nicknameLength = Array.from(nickname).length;
  if (nicknameLength < NICKNAME_MIN || nicknameLength > NICKNAME_MAX) {
    exitWithUsage(`닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자여야 합니다.`);
  }
  if (!isValidNicknameChars(nickname)) exitWithUsage('닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.');

  let password = process.env.ADMIN_PASSWORD;
  if (password == null) {
    password = await ask(`비밀번호 (${PASSWORD_MIN}~${PASSWORD_MAX}자): `, { hidden: true });
    const again = await ask('비밀번호 확인: ', { hidden: true });
    if (password !== again) exitWithUsage('비밀번호가 일치하지 않습니다.');
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    exitWithUsage(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자여야 합니다.`);
  }

  const pii = await getPiiCrypto(await resolvePiiKey(target));
  const usernameBlind = await pii.usernameBlindIndex(username);
  const nicknameBlind = await pii.nicknameBlindIndex(nickname);
  const taken = query(
    target,
    `SELECT username_blind FROM users WHERE username_blind = ${quoteSqlString(usernameBlind)} OR nickname_blind = ${quoteSqlString(nicknameBlind)}`
  );
  if (taken.some((row) => row.username_blind === usernameBlind)) exitWithUsage(`아이디 "${username}"는 이미 있습니다. promote를 쓰세요.`);
  if (taken.length) exitWithUsage(`닉네임 "${nickname}"은 이미 사용 중입니다.`);

  const userId = crypto.randomUUID();
  const values = [
    userId,
    usernameBlind,
    nicknameBlind,
    await pii.encrypt(normalizeUsername(username)),
    await pii.encrypt(nickname),
    await hashPassword(password)
  ].map(quoteSqlString);
  // 프로필 이미지는 같은 파일 안에서 조각씩 이어 붙인다. 한 SQL 문은 100KB를 넘을 수 없다(D1 상한).
  const profileImage = buildProfileImageDataUrl();
  const profileStatements = [];
  for (let i = 0; profileImage && i < profileImage.length; i += PROFILE_SQL_CHUNK_CHARS) {
    const chunk = quoteSqlString(profileImage.slice(i, i + PROFILE_SQL_CHUNK_CHARS));
    profileStatements.push(`UPDATE users SET profile_image = COALESCE(profile_image, '') || ${chunk} WHERE id = ${quoteSqlString(userId)};`);
  }
  runSqlConfirmed(
    target,
    [
      `INSERT INTO users (id, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, profile_image, role)
       VALUES (${values.join(', ')}, NULL, 'admin');`,
      ...profileStatements
    ].join('\n'),
    () => isAdminByBlind(target, usernameBlind)
  );
  console.log(`관리자 "${normalizeUsername(username)}"를 만들었습니다 (${target === '--remote' ? '원격' : '로컬'} D1).`);
}

async function promote(target, username) {
  if (!username || !USERNAME_PATTERN.test(username)) exitWithUsage('승격할 아이디를 정확히 입력하세요.');
  const pii = await getPiiCrypto(await resolvePiiKey(target));
  const usernameBlind = await pii.usernameBlindIndex(username);
  const rows = query(target, `SELECT role FROM users WHERE username_blind = ${quoteSqlString(usernameBlind)}`);
  if (!rows.length) exitWithUsage(`아이디 "${username}"인 회원이 없습니다.`);
  if (rows[0].role === 'admin') {
    console.log(`"${username}"는 이미 관리자입니다.`);
    return;
  }
  runSqlConfirmed(target, `UPDATE users SET role = 'admin' WHERE username_blind = ${quoteSqlString(usernameBlind)};`, () =>
    isAdminByBlind(target, usernameBlind)
  );
  console.log(`"${username}"를 관리자로 바꿨습니다 (${target === '--remote' ? '원격' : '로컬'} D1).`);
}

const args = process.argv.slice(2);
// 테스트용: --persist-to=<폴더> 로 다른 로컬 D1 상태를 쓴다 (--local과 함께)
const persistArg = args.find((a) => a.startsWith('--persist-to='));
const PERSIST = persistArg ? ['--persist-to', persistArg.slice('--persist-to='.length)] : [];
const target = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null;
if (!target) exitWithUsage('--remote(배포된 D1) 또는 --local(로컬 D1)을 지정하세요.');
const positional = args.filter((a) => !a.startsWith('--'));
const command = positional[0];

try {
  if (command === 'create') await create(target);
  else if (command === 'promote') await promote(target, positional[1]);
  else exitWithUsage();
} catch (err) {
  console.error(`실패: ${err.message}`);
  process.exit(1);
}
