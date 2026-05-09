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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const tTrim = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 변수 이름 대신 값이 postgres URL 형태면 사용 (Railway 등에서 변수명을 다르게 둔 경우).
 * 같은 프로젝트의 Postgres 변수 참조 이름이 Postgres 말고도 있어서 이름 기반 검색 한계를 줄임.
 */
function detectPostgresUrlFromAnyEnv() {
  const scored = [];
  for (const [key, raw] of Object.entries(process.env)) {
    const v = tTrim(raw);
    if (!/^postgres(ql)?:\/\//i.test(v)) continue;
    let score = 0;
    const ku = key.toUpperCase();
    if (/(^|_)PASSWORD(_|$)/i.test(key) || /^NPM_/i.test(key)) continue;
    if (!/(DATABASE|POSTGRES|PG_|SQL|SUPABASE|NEON|COCKROACH|RLWY)/i.test(key)) continue;
    if (ku.includes('PRIVATE')) score += 120;
    if (ku.includes('DATABASE_URL') || ku === 'DATABASE_URL') score += 80;
    if (ku.includes('POSTGRES')) score += 40;
    if (ku.endsWith('_URL')) score += 20;
    scored.push({ key, value: v, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score > 0) {
    console.log(`PostgreSQL URL: 미지정 변수 대신 「${best.key}」값을 사용합니다.`);
    return best.value;
  }
  return '';
}

/** Railway 등: 여러 변수명·마지막 수단 자동 검색으로 연결 문자열 확인 */
function resolvePostgresConnectionString() {
  const fromUrl =
    tTrim(process.env.DATABASE_URL) ||
    tTrim(process.env.DATABASE_PRIVATE_URL) ||
    tTrim(process.env.POSTGRES_URL) ||
    tTrim(process.env.POSTGRES_PRISMA_URL) ||
    tTrim(process.env.DATABASE_PUBLIC_URL) ||
    tTrim(process.env.RAILWAY_DATABASE_URL);
  if (fromUrl) return fromUrl;

  const host = tTrim(
    process.env.PGHOST || process.env.POSTGRES_HOSTNAME || process.env.POSTGRES_HOST
  );
  const port = tTrim(process.env.PGPORT || process.env.POSTGRES_PORT) || '5432';
  const user = tTrim(process.env.PGUSER || process.env.POSTGRES_USER);
  const password = process.env.PGPASSWORD != null ? String(process.env.PGPASSWORD) : '';
  const database = tTrim(
    process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE
  );
  if (host && user && database) {
    const sslMode = tTrim(process.env.PGSSLMODE);
    const useSsl =
      sslMode === 'require' ||
      (sslMode !== 'disable' && host !== 'localhost' && host !== '127.0.0.1');
    const query = useSsl ? '?sslmode=require' : '';

    const u = encodeURIComponent(user);
    const p = encodeURIComponent(password);
    const db = encodeURIComponent(database);
    return `postgresql://${u}:${p}@${host}:${port}/${db}${query}`;
  }

  return detectPostgresUrlFromAnyEnv();
}

function createPoolConfig() {
  const connectionString = resolvePostgresConnectionString();
  if (!connectionString) return null;
  const cfg = { connectionString };
  try {
    const normalized = connectionString.replace(/^postgres:\/\//i, 'postgresql://');
    const u = new URL(normalized);
    const host = u.hostname || '';
    const railwayHost =
      host.includes('railway') || /\.rlwy\.net$/i.test(host) || /\.railway\.app$/i.test(host);
    if (u.searchParams.get('sslmode') === 'require' || (railwayHost && u.searchParams.get('sslmode') !== 'disable')) {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch {
    /* ignore invalid URL — Pool may still parse the string */
  }
  return cfg;
}

let pool = null;

/** null 이면 캐릭터 메타만 DB 사용 */
let characterLibrary = null;

const MAX_OWNED_CHARACTERS_PER_REGISTER = 500;

function normalizeCharacterIds(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const id = String(raw || '').trim();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_OWNED_CHARACTERS_PER_REGISTER) break;
  }
  return out;
}

async function loadValidCharacterIdSet(pgPool) {
  if (characterLibrary) return new Set(characterLibrary.byId.keys());
  const r = await pgPool.query('SELECT id FROM characters');
  return new Set(r.rows.map((row) => String(row.id)));
}

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
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_owned_characters (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      character_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, character_id)
    );
  `);
}

async function initDb() {
  const cfg = createPoolConfig();
  if (!cfg) {
    console.warn(
      'PostgreSQL 연결 문자열이 없습니다.\n',
      '- Railway 웹 서비스(지금 실행 중인 Node 앱) → Variables → 변수 추가에서 Reference로 Postgres 선택 후\n',
      '  이름: DATABASE_PRIVATE_URL (추천) 또는 DATABASE_URL 값: ${{ Postgres.DATABASE_PRIVATE_URL }}\n',
      '  (Postgres 카드 이름이 다르면 Postgres 부분은 실제 서비스 이름으로 바뀝니다)\n',
      '- 배포 재시작 후 https://.../api/health 에서 dbEnvHints 를 확인하세요.'
    );
    return;
  }
  let tmpPool = null;
  try {
    tmpPool = new Pool(cfg);
    const client = await tmpPool.connect();
    try {
      await ensureSchema(client);
      console.log('PostgreSQL 연결 및 users·characters·user_owned_characters 테이블 준비 완료');
    } finally {
      client.release();
    }
    pool = tmpPool;
    tmpPool = null;
  } catch (err) {
    if (tmpPool) {
      await tmpPool.end().catch(() => {});
    }
    console.error('PostgreSQL 연결 실패(문자열은 있으나 접속 불가):', err && err.message ? err.message : err);
    pool = null;
  }
}

function getDbDiagnostics() {
  const keysToCheck = [
    'DATABASE_URL',
    'DATABASE_PRIVATE_URL',
    'DATABASE_PUBLIC_URL',
    'POSTGRES_URL',
    'POSTGRES_PRISMA_URL',
    'RAILWAY_DATABASE_URL',
    'PGHOST',
    'PGUSER',
    'PGDATABASE',
    'PGPASSWORD',
  ];
  /** @type {Record<string, boolean>} */
  const dbEnvHints = {};
  for (const k of keysToCheck) {
    dbEnvHints[k] = Boolean(process.env[k] && tTrim(process.env[k]));
  }
  const postgresUriKeys = Object.keys(process.env)
    .filter((key) => {
      const v = tTrim(process.env[key]);
      if (!/^postgres(ql)?:\/\//i.test(v)) return false;
      return /DATABASE|POSTGRES|PG_|SQL|SUPABASE|NEON|RLWY/i.test(key);
    })
    .sort();
  return { dbEnvHints, postgresUriKeyCount: postgresUriKeys.length, postgresUriKeySample: postgresUriKeys.slice(0, 15) };
}

function requirePool(res) {
  if (!pool) {
    const diag = getDbDiagnostics();
    res.status(503).json({
      ok: false,
      error:
        '웹 서비스 프로세스에 PostgreSQL 접속 정보가 없거나 첫 접속에 실패했습니다. 같은 프로젝트의 Postgres와 웹(앱) 서비스를 연결해 Variables에 DATABASE_PRIVATE_URL(또는 DATABASE_URL) 참조를 추가한 뒤 재배포하세요. 브라우저에서 /api/health 를 열어 poolReady·dbEnvHints 를 확인할 수 있습니다.',
      diagnostics: diag,
      helpUrlPath: '/api/health',
    });
    return false;
  }
  return true;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  const diag = getDbDiagnostics();
  res.json({
    ok: true,
    database: {
      poolReady: Boolean(pool),
      ...diag,
    },
    hint:
      'poolReady가 false이면 Railway 웹 서비스에 Postgres의 DATABASE_PRIVATE_URL(또는 DATABASE_URL) 변수 **참조**를 추가하고 재배포하세요. Postgres 서비스 이름이 "Postgres"가 아니면 참조 문법의 서비스명도 맞춥니다.',
  });
});

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

  const deferOwnedCharacters = Boolean(body.deferOwnedCharacters);
  const requestedCharacterIds = normalizeCharacterIds(body.characterIds);

  if (!deferOwnedCharacters && requestedCharacterIds.length === 0) {
    res.status(400).json({
      ok: false,
      error: '보유 캐릭터를 한 명 이상 선택하거나, ‘보유 캐릭터 추후 등록’을 체크해 주세요.',
    });
    return;
  }

  const pg = pool;
  const client = await pg.connect();
  try {
    const validIds = await loadValidCharacterIdSet(pg);
    if (requestedCharacterIds.length > 0 && validIds.size === 0) {
      res.status(503).json({
        ok: false,
        error: '캐릭터 데이터가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      });
      return;
    }
    if (!deferOwnedCharacters && validIds.size === 0) {
      res.status(503).json({
        ok: false,
        error: '캐릭터 데이터가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      });
      return;
    }

    const ownedFiltered = [];
    for (const id of requestedCharacterIds) {
      if (validIds.has(id)) ownedFiltered.push(id);
    }

    if (ownedFiltered.length < requestedCharacterIds.length) {
      res.status(400).json({
        ok: false,
        error: '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await client.query('BEGIN');
    let userRow;
    try {
      const ins = await client.query(
        `INSERT INTO users (username, nickname, password_hash, profile_image)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, nickname, created_at AS "createdAt"`,
        [username, nickname, passwordHash, profileImage || null]
      );
      userRow = ins.rows[0];

      for (const cid of ownedFiltered) {
        await client.query(
          `INSERT INTO user_owned_characters (user_id, character_id) VALUES ($1, $2::uuid)`,
          [userRow.id, cid]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    }

    res.status(201).json({
      ok: true,
      user: {
        id: userRow.id,
        username: userRow.username,
        nickname: userRow.nickname,
        createdAt: userRow.createdAt,
      },
      ownedCharacterCount: ownedFiltered.length,
      deferOwnedCharacters,
    });
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).json({ ok: false, error: '이미 사용 중인 아이디 또는 닉네임입니다.' });
      return;
    }
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  } finally {
    client.release();
  }
});

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
    const characters = result.rows.map((row) => {
      const id = String(row.id);
      return {
        ...row,
        imageUrl: `/api/characters/${id}/image`,
      };
    });
    res.json({ ok: true, source: 'postgres', characters });
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
