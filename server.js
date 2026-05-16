const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { createPoolConfig, getDbEnvDiagnostics } = require('./lib/dbConfig');
const {
  getSessionSecret,
  signSession,
  getUserIdFromRequest,
  appendSessionCookie,
  appendClearSessionCookie,
} = require('./lib/sessionAuth');
const { readCharacterLibrarySync } = require('./lib/charactersLibrary');
const { verifyRecaptchaResponse } = require('./lib/recaptcha');
const {
  normalizeUsername,
  usernameBlindIndex,
  nicknameBlindIndex,
  encryptUtf8,
  displayUsernameFromRow,
  displayNicknameFromRow,
  isPiiEncryptionReady,
} = require('./lib/userPiiCrypto');
const { ensureUserPiiSchema } = require('./lib/userPiiSchema');
const {
  createSignupCaptchaChallenge,
  verifySignupCaptchaAndIssueStepPass,
  consumeStepPassToken,
} = require('./lib/signupCaptcha');

const app = express();

app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

const BCRYPT_ROUNDS = 11;
const USERNAME_RE = /^[a-zA-Z0-9_]{8,20}$/;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 10;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const MAX_PROFILE_DATA_URL_LENGTH = 600_000;

/** 회원가입 시 업로드가 없으면 DB에 저장할 데이터 URL (`scripts/default-profile.png`) */
let defaultSignupProfileDataUrlCache = null;
let defaultSignupProfileDataUrlTried = false;

function getDefaultSignupProfileDataUrl() {
  if (defaultSignupProfileDataUrlTried) return defaultSignupProfileDataUrlCache;
  defaultSignupProfileDataUrlTried = true;
  const abs = path.join(__dirname, 'scripts', 'default-profile.png');
  try {
    if (!fs.existsSync(abs)) {
      console.warn('[signup] 기본 프로필 이미지 파일이 없습니다:', abs);
      defaultSignupProfileDataUrlCache = null;
      return null;
    }
    const buf = fs.readFileSync(abs);
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    if (dataUrl.length > MAX_PROFILE_DATA_URL_LENGTH) {
      console.warn('[signup] 기본 프로필 이미지가 허용 크기를 초과해 사용하지 않습니다.');
      defaultSignupProfileDataUrlCache = null;
      return null;
    }
    defaultSignupProfileDataUrlCache = dataUrl;
    return dataUrl;
  } catch (err) {
    console.warn(
      '[signup] 기본 프로필 이미지를 읽지 못했습니다:',
      err && err.message ? err.message : err
    );
    defaultSignupProfileDataUrlCache = null;
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let pool = null;
let httpServer = null;

/** initDb 연속 시도 후에도 pool 이 null 이면 마지막 오류(진단용) */
let lastDbInitError = null;

/** null 이면 캐릭터 메타만 DB 사용 */
let characterLibrary = null;

const MAX_OWNED_CHARACTERS_PER_REGISTER = 500;
const FUTURE_SIGHT_MONTH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function nicknameCodepointLen(s) {
  return [...String(s || '')].length;
}

function currentKoreanMonthNumber(now = new Date()) {
  return now.getMonth() + 1;
}

function normalizeMonthNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function parseMonthNumber(label) {
  const m = String(label || '').match(/(\d{1,2})\s*월/);
  return m ? normalizeMonthNumber(m[1]) : null;
}

function addMonthsNumber(baseMonth, offset) {
  return ((baseMonth - 1 + offset) % 12) + 1;
}

function monthLabel(monthNumber) {
  return `${monthNumber}월`;
}

async function loadAdminUserRows(pgPool) {
  if (!pgPool) return [];
  const r = await pgPool.query(
    `SELECT id, username, nickname, username_cipher, nickname_cipher
     FROM users WHERE COALESCE(role, 'user') = 'admin'`
  );
  return r.rows;
}

/** 관리자 계정과 동일한 아이디면 true(본인 excludeUserId는 제외). */
function usernameCollidesWithAdminAccount(username, adminRows, excludeUserId) {
  const nu = normalizeUsername(username);
  if (!nu) return false;
  for (const row of adminRows) {
    const au = displayUsernameFromRow(row);
    if (!au) continue;
    if (normalizeUsername(au) === nu) {
      if (excludeUserId && String(row.id) === String(excludeUserId)) continue;
      return true;
    }
  }
  return false;
}

/** 관리자 계정과 동일한 닉네임이면 true(본인 excludeUserId는 제외). */
function nicknameCollidesWithAdminAccount(nickname, adminRows, excludeUserId) {
  const nt = String(nickname || '').trim();
  if (!nt) return false;
  for (const row of adminRows) {
    const an = displayNicknameFromRow(row);
    if (!an) continue;
    const ant = String(an).trim();
    if (!ant) continue;
    if (ant === nt) {
      if (excludeUserId && String(row.id) === String(excludeUserId)) continue;
      return true;
    }
  }
  return false;
}

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

async function loadCharacterMetaMap(pgPool) {
  if (characterLibrary) {
    return new Map(
      characterLibrary.list.map((c) => [
        c.id,
        {
          id: c.id,
          name: c.name,
          imageUrl: c.imageUrl || `/api/characters/${encodeURIComponent(c.id)}/image`,
        },
      ])
    );
  }
  const r = await pgPool.query('SELECT id, name FROM characters');
  return new Map(
    r.rows.map((row) => {
      const id = String(row.id);
      return [id, { id, name: row.name, imageUrl: `/api/characters/${encodeURIComponent(id)}/image` }];
    })
  );
}

async function requireAdminUser(req, res) {
  if (!requirePool(res)) return null;
  const secret = getSessionSecret();
  if (!secret) {
    res.status(503).json({ ok: false, error: '관리자 기능을 사용할 수 없습니다. SESSION_SECRET 설정이 필요합니다.' });
    return null;
  }
  const userId = getUserIdFromRequest(secret, req.headers.cookie || '');
  if (!userId) {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return null;
  }
  const r = await pool.query(
    `SELECT id, COALESCE(role, 'user') AS role FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId]
  );
  if (r.rowCount === 0 || r.rows[0].role !== 'admin') {
    res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    return null;
  }
  return r.rows[0];
}

function defaultFutureSightState() {
  const monthNumber = currentKoreanMonthNumber();
  return {
    version: 1,
    lastMonthCheckedAt: null,
    months: [
      {
        id: 'month-1',
        monthNumber,
        label: monthLabel(monthNumber),
        categories: {
          new: [],
          rerun: [],
          sixStar: [],
          unique1: [],
          unique2: [],
          event: [],
        },
        info: '',
      },
    ],
  };
}

function normalizeFutureSightState(value) {
  const rawMonths = value && typeof value === 'object' && Array.isArray(value.months) ? value.months : [];
  const months = rawMonths.slice(0, 36).map((month, index) => {
    const src = month && typeof month === 'object' ? month : {};
    const categories = src.categories && typeof src.categories === 'object' ? src.categories : {};
    const monthNumber =
      normalizeMonthNumber(src.monthNumber) ||
      parseMonthNumber(src.label) ||
      addMonthsNumber(currentKoreanMonthNumber(), index);
    const normalizeEntries = (items) =>
      (Array.isArray(items) ? items : []).slice(0, 24).map((item) => {
        const obj = item && typeof item === 'object' ? item : {};
        let type = obj.type === 'pass' ? 'pass' : obj.type === 'limited' ? 'limited' : 'permanent';
        if (obj.princessPass === true) type = 'pass';
        const base = {
          characterId: String(obj.characterId || '').trim(),
          type,
        };
        if (obj.prizeGacha === true) base.prizeGacha = true;
        if (obj.simultaneousRerun === true) base.simultaneousRerun = true;
        const sg = String(obj.specialGroupId || '').trim().slice(0, 80);
        if (sg) base.specialGroupId = sg;
        return base;
      });
    const legacySpecial = normalizeEntries(categories.special);
    const eventCombined = [...normalizeEntries(categories.event), ...legacySpecial].slice(0, 24);
    return {
      id: String(src.id || `month-${index + 1}`).trim() || `month-${index + 1}`,
      monthNumber,
      label: String(src.label || monthLabel(monthNumber)).trim() || monthLabel(monthNumber),
      categories: {
        new: normalizeEntries(categories.new),
        rerun: normalizeEntries(categories.rerun),
        sixStar: normalizeEntries(categories.sixStar),
        unique1: normalizeEntries(categories.unique1),
        unique2: normalizeEntries(categories.unique2),
        event: eventCombined,
      },
      info: String(src.info || '').slice(0, 2000),
    };
  });
  const lastMonthCheckedAt =
    value && typeof value === 'object' && typeof value.lastMonthCheckedAt === 'string'
      ? value.lastMonthCheckedAt
      : null;
  return { version: 1, lastMonthCheckedAt, months: months.length > 0 ? months : defaultFutureSightState().months };
}

function applyFutureSightMonthMaintenance(value, now = new Date()) {
  const state = normalizeFutureSightState(value);
  const lastCheckedMs = state.lastMonthCheckedAt ? Date.parse(state.lastMonthCheckedAt) : NaN;
  if (Number.isFinite(lastCheckedMs) && now.getTime() - lastCheckedMs < FUTURE_SIGHT_MONTH_CHECK_INTERVAL_MS) {
    return { state, changed: false };
  }

  const currentMonth = currentKoreanMonthNumber(now);
  let months = state.months;
  const currentIndex = months.findIndex((month) => month.monthNumber === currentMonth || parseMonthNumber(month.label) === currentMonth);

  if (currentIndex > 0) {
    months = months.slice(currentIndex);
  } else if (currentIndex === -1) {
    months = months.map((month, index) => ({
      ...month,
      monthNumber: addMonthsNumber(currentMonth, index),
      label: monthLabel(addMonthsNumber(currentMonth, index)),
    }));
  }

  if (months.length === 0) months = defaultFutureSightState().months;
  months = months.map((month, index) => {
    const monthNumber = addMonthsNumber(currentMonth, index);
    return {
      ...month,
      monthNumber,
      label: monthLabel(monthNumber),
    };
  });

  return {
    state: { version: 1, lastMonthCheckedAt: now.toISOString(), months },
    changed: true,
  };
}

async function hydrateFutureSightState(pgPool, state) {
  const metaMap = await loadCharacterMetaMap(pgPool);
  const normalized = normalizeFutureSightState(state);
  const hydrateEntries = (items) =>
    items
      .map((item) => {
        const meta = metaMap.get(item.characterId);
        if (!meta) return null;
        return { ...item, ...meta };
      })
      .filter(Boolean);

  return {
    version: normalized.version,
    months: normalized.months.map((month) => ({
      ...month,
      categories: {
        new: hydrateEntries(month.categories.new),
        rerun: hydrateEntries(month.categories.rerun),
        sixStar: hydrateEntries(month.categories.sixStar),
        unique1: hydrateEntries(month.categories.unique1),
        unique2: hydrateEntries(month.categories.unique2),
        event: hydrateEntries(month.categories.event),
      },
    })),
  };
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(32),
      nickname VARCHAR(32),
      password_hash TEXT NOT NULL,
      profile_image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user';
  `);
  await ensureUserPiiSchema(client);
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS site_future_sight (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{"version":1,"months":[]}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT site_future_sight_singleton CHECK (id = 1)
    );
  `);
}

/**
 * Railway 등: 웹 서비스 환경 변수 ADMIN_BOOTSTRAP_PASSWORD(또는 ADMIN_PASSWORD)가 있고
 * DB에 관리자가 없으면 첫 기동 시 계정을 만듭니다.
 * ADMIN_USERNAME·ADMIN_NICKNAME은 선택(기본 seydlitz / 릴리프).
 * 관리자 생성 후에는 Variables에서 비밀번호 변수 제거를 권장합니다.
 */
async function bootstrapAdminFromEnvIfNeeded(pgPool) {
  if (!pgPool) return;
  const passwordRaw =
    (typeof process.env.ADMIN_BOOTSTRAP_PASSWORD === 'string' && process.env.ADMIN_BOOTSTRAP_PASSWORD) ||
    (typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD) ||
    '';
  const passwordPlain = String(passwordRaw).trim();
  if (!passwordPlain) return;

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74821901)');

    const adminExists = await client.query(
      `SELECT 1 FROM users WHERE COALESCE(role, 'user') = 'admin' LIMIT 1`
    );
    if (adminExists.rowCount > 0) {
      await client.query('COMMIT');
      return;
    }

    if (!isPiiEncryptionReady()) {
      await client.query('ROLLBACK');
      console.warn(
        '[admin_bootstrap] SESSION_SECRET 또는 USER_PII_ENCRYPTION_KEY가 없어 환경 변수 관리자 생성을 건너뜁니다.'
      );
      return;
    }

    const username = String(process.env.ADMIN_USERNAME || 'seydlitz').trim();
    const nickname = String(process.env.ADMIN_NICKNAME || '릴리프').trim();

    if (!USERNAME_RE.test(username)) {
      await client.query('ROLLBACK');
      console.error(
        '[admin_bootstrap] ADMIN_USERNAME 형식이 올바르지 않습니다. (영문·숫자·밑줄 8~20자)'
      );
      return;
    }
    const nLen = nicknameCodepointLen(nickname);
    if (nLen < NICKNAME_MIN || nLen > NICKNAME_MAX) {
      await client.query('ROLLBACK');
      console.error(
        `[admin_bootstrap] ADMIN_NICKNAME 길이가 올바르지 않습니다. (${NICKNAME_MIN}~${NICKNAME_MAX}자)`
      );
      return;
    }
    if (passwordPlain.length < PASSWORD_MIN || passwordPlain.length > PASSWORD_MAX) {
      await client.query('ROLLBACK');
      console.error(
        `[admin_bootstrap] 비밀번호 길이가 올바르지 않습니다. (${PASSWORD_MIN}~${PASSWORD_MAX}자)`
      );
      return;
    }

    const hash = await bcrypt.hash(passwordPlain, BCRYPT_ROUNDS);
    const ub = usernameBlindIndex(username);
    const nb = nicknameBlindIndex(nickname);
    const uCipher = encryptUtf8(normalizeUsername(username));
    const nCipher = encryptUtf8(nickname.trim());

    let profileImage = null;
    const profileAbs = path.join(__dirname, 'scripts', 'admin-profile-source.png');
    if (fs.existsSync(profileAbs)) {
      const buf = fs.readFileSync(profileAbs);
      profileImage = `data:image/png;base64,${buf.toString('base64')}`;
    }

    await client.query(
      `INSERT INTO users (username, nickname, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, profile_image, role)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, 'admin')`,
      [ub, nb, uCipher, nCipher, hash, profileImage]
    );
    await client.query('COMMIT');
    console.log(
      '[admin_bootstrap] 환경 변수로 관리자 계정을 생성했습니다. 보안을 위해 Railway Variables에서 ADMIN_BOOTSTRAP_PASSWORD·ADMIN_PASSWORD 제거를 권장합니다.'
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin_bootstrap] 실패:', err && err.message ? err.message : err);
  } finally {
    client.release();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDb() {
  lastDbInitError = null;
  const cfg = createPoolConfig();
  if (!cfg) {
    lastDbInitError = {
      kind: 'missing_url',
      message:
        'PostgreSQL 연결 문자열이 없습니다. 웹 서비스 Variables에 Postgres의 DATABASE_PRIVATE_URL(또는 DATABASE_URL) 참조를 추가하세요.',
    };
    console.warn(
      'PostgreSQL 연결 문자열이 없습니다.\n',
      '- Railway 웹 서비스(지금 실행 중인 Node 앱) → Variables → 변수 추가에서 Reference로 Postgres 선택 후\n',
      '  이름: DATABASE_PRIVATE_URL (추천) 또는 DATABASE_URL 값: ${{ Postgres.DATABASE_PRIVATE_URL }}\n',
      '  (Postgres 카드 이름이 다르면 Postgres 부분은 실제 서비스 이름으로 바뀝니다)\n',
      '- 배포 재시작 후 https://.../api/health 에서 dbEnvHints·lastDbInitError 를 확인하세요.'
    );
    return;
  }

  const maxAttempts = Math.max(1, Number(process.env.PG_INIT_RETRIES) || 5);
  const delayMs = Math.max(0, Number(process.env.PG_INIT_RETRY_MS) || 2000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      lastDbInitError = null;
      return;
    } catch (err) {
      if (tmpPool) {
        await tmpPool.end().catch(() => {});
      }
      const msg = err && err.message ? err.message : String(err);
      const code = err && err.code ? err.code : undefined;
      lastDbInitError = { kind: 'connect_failed', message: msg, code, attempt, maxAttempts };
      console.error(
        `PostgreSQL 연결 실패 (${attempt}/${maxAttempts}):`,
        msg,
        code ? `(code ${code})` : ''
      );
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }
  pool = null;
}

function getDbDiagnostics() {
  return getDbEnvDiagnostics();
}

function getRecaptchaSiteKeyTrimmed() {
  return String(process.env.RECAPTCHA_SITE_KEY || '').trim();
}

function getRecaptchaSecretTrimmed() {
  return String(process.env.RECAPTCHA_SECRET_KEY || '').trim();
}

function requirePool(res) {
  if (!pool) {
    const diag = getDbDiagnostics();
    res.status(503).json({
      ok: false,
      error:
        '웹 서비스 프로세스에 PostgreSQL 접속 정보가 없거나 첫 접속에 실패했습니다. 같은 프로젝트의 Postgres와 웹(앱) 서비스를 연결해 Variables에 DATABASE_PRIVATE_URL(또는 DATABASE_URL) 참조를 추가한 뒤 재배포하세요. 브라우저에서 /api/health 를 열어 poolReady·dbEnvHints·lastDbInitError 를 확인할 수 있습니다.',
      diagnostics: { ...diag, lastDbInitError },
      helpUrlPath: '/api/health',
    });
    return false;
  }
  return true;
}

app.use(express.json({ limit: '2mb' }));

app.get('/api/config', (req, res) => {
  const siteKey = getRecaptchaSiteKeyTrimmed();
  res.json({
    ok: true,
    recaptchaSiteKey: siteKey ? siteKey : null,
  });
});

app.get('/api/signup/captcha', (req, res) => {
  const { id, svg } = createSignupCaptchaChallenge();
  res.json({ ok: true, id, svg });
});

app.post('/api/signup/verify-step1', (req, res) => {
  const body = req.body || {};
  const captchaId = String(body.captchaId || '').trim();
  const captchaAnswer = body.captchaAnswer;
  const v = verifySignupCaptchaAndIssueStepPass(captchaId, captchaAnswer);
  if (!v.ok) {
    res.status(400).json({ ok: false, error: v.error });
    return;
  }
  res.json({ ok: true, stepPassToken: v.stepPassToken });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/me', async (req, res) => {
  const secret = getSessionSecret();
  if (!secret || !pool) {
    res.json({ ok: true, user: null });
    return;
  }
  const userId = getUserIdFromRequest(secret, req.headers.cookie || '');
  if (!userId) {
    res.json({ ok: true, user: null });
    return;
  }
  try {
    const r = await pool.query(
      `SELECT id, username, nickname, profile_image AS "profileImage",
              username_cipher, nickname_cipher,
              COALESCE(role, 'user') AS role
       FROM users WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );
    if (r.rowCount === 0) {
      appendClearSessionCookie(res);
      res.json({ ok: true, user: null });
      return;
    }
    const row = r.rows[0];
    res.json({
      ok: true,
      user: {
        id: row.id,
        username: displayUsernameFromRow(row),
        nickname: displayNicknameFromRow(row),
        profileImage: row.profileImage,
        role: row.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/me/owned-characters', async (req, res) => {
  const secret = getSessionSecret();
  if (!secret || !pool) {
    res.status(503).json({ ok: false, error: '서버 설정이 완료되지 않았습니다.' });
    return;
  }
  const userId = getUserIdFromRequest(secret, req.headers.cookie || '');
  if (!userId) {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  if (!requirePool(res)) return;
  try {
    let characters;
    if (characterLibrary) {
      const r = await pool.query(
        `SELECT character_id AS id FROM user_owned_characters WHERE user_id = $1::uuid`,
        [userId]
      );
      characters = [];
      for (const row of r.rows) {
        const id = String(row.id);
        const entry = characterLibrary.byId.get(id);
        if (!entry) continue;
        characters.push({
          id,
          name: entry.name,
          imageUrl: entry.imageUrl || `/api/characters/${id}/image`,
        });
      }
      characters.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    } else {
      const r = await pool.query(
        `SELECT c.id, c.name
         FROM user_owned_characters uoc
         INNER JOIN characters c ON c.id = uoc.character_id
         WHERE uoc.user_id = $1::uuid
         ORDER BY c.name ASC`,
        [userId]
      );
      characters = r.rows.map((row) => {
        const id = String(row.id);
        return {
          id,
          name: row.name,
          imageUrl: `/api/characters/${id}/image`,
        };
      });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, characters });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.patch('/api/me/owned-characters', async (req, res) => {
  if (!requirePool(res)) return;
  const secret = getSessionSecret();
  if (!secret) {
    res.status(503).json({
      ok: false,
      error:
        '요청을 처리할 수 없습니다. SESSION_SECRET 환경 변수를 설정하고 서비스를 재시작하세요.',
    });
    return;
  }
  const userId = getUserIdFromRequest(secret, req.headers.cookie || '');
  if (!userId) {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }
  const body = req.body || {};
  if (!Array.isArray(body.characterIds)) {
    res.status(400).json({ ok: false, error: 'characterIds 배열이 필요합니다.' });
    return;
  }
  const requestedCharacterIds = normalizeCharacterIds(body.characterIds);
  try {
    const validIds = await loadValidCharacterIdSet(pool);
    if (requestedCharacterIds.length > 0 && validIds.size === 0) {
      res.status(503).json({
        ok: false,
        error: '캐릭터 데이터가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      });
      return;
    }
    for (const id of requestedCharacterIds) {
      if (!validIds.has(id)) {
        res.status(400).json({
          ok: false,
          error: '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
        });
        return;
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_owned_characters WHERE user_id = $1::uuid', [userId]);
      for (const cid of requestedCharacterIds) {
        await client.query(
          `INSERT INTO user_owned_characters (user_id, character_id) VALUES ($1, $2::uuid)`,
          [userId, cid]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
    res.json({ ok: true, ownedCharacterCount: requestedCharacterIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/login', async (req, res) => {
  if (!requirePool(res)) return;
  const secret = getSessionSecret();
  if (!secret) {
    res.status(503).json({
      ok: false,
      error:
        '로그인이 비활성화되었습니다. Railway 등에 SESSION_SECRET 환경 변수를 설정하고 서비스를 재시작하세요.',
    });
    return;
  }
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) {
    res.status(400).json({ ok: false, error: '아이디와 비밀번호를 입력해 주세요.' });
    return;
  }
  try {
    let r;
    if (isPiiEncryptionReady()) {
      const blind = usernameBlindIndex(username);
      r = await pool.query(
        `SELECT id, password_hash FROM users
         WHERE username_blind = $1
            OR (
              (username_blind IS NULL OR username_blind = '')
              AND username IS NOT NULL
              AND LOWER(username) = LOWER($2)
            )
         LIMIT 1`,
        [blind, username]
      );
    } else {
      r = await pool.query('SELECT id, password_hash FROM users WHERE username = $1 LIMIT 1', [username]);
    }
    if (r.rowCount === 0) {
      res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    const row = r.rows[0];
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    const token = signSession(secret, row.id);
    appendSessionCookie(res, token);
    const u = await pool.query(
      `SELECT id, username, nickname, profile_image AS "profileImage",
              username_cipher, nickname_cipher,
              COALESCE(role, 'user') AS role
       FROM users WHERE id = $1`,
      [row.id]
    );
    const usr = u.rows[0];
    res.json({
      ok: true,
      user: {
        id: usr.id,
        username: displayUsernameFromRow(usr),
        nickname: displayNicknameFromRow(usr),
        profileImage: usr.profileImage,
        role: usr.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/logout', (req, res) => {
  appendClearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  const diag = getDbDiagnostics();
  const rkSite = Boolean(getRecaptchaSiteKeyTrimmed());
  const rkSecret = Boolean(getRecaptchaSecretTrimmed());
  res.json({
    ok: true,
    database: {
      poolReady: Boolean(pool),
      lastDbInitError,
      ...diag,
    },
    recaptcha: {
      siteKeyConfigured: rkSite,
      secretConfigured: rkSecret,
      signupProtected: rkSite && rkSecret,
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

  let excludeUserId = null;
  const excludeRaw = String(req.query.excludeUserId || '').trim();
  if (excludeRaw && UUID_RE.test(excludeRaw)) {
    const secret = getSessionSecret();
    const sessionUserId = secret ? getUserIdFromRequest(secret, req.headers.cookie || '') : null;
    if (sessionUserId && sessionUserId === excludeRaw) {
      excludeUserId = excludeRaw;
    }
  }

  try {
    const out = { ok: true, usernameAvailable: true, nicknameAvailable: true };
    if (username) {
      if (!USERNAME_RE.test(username)) {
        out.usernameAvailable = false;
      } else if (isPiiEncryptionReady()) {
        const blind = usernameBlindIndex(username);
        const params = excludeUserId ? [blind, username, excludeUserId] : [blind, username];
        const r = await pool.query(
          `SELECT 1 FROM users
           WHERE (
             username_blind = $1
              OR (
                (username_blind IS NULL OR username_blind = '')
                AND username IS NOT NULL
                AND LOWER(username) = LOWER($2)
              )
           )
           ${excludeUserId ? 'AND id <> $3::uuid' : ''}
           LIMIT 1`,
          params
        );
        out.usernameAvailable = r.rowCount === 0;
      } else {
        const r = excludeUserId
          ? await pool.query(
              `SELECT 1 FROM users
               WHERE username IS NOT NULL AND LOWER(username) = LOWER($1)
                 AND id <> $2::uuid
               LIMIT 1`,
              [username, excludeUserId]
            )
          : await pool.query(
              'SELECT 1 FROM users WHERE username IS NOT NULL AND LOWER(username) = LOWER($1) LIMIT 1',
              [username]
            );
        out.usernameAvailable = r.rowCount === 0;
      }
    }
    if (nickname) {
      const nlen = nicknameCodepointLen(nickname);
      if (nlen < NICKNAME_MIN || nlen > NICKNAME_MAX) {
        out.nicknameAvailable = false;
      } else if (isPiiEncryptionReady()) {
        const nb = nicknameBlindIndex(nickname);
        const params = excludeUserId ? [nb, nickname, excludeUserId] : [nb, nickname];
        const r = await pool.query(
          `SELECT 1 FROM users
           WHERE (
             nickname_blind = $1
              OR (
                (nickname_blind IS NULL OR nickname_blind = '')
                AND nickname IS NOT NULL
                AND nickname = $2
              )
           )
           ${excludeUserId ? 'AND id <> $3::uuid' : ''}
           LIMIT 1`,
          params
        );
        out.nicknameAvailable = r.rowCount === 0;
      } else {
        const r = excludeUserId
          ? await pool.query(
              `SELECT 1 FROM users
               WHERE nickname IS NOT NULL AND nickname = $1
                 AND id <> $2::uuid
               LIMIT 1`,
              [nickname, excludeUserId]
            )
          : await pool.query(
              'SELECT 1 FROM users WHERE nickname IS NOT NULL AND nickname = $1 LIMIT 1',
              [nickname]
            );
        out.nicknameAvailable = r.rowCount === 0;
      }
    }

    const adminRows = await loadAdminUserRows(pool);
    if (username && out.usernameAvailable && usernameCollidesWithAdminAccount(username, adminRows, excludeUserId)) {
      out.usernameAvailable = false;
    }
    if (nickname && out.nicknameAvailable && nicknameCollidesWithAdminAccount(nickname, adminRows, excludeUserId)) {
      out.nicknameAvailable = false;
    }

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.patch('/api/me', async (req, res) => {
  if (!requirePool(res)) return;
  const secret = getSessionSecret();
  if (!secret) {
    res.status(503).json({
      ok: false,
      error:
        '프로필 수정이 비활성화되었습니다. SESSION_SECRET 환경 변수를 설정하고 서비스를 재시작하세요.',
    });
    return;
  }
  const userId = getUserIdFromRequest(secret, req.headers.cookie || '');
  if (!userId) {
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return;
  }

  const body = req.body || {};
  const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname');
  const hasProfile = Object.prototype.hasOwnProperty.call(body, 'profileImage');
  if (!hasNickname && !hasProfile) {
    res.status(400).json({
      ok: false,
      error: '변경할 닉네임(nickname) 또는 프로필 이미지(profileImage) 중 하나 이상을 보내 주세요.',
    });
    return;
  }

  let nicknameNext = null;
  if (hasNickname) {
    nicknameNext = String(body.nickname || '').trim();
    const nLen = nicknameCodepointLen(nicknameNext);
    if (nLen < NICKNAME_MIN || nLen > NICKNAME_MAX) {
      res.status(400).json({
        ok: false,
        error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`,
      });
      return;
    }
  }

  let profileNext = undefined;
  if (hasProfile) {
    if (body.profileImage == null) {
      profileNext = null;
    } else {
      profileNext = String(body.profileImage);
      if (profileNext.length > MAX_PROFILE_DATA_URL_LENGTH) {
        res.status(400).json({
          ok: false,
          error: '프로필 이미지가 너무 큽니다. 더 작은 이미지를 사용해 주세요.',
        });
        return;
      }
      if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(profileNext)) {
        res.status(400).json({
          ok: false,
          error: '프로필 이미지는 base64 데이터 URL(image/*) 형식이어야 합니다.',
        });
        return;
      }
    }
  }

  try {
    const sel = await pool.query(
      `SELECT id, username, nickname, profile_image AS "profileImage",
              username_cipher, nickname_cipher
       FROM users WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );
    if (sel.rowCount === 0) {
      appendClearSessionCookie(res);
      res.status(401).json({ ok: false, error: '세션이 만료되었거나 계정을 찾을 수 없습니다.' });
      return;
    }
    const row = sel.rows[0];
    const currentNick = displayNicknameFromRow(row);
    const currentProfile = row.profileImage == null ? '' : String(row.profileImage);

    const nickWillChange = hasNickname && nicknameNext !== currentNick;
    const profileWillChange =
      hasProfile && (profileNext == null ? '' : profileNext) !== currentProfile;

    if (!nickWillChange && !profileWillChange) {
      res.status(400).json({ ok: false, error: '변경된 내용이 없습니다.' });
      return;
    }

    if (nickWillChange) {
      let conflict;
      if (isPiiEncryptionReady()) {
        const nb = nicknameBlindIndex(nicknameNext);
        conflict = await pool.query(
          `SELECT 1 FROM users
           WHERE (
             nickname_blind = $1
              OR (
                (nickname_blind IS NULL OR nickname_blind = '')
                AND nickname IS NOT NULL
                AND nickname = $2
              )
           )
           AND id <> $3::uuid
           LIMIT 1`,
          [nb, nicknameNext, userId]
        );
      } else {
        conflict = await pool.query(
          `SELECT 1 FROM users
           WHERE nickname IS NOT NULL AND nickname = $1 AND id <> $2::uuid
           LIMIT 1`,
          [nicknameNext, userId]
        );
      }
      if (conflict.rowCount > 0) {
        res.status(409).json({ ok: false, error: '다른 사용자가 이미 사용 중인 닉네임입니다.' });
        return;
      }
      const adminRowsPatch = await loadAdminUserRows(pool);
      if (nicknameCollidesWithAdminAccount(nicknameNext, adminRowsPatch, userId)) {
        res.status(409).json({ ok: false, error: '다른 사용자가 이미 사용 중인 닉네임입니다.' });
        return;
      }
    }

    const setParts = [];
    const vals = [];
    let p = 1;
    if (nickWillChange) {
      if (isPiiEncryptionReady()) {
        const nb = nicknameBlindIndex(nicknameNext);
        const nc = encryptUtf8(nicknameNext.trim());
        setParts.push(`nickname = NULL`, `nickname_blind = $${p++}`, `nickname_cipher = $${p++}`);
        vals.push(nb, nc);
      } else {
        setParts.push(`nickname = $${p++}`);
        vals.push(nicknameNext.trim());
      }
    }
    if (profileWillChange) {
      setParts.push(`profile_image = $${p++}`);
      vals.push(profileNext);
    }
    vals.push(userId);

    await pool.query(
      `UPDATE users SET ${setParts.join(', ')} WHERE id = $${p}::uuid`,
      vals
    );

    const out = await pool.query(
      `SELECT id, username, nickname, profile_image AS "profileImage",
              username_cipher, nickname_cipher,
              COALESCE(role, 'user') AS role
       FROM users WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );
    const urow = out.rows[0];
    res.json({
      ok: true,
      user: {
        id: urow.id,
        username: displayUsernameFromRow(urow),
        nickname: displayNicknameFromRow(urow),
        profileImage: urow.profileImage,
        role: urow.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/register', async (req, res) => {
  if (!requirePool(res)) return;
  const body = req.body || {};
  const stepPassToken = String(body.stepPassToken || '').trim();

  if (!isPiiEncryptionReady()) {
    res.status(503).json({
      ok: false,
      error:
        '회원가입 서버 설정이 완료되지 않았습니다. SESSION_SECRET(또는 USER_PII_ENCRYPTION_KEY)을 설정한 뒤 서비스를 재시작해 주세요.',
    });
    return;
  }

  const rkSecret = getRecaptchaSecretTrimmed();
  const rkSite = getRecaptchaSiteKeyTrimmed();
  const recaptchaToken = String(body.recaptchaToken || '').trim();

  if (rkSecret || rkSite) {
    if (!rkSecret || !rkSite) {
      console.warn(
        'reCAPTCHA: RECAPTCHA_SITE_KEY 과 RECAPTCHA_SECRET_KEY 를 함께 설정해야 회원가입 보호가 동작합니다.'
      );
      res.status(503).json({
        ok: false,
        error:
          '회원가입 보안 확인(reCAPTCHA) 설정이 불완전합니다. 관리자에게 문의해 주세요. (SITE_KEY·SECRET 모두 필요)',
      });
      return;
    }
    if (!recaptchaToken) {
      res.status(400).json({
        ok: false,
        error: '보안 확인(Google reCAPTCHA)을 완료한 뒤 다시 시도해 주세요.',
      });
      return;
    }

    try {
      const verify = await verifyRecaptchaResponse({
        secret: rkSecret,
        token: recaptchaToken,
        remoteip: req.ip,
      });
      if (!verify || !verify.success) {
        const codes =
          verify && Array.isArray(verify['error-codes']) ? verify['error-codes'].join(',') : '';
        console.warn('reCAPTCHA 검증 실패:', codes || verify);
        res.status(400).json({
          ok: false,
          error: '보안 확인에 실패했습니다. 확인란을 다시 체크한 뒤 시도해 주세요.',
        });
        return;
      }
    } catch (err) {
      console.error('reCAPTCHA siteverify 오류:', err && err.message ? err.message : err);
      res.status(502).json({
        ok: false,
        error: '보안 확인 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
      return;
    }
  }

  const username = String(body.username || '').trim();
  const nickname = String(body.nickname || '').trim();
  const password = String(body.password || '');
  const profileImageRaw = body.profileImage == null ? '' : String(body.profileImage).trim();
  const profileImage = profileImageRaw === '' ? null : profileImageRaw;

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      ok: false,
      error: '아이디는 영문·숫자·밑줄만 사용하고 8~20자로 입력해 주세요.',
    });
    return;
  }
  const nLen = nicknameCodepointLen(nickname);
  if (nLen < NICKNAME_MIN || nLen > NICKNAME_MAX) {
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

  if (!consumeStepPassToken(stepPassToken)) {
    res.status(400).json({
      ok: false,
      error:
        '회원가입 1단계가 만료되었거나 보안 문자 확인이 완료되지 않았습니다. 첫 단계로 돌아가 보안 문자부터 다시 진행해 주세요.',
    });
    return;
  }

  try {
    const adminRowsRegister = await loadAdminUserRows(pool);
    if (usernameCollidesWithAdminAccount(username, adminRowsRegister, null)) {
      res.status(400).json({
        ok: false,
        error: '다른 사용자가 이미 사용 중인 아이디입니다.',
      });
      return;
    }
    if (nicknameCollidesWithAdminAccount(nickname, adminRowsRegister, null)) {
      res.status(400).json({
        ok: false,
        error: '다른 사용자가 이미 사용 중인 닉네임입니다.',
      });
      return;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
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
    const ub = usernameBlindIndex(username);
    const nb = nicknameBlindIndex(nickname);
    const uCipher = encryptUtf8(normalizeUsername(username));
    const nCipher = encryptUtf8(nickname.trim());
    const profileForInsert = profileImage || getDefaultSignupProfileDataUrl();

    await client.query('BEGIN');
    let userRow;
    try {
      const ins = await client.query(
        `INSERT INTO users (username, nickname, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, profile_image)
         VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6)
         RETURNING id, username_cipher, nickname_cipher, created_at AS "createdAt"`,
        [ub, nb, uCipher, nCipher, passwordHash, profileForInsert || null]
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
        username: displayUsernameFromRow(userRow),
        nickname: displayNicknameFromRow(userRow),
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

app.get('/api/future-sight', async (req, res) => {
  if (!requirePool(res)) return;
  try {
    const r = await pool.query('SELECT data, updated_at AS "updatedAt" FROM site_future_sight WHERE id = 1 LIMIT 1');
    const raw = r.rowCount > 0 ? r.rows[0].data : defaultFutureSightState();
    const maintained = applyFutureSightMonthMaintenance(raw);
    if (maintained.changed || r.rowCount === 0) {
      await pool.query(
        `INSERT INTO site_future_sight (id, data, updated_at)
         VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [JSON.stringify(maintained.state)]
      );
    }
    const data = await hydrateFutureSightState(pool, maintained.state);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, data, updatedAt: r.rows[0]?.updatedAt || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/admin/future-sight', async (req, res) => {
  let admin;
  try {
    admin = await requireAdminUser(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
    return;
  }
  if (!admin) return;

  try {
    const state = applyFutureSightMonthMaintenance(req.body && req.body.data).state;
    const validIds = await loadValidCharacterIdSet(pool);
    for (const month of state.months) {
      for (const entries of Object.values(month.categories)) {
        for (const entry of entries) {
          if (!validIds.has(entry.characterId)) {
            res.status(400).json({
              ok: false,
              error: '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
            });
            return;
          }
        }
      }
    }
    await pool.query(
      `INSERT INTO site_future_sight (id, data, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [JSON.stringify(state)]
    );
    const data = await hydrateFutureSightState(pool, state);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
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

function gracefulShutdown(signal) {
  console.log(`${signal}: 컨테이너 종료 요청을 받았습니다. 연결을 닫는 중…`);
  const forceExit = setTimeout(() => {
    console.error('종료 제한 시간 초과, 프로세스를 종료합니다.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  const done = async () => {
    clearTimeout(forceExit);
    if (pool) {
      try {
        await pool.end();
      } catch (e) {
        console.error(e);
      }
    }
    process.exit(0);
  };

  if (!httpServer) {
    void done();
    return;
  }
  httpServer.close((closeErr) => {
    if (closeErr) console.error(closeErr);
    void done();
  });
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

async function start() {
  await initDb();
  await bootstrapAdminFromEnvIfNeeded(pool);
  characterLibrary = readCharacterLibrarySync(__dirname);
  if (characterLibrary) {
    console.log(`캐릭터 정적 라이브러리 사용: ${characterLibrary.list.length}건 (public/data/characters.json)`);
  }
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on ${PORT}`);
    if (process.env.NODE_ENV === 'production' && !(process.env.SESSION_SECRET || '').trim()) {
      console.warn(
        'SESSION_SECRET이 비어 있습니다. 로그인(POST /api/login)은 동작하지 않습니다. 변수를 추가한 뒤 재배포하세요.'
      );
    }
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
