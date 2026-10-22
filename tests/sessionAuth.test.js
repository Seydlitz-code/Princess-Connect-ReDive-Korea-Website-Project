'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { signSession, verifySession, getSessionFromRequest, COOKIE_NAME } = require('../lib/sessionAuth');

const SECRET = 'unit-test-secret';
const USER = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';

test('서명한 토큰은 사용자·세션 id 로 복원된다', () => {
  const token = signSession(SECRET, USER, SID);
  assert.deepEqual(verifySession(SECRET, token), { sub: USER, sid: SID });
  assert.deepEqual(getSessionFromRequest(SECRET, `a=1; ${COOKIE_NAME}=${encodeURIComponent(token)}`), { sub: USER, sid: SID });
});

test('다른 비밀키·변조된 토큰은 거부된다', () => {
  const token = signSession(SECRET, USER, SID);
  assert.equal(verifySession('other-secret', token), null);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: USER, sid: SID, exp: 9e9, role: 'admin' })).toString('base64url');
  assert.equal(verifySession(SECRET, `${forged}.${sig}`), null);
  assert.equal(verifySession(SECRET, `${payload}.`), null);
});

test('세션 id 가 없는 예전 형식 토큰은 거부된다', () => {
  const payload = Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  assert.equal(verifySession(SECRET, `${payload}.${sig}`), null);
});

test('만료된 토큰은 거부된다', () => {
  const payload = Buffer.from(JSON.stringify({ sub: USER, sid: SID, exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  assert.equal(verifySession(SECRET, `${payload}.${sig}`), null);
});
