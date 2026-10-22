/** 아이디·닉네임 암호화가 기존 lib/userPiiCrypto.js(Node crypto)와 같은 결과를 내는지 */
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { getPiiCrypto, normalizeUsername } from '../../src/lib/pii.ts';

const HEX_KEY = 'a'.repeat(64);
/** 용도 라벨 끝의 0 바이트 */
const NUL = String.fromCharCode(0);

/** 기존 서버 구현을 그대로 옮긴 기준 함수 */
function legacyBlind(keyBuf, label, text) {
  const macKey = createHash('sha256').update(Buffer.concat([keyBuf, Buffer.from(label + NUL, 'utf8')])).digest();
  return createHmac('sha256', macKey).update(text, 'utf8').digest('hex');
}
function legacyEncrypt(keyBuf, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}
function legacyDecrypt(keyBuf, text) {
  const buf = Buffer.from(text, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', keyBuf, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

test('키가 없으면 null', () => {
  assert.equal(getPiiCrypto(''), null);
  assert.equal(getPiiCrypto(undefined), null);
});

const KEY_CASES = [
  ['16진수 키', HEX_KEY, Buffer.from(HEX_KEY, 'hex')],
  ['일반 문자열 키', 'some passphrase', createHash('sha256').update('some passphrase', 'utf8').digest()]
];

for (const [name, rawKey, keyBuf] of KEY_CASES) {
  test(`blind index·암호문이 기존 구현과 호환된다 (${name})`, async () => {
    const pii = await getPiiCrypto(rawKey);
    assert.equal(await pii.usernameBlindIndex(' TesterUser '), legacyBlind(keyBuf, 'username:v1', 'testeruser'));
    assert.equal(await pii.nicknameBlindIndex(' 테스터 '), legacyBlind(keyBuf, 'nickname:v1', '테스터'));
    const ours = await pii.encrypt('닉네임ニック');
    assert.equal(legacyDecrypt(keyBuf, ours), '닉네임ニック');
    assert.equal(await pii.decrypt(legacyEncrypt(keyBuf, 'legacyuser')), 'legacyuser');
  });
}

test('변조·형식 오류 암호문은 null', async () => {
  const pii = await getPiiCrypto(HEX_KEY);
  const sealed = await pii.encrypt('hello');
  const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
  assert.equal(await pii.decrypt(tampered), null);
  assert.equal(await pii.decrypt('short'), null);
  assert.equal(await pii.decrypt('!!!'), null);
  const other = await getPiiCrypto('b'.repeat(64));
  assert.equal(await other.decrypt(sealed), null);
});

test('아이디 정규화', () => {
  assert.equal(normalizeUsername('  AbCdEfGh '), 'abcdefgh');
});
