'use strict';

/**
 * E2E 테스트 계정 생성. 서버와 같은 암호화 규칙으로 users 에 직접 넣는다(캡차를 거치지 않기 위함).
 * 사용: node tests/e2e/seed.cjs  (DATABASE_URL, SESSION_SECRET 필요)
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const pii = require('../../lib/userPiiCrypto');

const ACCOUNTS = [
  { username: 'testeruser', nickname: '테스터', password: 'password123', role: 'user' },
  { username: 'adminuserr', nickname: '관리자테스트', password: 'adminpass123', role: 'admin' },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const a of ACCOUNTS) {
      await pool.query(
        `INSERT INTO users (username, nickname, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, role)
         VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          pii.usernameBlindIndex(a.username),
          pii.nicknameBlindIndex(a.nickname),
          pii.encryptUtf8(pii.normalizeUsername(a.username)),
          pii.encryptUtf8(a.nickname),
          await bcrypt.hash(a.password, 4),
          a.role,
        ]
      );
    }
  } finally {
    await pool.end();
  }
  console.log('[seed] 테스트 계정 준비 완료');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
