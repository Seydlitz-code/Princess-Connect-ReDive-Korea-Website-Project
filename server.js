const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const BCRYPT_ROUNDS = 11;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 32;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const MAX_PROFILE_DATA_URL_LENGTH = 600_000;

function createPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const cfg = { connectionString };
  try {
    const u = new URL(connectionString);
    if (u.searchParams.get('sslmode') === 'require') {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch {
    /* ignore invalid URL */
  }
  return cfg;
}

let pool = null;

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(32) NOT NULL UNIQUE,
      nickname VARCHAR(32) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      profile_image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function initDb() {
  const cfg = createPoolConfig();
  if (!cfg) {
    console.warn('DATABASE_URL이 없습니다. 회원가입 API는 동작하지 않습니다.');
    return;
  }
  pool = new Pool(cfg);
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    console.log('PostgreSQL 연결 및 users 테이블 준비 완료');
  } finally {
    client.release();
  }
}

function requirePool(res) {
  if (!pool) {
    res.status(503).json({
      ok: false,
      error: '데이터베이스가 구성되지 않았습니다. Railway에서 Postgres와 웹 서비스를 연결해 DATABASE_URL을 설정하세요.',
    });
    return false;
  }
  return true;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/users/check', async (req, res) => {
  if (!requirePool(res)) return;
  const username = String(req.query.username || '').trim();
  const nickname = String(req.query.nickname || '').trim();
  if (!username && !nickname) {
    res.status(400).json({ ok: false, error: 'username 또는 nickname 쿼리가 필요합니다.' });
    return;
  }
  try {
    const out = { ok: true, usernameAvailable: true, nicknameAvailable: true };
    if (username) {
      const r = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username]);
      out.usernameAvailable = r.rowCount === 0;
    }
    if (nickname) {
      const r = await pool.query('SELECT 1 FROM users WHERE nickname = $1 LIMIT 1', [nickname]);
      out.nicknameAvailable = r.rowCount === 0;
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/register', async (req, res) => {
  if (!requirePool(res)) return;
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const nickname = String(body.nickname || '').trim();
  const password = String(body.password || '');
  const profileImage = body.profileImage == null ? null : String(body.profileImage);

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      ok: false,
      error: '아이디는 영문·숫자·밑줄만 사용하고 3~32자로 입력해 주세요.',
    });
    return;
  }
  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    res.status(400).json({
      ok: false,
      error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`,
    });
    return;
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    res.status(400).json({
      ok: false,
      error: `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해 주세요.`,
    });
    return;
  }
  if (profileImage && profileImage.length > MAX_PROFILE_DATA_URL_LENGTH) {
    res.status(400).json({ ok: false, error: '프로필 이미지가 너무 큽니다. 더 작은 이미지를 사용해 주세요.' });
    return;
  }
  if (profileImage && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(profileImage)) {
    res.status(400).json({ ok: false, error: '프로필 이미지는 base64 데이터 URL(image/*) 형식이어야 합니다.' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, nickname, password_hash, profile_image)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, nickname, created_at AS "createdAt"`,
      [username, nickname, passwordHash, profileImage || null]
    );
    const row = result.rows[0];
    res.status(201).json({
      ok: true,
      user: {
        id: row.id,
        username: row.username,
        nickname: row.nickname,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).json({ ok: false, error: '이미 사용 중인 아이디 또는 닉네임입니다.' });
      return;
    }
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ ok: false, error: '알 수 없는 API입니다.' });
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on ${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
