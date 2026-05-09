const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { readCharacterLibrarySync } = require('./lib/charactersLibrary');

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

/** null 이면 캐릭터 메타만 DB 사용 */
let characterLibrary = null;

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
  await client.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(512) NOT NULL UNIQUE,
      image_mime VARCHAR(128) NOT NULL,
      image_data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    console.log('PostgreSQL 연결 및 users·characters 테이블 준비 완료');
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.get('/api/characters', async (req, res) => {
  if (characterLibrary) {
    res.json({
      ok: true,
      source: 'library',
      characters: characterLibrary.list.map((c) => ({
        id: c.id,
        name: c.name,
        updatedAt: c.updatedAt,
        imageUrl: c.imageUrl,
      })),
    });
    return;
  }
  if (!requirePool(res)) return;
  try {
    const result = await pool.query(
      `SELECT id, name, updated_at AS "updatedAt"
       FROM characters
       ORDER BY name ASC`
    );
    res.json({ ok: true, source: 'postgres', characters: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/characters/:id/image', async (req, res) => {
  const id = String(req.params.id || '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ ok: false, error: '잘못된 캐릭터 ID입니다.' });
    return;
  }
  if (characterLibrary) {
    const entry = characterLibrary.byId.get(id);
    if (!entry) {
      res.status(404).json({ ok: false, error: '캐릭터 이미지를 찾을 수 없습니다.' });
      return;
    }
    res.setHeader('Content-Type', entry.imageMime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(entry.absPath, (err) => {
      if (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).end();
      }
    });
    return;
  }
  if (!requirePool(res)) return;
  try {
    const result = await pool.query(
      'SELECT image_mime, image_data FROM characters WHERE id = $1 LIMIT 1',
      [id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ ok: false, error: '캐릭터 이미지를 찾을 수 없습니다.' });
      return;
    }
    const row = result.rows[0];
    res.setHeader('Content-Type', row.image_mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(row.image_data);
  } catch (err) {
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
  characterLibrary = readCharacterLibrarySync(__dirname);
  if (characterLibrary) {
    console.log(`캐릭터 정적 라이브러리 사용: ${characterLibrary.list.length}건 (public/data/characters.json)`);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on ${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
