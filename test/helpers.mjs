/**
 * 통합 테스트 공용.
 * 임시 폴더에 새 로컬 D1 상태를 만들고 `wrangler dev`를 띄운 뒤, 쿠키를 유지하는 JSON 클라이언트로 요청한다.
 * (기존 tests/e2e/run-all.mjs의 PostgreSQL + node server.js 구성을 대신한다)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DB_NAME = 'priconne-db';

export const ADMIN = { username: 'testadminuser', nickname: '관리자', password: 'adminpass123' };
export const SECRETS = {
  SESSION_SECRET: 'ci-session-secret-0123456789abcdef',
  USER_PII_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
};

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }
  });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(' ')} 실패\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

/** 로컬 D1에 SQL 실행 (테스트 사전 조건 조작용) → 마지막 문장의 결과 행 */
export function runD1Sql(persistDir, sql) {
  const dir = mkdtempSync(join(tmpdir(), 'priconne-sql-'));
  const file = join(dir, 'q.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    const out = runWrangler(['d1', 'execute', DB_NAME, '--local', '--persist-to', persistDir, '--json', '--file', file]);
    const json = JSON.parse(out.slice(out.indexOf('[')));
    return json[json.length - 1]?.results ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * 답을 아는 보안 문자 문제를 D1에 직접 넣는다. 서버는 문제 id와 정답을 해시로만 저장하므로
 * 같은 해시(src/lib/signupCaptcha.ts)를 만들어 넣으면 운영 코드에 우회 경로 없이 가입 흐름을 시험할 수 있다.
 * @returns {{ id: string, answer: string }[]}
 */
export function seedCaptchaChallenges(persistDir, count) {
  const challenges = Array.from({ length: count }, (_, i) => ({ id: `${'c'.repeat(28)}${String(i).padStart(4, '0')}`, answer: 'TEST2' }));
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const values = challenges
    .map((ch) => `('${sha256Hex(ch.id)}', 'challenge', '${sha256Hex(`${ch.id}:${ch.answer}`)}', ${expiresAt})`)
    .join(',\n');
  runD1Sql(persistDir, `INSERT INTO signup_tokens (token_hash, kind, answer_hash, expires_at) VALUES ${values};`);
  return challenges;
}

function killTree(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  });
}

/**
 * 새 상태로 마이그레이션 → 관리자 생성 → wrangler dev 기동.
 * @param {{ vars?: Record<string, string>, timeoutMs?: number }} options vars: 추가·덮어쓸 환경 값
 */
export async function startServer({ vars = {}, timeoutMs = 90000 } = {}) {
  const persistDir = mkdtempSync(join(tmpdir(), 'priconne-cf-test-'));
  runWrangler(['d1', 'migrations', 'apply', DB_NAME, '--local', '--persist-to', persistDir]);
  const adminResult = spawnSync(process.execPath, [join(ROOT, 'scripts', 'admin.mjs'), 'create', '--local', `--persist-to=${persistDir}`], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ADMIN_USERNAME: ADMIN.username,
      ADMIN_NICKNAME: ADMIN.nickname,
      ADMIN_PASSWORD: ADMIN.password,
      USER_PII_ENCRYPTION_KEY: SECRETS.USER_PII_ENCRYPTION_KEY
    }
  });
  if (adminResult.status !== 0) throw new Error(`관리자 생성 실패\n${adminResult.stdout}\n${adminResult.stderr}`);

  const allVars = { ...SECRETS, ENVIRONMENT: 'development', ...vars };
  const varArgs = Object.entries(allVars).flatMap(([name, value]) => ['--var', `${name}:${value}`]);
  const port = await pickFreePort();
  const child = spawn(
    process.execPath,
    [WRANGLER, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir, ...varArgs, '--test-scheduled'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } }
  );
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;

  const started = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`wrangler dev 종료됨\n${logs}`);
    if (Date.now() - started > timeoutMs) {
      await killTree(child);
      throw new Error(`wrangler dev 기동 시간 초과\n${logs}`);
    }
    try {
      const res = await fetch(`${base}/api/config`);
      if (res.ok) break;
    } catch {
      // 아직 준비 안 됨: 잠시 뒤 다시 확인
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    base,
    persistDir,
    readLogs: () => logs,
    stop: async () => {
      await killTree(child);
      // Windows는 프로세스를 끈 직후 파일 잠금이 잠시 남아 있어 기다렸다가 재시도한다.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        rmSync(persistDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (err) {
        console.warn(`[test] 임시 폴더를 지우지 못함: ${persistDir} (${err.code})`);
      }
    }
  };
}

let ipCounter = 0;

/**
 * 쿠키 유지 JSON 클라이언트. 클라이언트마다 다른 CF-Connecting-IP를 보내 시도 제한 카운터가 서로 섞이지 않게 한다.
 */
export class Client {
  constructor(base, { ip } = {}) {
    this.base = base;
    this.cookies = new Map();
    ipCounter += 1;
    this.ip = ip || `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  }

  storeCookies(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const equalsIndex = pair.indexOf('=');
      const name = pair.slice(0, equalsIndex).trim();
      const value = pair.slice(equalsIndex + 1).trim();
      if (/max-age=0\b/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, urlPath, { json, body, headers = {}, origin } = {}) {
    const allHeaders = { 'CF-Connecting-IP': this.ip, ...headers };
    if (this.cookies.size) allHeaders.Cookie = [...this.cookies].map(([n, v]) => `${n}=${v}`).join('; ');
    if (method !== 'GET' && method !== 'HEAD' && origin !== false && !('Origin' in allHeaders)) {
      allHeaders.Origin = origin || this.base;
    }
    let payload = body;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      allHeaders['Content-Type'] = 'application/json';
    }
    const res = await fetch(this.base + urlPath, { method, headers: allHeaders, body: payload, redirect: 'manual' });
    this.storeCookies(res);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // JSON이 아닌 응답(HTML 등)
    }
    return { status: res.status, headers: res.headers, text, data };
  }

  get(urlPath, options) {
    return this.request('GET', urlPath, options);
  }
  post(urlPath, json, options = {}) {
    return this.request('POST', urlPath, { ...options, json });
  }
  patch(urlPath, json, options = {}) {
    return this.request('PATCH', urlPath, { ...options, json });
  }
  put(urlPath, json, options = {}) {
    return this.request('PUT', urlPath, { ...options, json });
  }
  delete(urlPath, options) {
    return this.request('DELETE', urlPath, options);
  }

  async login(username = ADMIN.username, password = ADMIN.password) {
    const res = await this.post('/api/login', { username, password });
    if (res.status !== 200) throw new Error(`로그인 실패 ${username}: ${res.status} ${res.text.slice(0, 200)}`);
    return res.data.user;
  }

  /** 미리 넣어 둔 보안 문자 문제로 1단계를 통과하고 가입한다. */
  async register(challenge, fields) {
    const step = await this.post('/api/signup/verify-step1', { captchaId: challenge.id, captchaAnswer: challenge.answer.toLowerCase() });
    if (step.status !== 200) throw new Error(`1단계 실패: ${step.status} ${step.text}`);
    return this.post('/api/register', { stepPassToken: step.data.stepPassToken, password: 'password123', deferOwnedCharacters: true, ...fields });
  }
}
