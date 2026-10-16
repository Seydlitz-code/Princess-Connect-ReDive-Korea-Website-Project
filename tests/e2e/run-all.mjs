/**
 * E2E 오케스트레이터: 서버 3개(개발·캡차 스텁·운영 모드)를 띄우고 테스트 계정을 만든 뒤
 * 브라우저 E2E 와 회원가입/운영 모드 API 점검을 실행한다.
 *
 * 필요: DATABASE_URL (빈 DB 권장), 브라우저(playwright-core chromium 또는 E2E_BROWSER_PATH)
 * 사용: npm run test:e2e
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.join(ROOT, 'tests', 'e2e');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 이 필요합니다.');
  process.exit(1);
}

const baseEnv = {
  ...process.env,
  SESSION_SECRET: process.env.SESSION_SECRET || 'e2e-session-secret',
  NODE_ENV: '',
  RECAPTCHA_SITE_KEY: '',
  RECAPTCHA_SECRET_KEY: '',
  PG_INIT_RETRIES: '10',
};

const SERVERS = [
  { name: 'dev', port: 3999, args: ['server.js'], env: {} },
  { name: 'stub', port: 4000, args: ['-r', path.join(HERE, 'captcha-stub.cjs'), 'server.js'], env: {} },
  { name: 'prod', port: 4001, args: ['server.js'], env: { NODE_ENV: 'production' } },
];

const children = [];
const logs = new Map();

function startServer(s) {
  const child = spawn(process.execPath, s.args, {
    cwd: ROOT,
    env: { ...baseEnv, ...s.env, PORT: String(s.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  logs.set(s.name, '');
  const append = (d) => logs.set(s.name, logs.get(s.name) + d.toString());
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  children.push(child);
  return child;
}

async function waitHealthy(port, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      const j = await r.json();
      if (j.database?.poolReady) return;
    } catch {
      /* 아직 기동 중 */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`서버(:${port})가 ${timeoutMs}ms 안에 준비되지 않았습니다.`);
}

function runNode(script, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: { ...baseEnv, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function stopAll() {
  for (const c of children) c.kill();
}

let exitCode = 1;
try {
  // 첫 서버가 스키마를 만든 뒤 나머지를 띄운다(동시 CREATE TABLE 경합 방지).
  startServer(SERVERS[0]);
  await waitHealthy(SERVERS[0].port);
  for (const s of SERVERS.slice(1)) startServer(s);
  await Promise.all(SERVERS.slice(1).map((s) => waitHealthy(s.port)));

  if ((await runNode(path.join(HERE, 'seed.cjs'))) !== 0) throw new Error('테스트 계정 생성 실패');

  console.log('\n=== 브라우저 E2E ===');
  const browserCode = await runNode(path.join(HERE, 'browser.mjs'), ['http://127.0.0.1:3999']);
  console.log('\n=== 회원가입·운영 모드 API ===');
  const apiCode = await runNode(path.join(HERE, 'api.mjs'), ['http://127.0.0.1:4000', 'http://127.0.0.1:4001']);
  exitCode = browserCode === 0 && apiCode === 0 ? 0 : 1;
} catch (err) {
  console.error(err);
} finally {
  stopAll();
  if (exitCode !== 0) {
    for (const [name, log] of logs) {
      console.log(`\n--- server log (${name}) ---\n${log.slice(-4000)}`);
    }
  }
}
process.exit(exitCode);
