/**
 * 브라우저 E2E 실행기 (기존 tests/e2e/run-all.mjs 대체).
 * wrangler dev(로컬 D1)를 띄우고 일반 회원을 가입시킨 뒤 test/browser/browser.mjs를 실행한다.
 * 브라우저: E2E_BROWSER_PATH, 없으면 Windows의 Edge·Chrome, 그것도 없으면 playwright-core가 설치한 chromium
 *   (CI: `npx playwright-core install --with-deps chromium`)
 * 사용: npm run test:browser
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, Client, ROOT, seedCaptchaChallenges, startServer } from '../helpers.mjs';

const USER = { username: 'testeruser', nickname: '테스터', password: 'password123' };
const WINDOWS_BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
];

function findBrowser() {
  if (process.env.E2E_BROWSER_PATH) return process.env.E2E_BROWSER_PATH;
  if (process.platform === 'win32') return WINDOWS_BROWSERS.find((path) => existsSync(path)) || '';
  return '';
}

function runNode(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const server = await startServer();
let exitCode = 1;
try {
  const [challenge] = seedCaptchaChallenges(server.persistDir, 1);
  const registered = await new Client(server.base).register(challenge, { ...USER, deferOwnedCharacters: true });
  if (registered.status !== 201) throw new Error(`테스트 회원 가입 실패: ${registered.status} ${registered.text}`);

  const browserPath = findBrowser();
  exitCode = await runNode(join(ROOT, 'test', 'browser', 'browser.mjs'), [server.base], {
    E2E_BROWSER_PATH: browserPath,
    E2E_USER_USERNAME: USER.username,
    E2E_USER_PASSWORD: USER.password,
    E2E_ADMIN_USERNAME: ADMIN.username,
    E2E_ADMIN_PASSWORD: ADMIN.password
  });
} catch (err) {
  console.error(err);
} finally {
  if (exitCode !== 0) console.log(`\n--- wrangler dev 로그 ---\n${server.readLogs().slice(-4000)}`);
  await server.stop();
}
process.exit(exitCode);
