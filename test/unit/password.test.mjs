/** 비밀번호 해시 (PBKDF2) */
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from '../../src/lib/password.ts';

test('해시 형식과 검증', async () => {
  const stored = await hashPassword('password123');
  const parts = stored.split('$');
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.slice(0, 2), ['pbkdf2_sha256', String(PBKDF2_ITERATIONS)]);
  assert.equal(Buffer.from(parts[2], 'base64').length, 16);
  assert.equal(Buffer.from(parts[3], 'base64').length, 32);
  assert.equal(await verifyPassword('password123', stored), true);
  assert.equal(await verifyPassword('password124', stored), false);
  assert.notEqual(await hashPassword('password123'), stored, 'salt가 매번 달라야 한다');
});

test('Node pbkdf2Sync로 만든 같은 형식의 해시도 검증된다', async () => {
  const salt = Buffer.from('0123456789abcdef');
  const hash = pbkdf2Sync('adminpass123', salt, 1000, 32, 'sha256');
  const stored = ['pbkdf2_sha256', '1000', salt.toString('base64'), hash.toString('base64')].join('$');
  assert.equal(await verifyPassword('adminpass123', stored), true);
});

test('잘못된 저장값·없는 계정은 false', async () => {
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword('x', ['', '2b', '11', 'bcrypthashvalue'].join('$')), false);
  assert.equal(await verifyPassword('x', ['pbkdf2_sha256', '9999999', 'AAAA', 'AAAA'].join('$')), false);
  assert.equal(await verifyPassword('x', ['pbkdf2_sha256', '100', '!!!', 'AAAA'].join('$')), false);
});
