/** 세션 쿠키 서명·검증 (기존 tests/sessionAuth.test.js 이식) */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { signSession, verifySession } from '../../src/lib/sessionToken.ts';

const SECRET = 'unit-test-secret';
const USER = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const sign = (payload, secret = SECRET) => createHmac('sha256', secret).update(payload).digest('base64url');
const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');

test('서명한 토큰은 사용자·세션 id로 복원된다', async () => {
  const token = await signSession(SECRET, USER, SID);
  assert.deepEqual(await verifySession(SECRET, token), { sub: USER, sid: SID });
});

test('기존 Node(crypto.createHmac) 서명 형식과 같다', async () => {
  const payload = encode({ sub: USER, sid: SID, exp: Math.floor(Date.now() / 1000) + 60 });
  assert.deepEqual(await verifySession(SECRET, `${payload}.${sign(payload)}`), { sub: USER, sid: SID });
  const token = await signSession(SECRET, USER, SID);
  const [ourPayload, ourSignature] = token.split('.');
  assert.equal(ourSignature, sign(ourPayload));
});

test('다른 비밀키·변조된 토큰은 거부된다', async () => {
  const token = await signSession(SECRET, USER, SID);
  assert.equal(await verifySession('other-secret', token), null);
  const [payload, signature] = token.split('.');
  const forged = encode({ sub: USER, sid: SID, exp: 9e9, role: 'admin' });
  assert.equal(await verifySession(SECRET, `${forged}.${signature}`), null);
  assert.equal(await verifySession(SECRET, `${payload}.`), null);
  assert.equal(await verifySession(SECRET, `${payload}.@@@`), null);
  assert.equal(await verifySession(SECRET, 'x'.repeat(5000)), null);
});

test('세션 id가 없는 예전 형식 토큰은 거부된다', async () => {
  const payload = encode({ sub: USER, exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(await verifySession(SECRET, `${payload}.${sign(payload)}`), null);
});

test('만료된 토큰은 거부된다', async () => {
  const payload = encode({ sub: USER, sid: SID, exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal(await verifySession(SECRET, `${payload}.${sign(payload)}`), null);
});
