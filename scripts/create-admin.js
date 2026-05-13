/**
 * 관리자 계정 1회 생성·갱신(로컬·CI용). Railway에서는 보통 웹 서비스 Variables에
 * ADMIN_BOOTSTRAP_PASSWORD·ADMIN_USERNAME·ADMIN_NICKNAME 을 두고 서버 기동 시 자동 생성합니다(server.js).
 *
 * 이 스크립트 비밀번호: ADMIN_BOOTSTRAP_PASSWORD / ADMIN_PASSWORD
 *   → 없으면 scripts/admin-credentials.local.js
 *
 * 선택: DATABASE_URL, SESSION_SECRET 또는 USER_PII_ENCRYPTION_KEY, ADMIN_PROFILE_IMAGE
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
const { ensureUserPiiSchema } = require('../lib/userPiiSchema');
const {
  usernameBlindIndex,
  nicknameBlindIndex,
  encryptUtf8,
  normalizeUsername,
  isPiiEncryptionReady,
} = require('../lib/userPiiCrypto');

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

function loadLocalAdminPassword() {
  const localPath = path.join(__dirname, 'admin-credentials.local.js');
  if (!fs.existsSync(localPath)) return '';
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const m = require(localPath);
    if (m && typeof m.ADMIN_BOOTSTRAP_PASSWORD === 'string') return m.ADMIN_BOOTSTRAP_PASSWORD;
  } catch (e) {
    console.warn('admin-credentials.local.js 를 읽지 못했습니다:', e.message);
  }
  return '';
}

async function main() {
  const passwordRaw =
    (typeof process.env.ADMIN_BOOTSTRAP_PASSWORD === 'string' && process.env.ADMIN_BOOTSTRAP_PASSWORD) ||
    (typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD) ||
    loadLocalAdminPassword() ||
    '';
  const password = String(passwordRaw).trim();
  if (!password) {
    console.error(
      '관리자 비밀번호가 필요합니다. ADMIN_BOOTSTRAP_PASSWORD 환경 변수를 설정하거나, scripts/admin-credentials.local.js 를 만드세요 (예시: admin-credentials.local.example.js).'
    );
    process.exit(1);
  }

  const username = (process.env.ADMIN_USERNAME || DEFAULT_USERNAME).trim();
  const nickname = (process.env.ADMIN_NICKNAME || DEFAULT_NICKNAME).trim();

  const USERNAME_RE = /^[a-zA-Z0-9_]{8,20}$/;
  if (!USERNAME_RE.test(username)) {
    console.error('ADMIN_USERNAME은 영문·숫자·밑줄 8~20자여야 합니다.');
    process.exit(1);
  }
  const nickLen = [...nickname].length;
  if (nickLen < 2 || nickLen > 10) {
    console.error('ADMIN_NICKNAME은 2~10자여야 합니다.');
    process.exit(1);
  }

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
    await ensureUserPiiSchema(client);

    if (!isPiiEncryptionReady()) {
      console.error(
        'SESSION_SECRET 또는 USER_PII_ENCRYPTION_KEY를 설정해 주세요. (관리자 아이디·닉네임 암호화에 필요)'
      );
      process.exit(1);
    }

    const ub = usernameBlindIndex(username);
    const nb = nicknameBlindIndex(nickname);
    const uCipher = encryptUtf8(normalizeUsername(username));
    const nCipher = encryptUtf8(nickname);

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM users
       WHERE username_blind = $1
          OR nickname_blind = $2
          OR (username IS NOT NULL AND LOWER(username) = LOWER($3))
          OR (nickname IS NOT NULL AND nickname = $4)`,
      [ub, nb, username, nickname]
    );

    await client.query(
      `INSERT INTO users (username, nickname, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, profile_image, role)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, 'admin')
       RETURNING id`,
      [ub, nb, uCipher, nCipher, hash, profileImage]
    );
    await client.query('COMMIT');
    console.log(
      '관리자 계정이 생성되었습니다. (아이디·닉네임: AES-GCM + blind index / 비밀번호: bcrypt 단방향 해시 — 평문은 DB에 저장되지 않습니다.)'
    );
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
