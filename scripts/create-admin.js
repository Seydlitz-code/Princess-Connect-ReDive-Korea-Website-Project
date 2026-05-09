/**
 * 관리자 계정 1회 생성·갱신. 비밀번호는 깃허브에 두지 마세요 — 환경 변수로만 입력합니다.
 *
 * 필수 환경 변수:
 *   ADMIN_BOOTSTRAP_PASSWORD (또는 ADMIN_PASSWORD) … 평문은 이 변수로만 넘김 → DB에는 bcrypt 저장
 *
 * 선택:
 *   DATABASE_URL 등 (Railway Postgres와 동일 규칙, lib/dbConfig.js)
 *   ADMIN_USERNAME 기본값 seydlitz
 *   ADMIN_NICKNAME 기본값 릴리프
 *   ADMIN_PROFILE_IMAGE 스크립트 기준 프로필 PNG 경로 (기본 scripts/admin-profile-source.png)
 *
 * 예 (PowerShell):
 *   $env:ADMIN_BOOTSTRAP_PASSWORD='(비밀번호)'
 *   $env:DATABASE_URL='postgresql://…'
 *   npm run bootstrap:admin
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { createPoolConfig } = require('../lib/dbConfig');

const ROOT = path.join(__dirname, '..');

const BCRYPT_ROUNDS = 11;

const DEFAULT_USERNAME = 'seydlitz';
const DEFAULT_NICKNAME = '릴리프';
const DEFAULT_PROFILE_REL = path.join('scripts', 'admin-profile-source.png');

function mimeFromExt(ext) {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function main() {
  const password =
    typeof process.env.ADMIN_BOOTSTRAP_PASSWORD === 'string'
      ? process.env.ADMIN_BOOTSTRAP_PASSWORD
      : typeof process.env.ADMIN_PASSWORD === 'string'
        ? process.env.ADMIN_PASSWORD
        : '';
  if (!password) {
    console.error(
      'ADMIN_BOOTSTRAP_PASSWORD(또는 ADMIN_PASSWORD) 환경 변수에 관리자 비밀번호를 설정한 뒤 실행하세요. 평문은 저장소에 넣지 마세요.'
    );
    process.exit(1);
  }

  const username = (process.env.ADMIN_USERNAME || DEFAULT_USERNAME).trim();
  const nickname = (process.env.ADMIN_NICKNAME || DEFAULT_NICKNAME).trim();

  const profileAbs = path.resolve(
    ROOT,
    process.env.ADMIN_PROFILE_IMAGE || DEFAULT_PROFILE_REL
  );
  if (!fs.existsSync(profileAbs)) {
    console.error('프로필 이미지 파일이 없습니다:', profileAbs);
    process.exit(1);
  }

  let profileImage = null;
  const buf = fs.readFileSync(profileAbs);
  const ext = path.extname(profileAbs);
  const mime = mimeFromExt(ext);
  profileImage = `data:${mime};base64,${buf.toString('base64')}`;

  const cfg = createPoolConfig();
  if (!cfg) {
    console.error('DATABASE_URL 등 PostgreSQL 연결 환경 변수를 설정해 주세요.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const pool = new Pool(cfg);
  const client = await pool.connect();

  try {
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user';
    `);

    await client.query('BEGIN');
    await client.query('DELETE FROM users WHERE username = $1 OR nickname = $2', [username, nickname]);

    await client.query(
      `INSERT INTO users (username, nickname, password_hash, profile_image, role)
       VALUES ($1, $2, $3, $4, 'admin')
       RETURNING id, username, nickname`,
      [username, nickname, hash, profileImage]
    );
    await client.query('COMMIT');
    console.log('관리자 계정이 생성되었습니다 (비밀번호는 DB에 bcrypt 해시로만 저장).');
    console.log('아이디:', username, '| 닉네임:', nickname, '| 역할: admin');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
