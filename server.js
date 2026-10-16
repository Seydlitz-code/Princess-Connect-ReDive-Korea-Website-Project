const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { createPoolConfig, getDbEnvDiagnostics } = require('./lib/dbConfig');
const {
  MAX_AGE_SEC: SESSION_MAX_AGE_SEC,
  isProductionLike,
  getSessionSecret,
  signSession,
  getSessionFromRequest,
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
  isPiiKeyDerivedFromSessionSecret,
} = require('./lib/userPiiCrypto');
const { ensureUserPiiSchema } = require('./lib/userPiiSchema');
const {
  createSignupCaptchaChallenge,
  verifySignupCaptchaAndIssueStepPass,
  isStepPassTokenValid,
  consumeStepPassToken,
} = require('./lib/signupCaptcha');
const {
  MAX_POST_HTML_LENGTH,
  sanitizePostHtml,
  extractPostText,
  hasMeaningfulContent,
} = require('./lib/postSanitizer');
const {
  defaultFutureSightState,
  normalizeFutureSightState,
  applyFutureSightMonthMaintenance,
  msUntilNextKstClock,
} = require('./lib/futureSight');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", 'https://www.google.com', 'https://www.gstatic.com'],
        'frame-src': ["'self'", 'https://www.google.com'],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        'font-src': ["'self'", 'https:', 'data:'],
        'img-src': ["'self'", 'data:'],
        // 게시물 동영상은 data: URL 로 본문에 포함된다.
        'media-src': ["'self'", 'data:'],
      },
    },
  })
);
const PORT = Number(process.env.PORT) || 3000;

const BCRYPT_ROUNDS = 11;
const USERNAME_RE = /^[a-zA-Z]{8,20}$/;
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 10;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const MAX_PROFILE_DATA_URL_LENGTH = 600_000;
const PROFILE_DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

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
/** 정적 라이브러리 사용 시 미래시 hydrate 용 메타 캐시 */
let characterLibraryMetaCache = null;

const MAX_OWNED_CHARACTERS_PER_REGISTER = 500;
const FUTURE_SIGHT_MAINTENANCE_KST_HOUR = 0;
const FUTURE_SIGHT_MAINTENANCE_KST_MINUTE = 5;

/** Express 4 는 async 핸들러의 reject 를 잡지 못하므로 오류 미들웨어로 넘긴다. */
const asyncRoute = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function codepointLength(s) {
  return [...String(s || '')].length;
}

/** 한글·영문·일본어(히라가나·가타카나·반각 가타카나·한자 등) 닉네임 허용 */
function isValidNicknameChars(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  return /^[가-힣ㄱ-ㆎa-zA-Z぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]+$/.test(
    t
  );
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

/** blind index(또는 미이전 평문) 기준으로 아이디가 이미 쓰이는지 */
async function isUsernameTaken(username, excludeUserId = null) {
  const params = [usernameBlindIndex(username), username];
  if (excludeUserId) params.push(excludeUserId);
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
  return r.rowCount > 0;
}

async function isNicknameTaken(nickname, excludeUserId = null) {
  const params = [nicknameBlindIndex(nickname), nickname];
  if (excludeUserId) params.push(excludeUserId);
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
  return r.rowCount > 0;
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
    if (!characterLibraryMetaCache) {
      characterLibraryMetaCache = new Map(
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
    return characterLibraryMetaCache;
  }
  const r = await pgPool.query('SELECT id, name FROM characters');
  return new Map(
    r.rows.map((row) => {
      const id = String(row.id);
      return [id, { id, name: row.name, imageUrl: `/api/characters/${encodeURIComponent(id)}/image` }];
    })
  );
}

/** 보유 캐릭터 일괄 저장(한 번의 INSERT) */
async function insertOwnedCharacters(client, userId, characterIds) {
  if (characterIds.length === 0) return;
  await client.query(
    `INSERT INTO user_owned_characters (user_id, character_id)
     SELECT $1::uuid, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [userId, characterIds]
  );
}

/* ───────────── 세션 ───────────── */

/**
 * 쿠키 서명 + user_sessions 행이 모두 유효할 때만 로그인 사용자로 본다.
 * 요청마다 한 번만 조회하도록 req 에 결과를 기억한다.
 * @returns {Promise<{ id: string, role: string } | null>}
 */
async function getSessionUser(req) {
  if (req._sessionUser !== undefined) return req._sessionUser;
  req._sessionUser = null;
  const secret = getSessionSecret();
  if (!secret || !pool) return null;
  const tok = getSessionFromRequest(secret, req.headers.cookie || '');
  if (!tok || !UUID_RE.test(tok.sub) || !UUID_RE.test(tok.sid)) return null;
  const r = await pool.query(
    `SELECT u.id, COALESCE(u.role, 'user') AS role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1::uuid AND s.user_id = $2::uuid AND s.expires_at > NOW()
     LIMIT 1`,
    [tok.sid, tok.sub]
  );
  if (r.rowCount > 0) {
    req._sessionUser = { id: String(r.rows[0].id), role: r.rows[0].role };
  }
  return req._sessionUser;
}

function hasSessionCookie(req) {
  return /(?:^|;\s*)priconne_sid=/.test(req.headers.cookie || '');
}

/** 로그인이 필요한 API 공통 검사. 실패 시 응답을 보내고 null 반환. */
async function requireSessionUser(req, res) {
  if (!requirePool(res)) return null;
  if (!getSessionSecret()) {
    res.status(503).json({
      ok: false,
      error: '로그인 기능을 사용할 수 없습니다. SESSION_SECRET 환경 변수를 설정하고 서비스를 재시작하세요.',
    });
    return null;
  }
  const user = await getSessionUser(req);
  if (!user) {
    if (hasSessionCookie(req)) appendClearSessionCookie(res);
    res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    return null;
  }
  return user;
}

async function requireAdminUser(req, res) {
  const user = await requireSessionUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    return null;
  }
  return user;
}

async function createUserSession(userId) {
  const r = await pool.query(
    `INSERT INTO user_sessions (user_id, expires_at)
     VALUES ($1::uuid, NOW() + make_interval(secs => $2))
     RETURNING id`,
    [userId, SESSION_MAX_AGE_SEC]
  );
  return String(r.rows[0].id);
}

function scheduleExpiredSessionCleanup() {
  const timer = setInterval(() => {
    if (!pool) return;
    pool.query('DELETE FROM user_sessions WHERE expires_at < NOW()').catch((err) => {
      console.error('[session] 만료 세션 정리 실패:', err && err.message ? err.message : err);
    });
  }, 60 * 60 * 1000);
  timer.unref();
}

/** 존재하지 않는 아이디로 로그인할 때도 bcrypt 비교 시간을 들여 아이디 존재 여부가 응답 시간으로 드러나지 않게 한다. */
let dummyPasswordHash = null;
function getDummyPasswordHash() {
  if (!dummyPasswordHash) dummyPasswordHash = bcrypt.hashSync('timing-equalizer-password', BCRYPT_ROUNDS);
  return dummyPasswordHash;
}

/* ───────────── 미래시 ───────────── */

/**
 * 싱글톤 행을 FOR UPDATE 로 잠근 채 갱신한다(관리자 저장과 자동 정리가 서로 덮어쓰지 않도록).
 * @param {(currentData: unknown) => unknown | null} computeNext null 을 반환하면 쓰지 않는다.
 */
async function updateFutureSightLocked(computeNext) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO site_future_sight (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(defaultFutureSightState())]
    );
    const cur = await client.query('SELECT data, updated_at FROM site_future_sight WHERE id = 1 FOR UPDATE');
    const next = computeNext(cur.rows[0].data);
    let updatedAt = cur.rows[0].updated_at;
    if (next) {
      const w = await client.query(
        `UPDATE site_future_sight SET data = $1::jsonb, updated_at = NOW() WHERE id = 1 RETURNING updated_at`,
        [JSON.stringify(next)]
      );
      updatedAt = w.rows[0].updated_at;
    }
    await client.query('COMMIT');
    return { data: next || cur.rows[0].data, updatedAt };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 월이 바뀌었으면 정리 결과를 저장하고 현재 상태를 돌려준다. 바뀐 게 없으면 쓰기 없이 읽기만 한다. */
async function runFutureSightMaintenanceJob(now = new Date()) {
  if (!pool) return { state: defaultFutureSightState(), changed: false, updatedAt: null };
  const r = await pool.query('SELECT data, updated_at FROM site_future_sight WHERE id = 1 LIMIT 1');
  if (r.rowCount > 0) {
    const maintained = applyFutureSightMonthMaintenance(r.rows[0].data, now);
    if (!maintained.changed) return { ...maintained, updatedAt: r.rows[0].updated_at };
  }
  let changed = false;
  const saved = await updateFutureSightLocked((data) => {
    const maintained = applyFutureSightMonthMaintenance(data, now);
    changed = maintained.changed;
    return maintained.changed ? maintained.state : null;
  });
  return { state: normalizeFutureSightState(saved.data), changed, updatedAt: saved.updatedAt };
}

function scheduleFutureSightMaintenanceDaily() {
  const scheduleNext = () => {
    const delayMs = msUntilNextKstClock(
      FUTURE_SIGHT_MAINTENANCE_KST_HOUR,
      FUTURE_SIGHT_MAINTENANCE_KST_MINUTE
    );
    const timer = setTimeout(async () => {
      try {
        const result = await runFutureSightMaintenanceJob();
        if (result.changed) {
          console.log('[future-sight] 월별 유지보수: 이전 달 데이터를 정리했습니다.');
        }
      } catch (err) {
        console.error('[future-sight] 월별 유지보수 실패:', err);
      } finally {
        scheduleNext();
      }
    }, delayMs);
    timer.unref();
  };
  scheduleNext();
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

/* ───────────── 스키마 ───────────── */

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
    CREATE TABLE IF NOT EXISTS user_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);`);
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS clan_board_posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(32) NOT NULL DEFAULT 'general',
      sub_board VARCHAR(32) NOT NULL DEFAULT 'clan-fullauto',
      view_count INTEGER NOT NULL DEFAULT 0,
      is_pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS clan_board_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL REFERENCES clan_board_posts(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS clan_board_likes (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id UUID NOT NULL REFERENCES clan_board_posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, post_id)
    );
  `);
  await client.query(`
    ALTER TABLE clan_board_posts
      ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS sub_board VARCHAR(32) NOT NULL DEFAULT 'clan-fullauto',
      ADD COLUMN IF NOT EXISTS board VARCHAR(32) NOT NULL DEFAULT 'clan',
      ADD COLUMN IF NOT EXISTS year VARCHAR(16),
      ADD COLUMN IF NOT EXISTS month VARCHAR(8),
      ADD COLUMN IF NOT EXISTS stage VARCHAR(8),
      ADD COLUMN IF NOT EXISTS named VARCHAR(8),
      ADD COLUMN IF NOT EXISTS content_text TEXT;
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_clan_board_posts_category ON clan_board_posts(category);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_clan_board_posts_created_at ON clan_board_posts(created_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_clan_board_posts_sub_board ON clan_board_posts(sub_board);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_clan_board_posts_board ON clan_board_posts(board);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_clan_board_comments_post_id ON clan_board_comments(post_id);`);
  // 추천 PK 는 (user_id, post_id) 라 게시물별 추천 수 집계에는 post_id 단독 인덱스가 필요하다.
  await client.query(`CREATE INDEX IF NOT EXISTS idx_clan_board_likes_post_id ON clan_board_likes(post_id);`);
  await migrateLegacyPostContent(client);
}

/**
 * 정제 도입 이전에 저장된 게시물 본문을 한 번 정제하고 검색용 평문(content_text)을 채운다.
 * content_text 가 NULL 인 행만 대상이라 재기동 시 반복되지 않는다.
 */
async function migrateLegacyPostContent(client) {
  let migrated = 0;
  for (;;) {
    const r = await client.query(
      `SELECT id, content FROM clan_board_posts WHERE content_text IS NULL LIMIT 50`
    );
    if (r.rowCount === 0) break;
    for (const row of r.rows) {
      const html = sanitizePostHtml(row.content);
      await client.query(
        `UPDATE clan_board_posts SET content = $2, content_text = $3 WHERE id = $1`,
        [row.id, html, extractPostText(html)]
      );
      migrated += 1;
    }
  }
  if (migrated > 0) console.log(`[clan-board] 기존 게시물 ${migrated}건의 본문을 정제했습니다.`);
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
        '[admin_bootstrap] ADMIN_USERNAME 형식이 올바르지 않습니다. (영문 8~20자)'
      );
      return;
    }
    const nLen = codepointLength(nickname);
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
        console.log('PostgreSQL 연결 및 테이블 준비 완료');
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

/** 운영에서는 환경 변수 이름·오류 원문을 외부에 노출하지 않는다. */
function getPublicDbDiagnostics() {
  const diag = getDbEnvDiagnostics();
  if (!isProductionLike()) return { ...diag, lastDbInitError };
  return {
    dbEnvHints: diag.dbEnvHints,
    postgresUriKeyCount: diag.postgresUriKeyCount,
    lastDbInitError: lastDbInitError
      ? { kind: lastDbInitError.kind, code: lastDbInitError.code }
      : null,
  };
}

function getRecaptchaSiteKeyTrimmed() {
  return String(process.env.RECAPTCHA_SITE_KEY || '').trim();
}

function getRecaptchaSecretTrimmed() {
  return String(process.env.RECAPTCHA_SECRET_KEY || '').trim();
}

/**
 * 운영에서는 reCAPTCHA(사이트 키 + 시크릿)가 모두 설정돼야 회원가입을 연다.
 * 개발에서는 보안 문자만으로도 가입할 수 있다.
 */
function getSignupProtection() {
  const site = getRecaptchaSiteKeyTrimmed();
  const secret = getRecaptchaSecretTrimmed();
  const recaptchaConfigured = Boolean(site && secret);
  const partial = Boolean(site || secret) && !recaptchaConfigured;
  const available = recaptchaConfigured || (!partial && !isProductionLike());
  return { site, secret, recaptchaConfigured, partial, available };
}

const SIGNUP_UNAVAILABLE_ERROR =
  '회원가입이 일시 중단되었습니다. 관리자에게 문의해 주세요. (보안 확인 reCAPTCHA 설정 필요)';

function requirePool(res) {
  if (!pool) {
    res.status(503).json({
      ok: false,
      error:
        '웹 서비스 프로세스에 PostgreSQL 접속 정보가 없거나 첫 접속에 실패했습니다. 같은 프로젝트의 Postgres와 웹(앱) 서비스를 연결해 Variables에 DATABASE_PRIVATE_URL(또는 DATABASE_URL) 참조를 추가한 뒤 재배포하세요. 브라우저에서 /api/health 를 열어 poolReady·dbEnvHints·lastDbInitError 를 확인할 수 있습니다.',
      diagnostics: getPublicDbDiagnostics(),
      helpUrlPath: '/api/health',
    });
    return false;
  }
  return true;
}

function publicUserFromRow(row) {
  return {
    id: row.id,
    username: displayUsernameFromRow(row),
    nickname: displayNicknameFromRow(row),
    profileImage: row.profileImage,
    role: row.role,
  };
}

async function loadPublicUser(userId) {
  const r = await pool.query(
    `SELECT id, username, nickname, profile_image AS "profileImage",
            username_cipher, nickname_cipher,
            COALESCE(role, 'user') AS role
     FROM users WHERE id = $1::uuid LIMIT 1`,
    [userId]
  );
  return r.rowCount > 0 ? publicUserFromRow(r.rows[0]) : null;
}

/* ───────────── 미들웨어 ───────────── */

/**
 * 정적 파일은 rate limit 앞에 둔다. 캐릭터 이미지가 332장이라 목록 한 번 스크롤로도
 * 전역 한도를 넘겨 API 까지 429 가 나던 문제를 막고, 이미지·폰트는 브라우저 캐시를 쓰게 한다.
 */
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, filePath) {
      const rel = path.relative(PUBLIC_DIR, filePath).replace(/\\/g, '/');
      if (rel.startsWith('fonts/')) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      } else if (rel.startsWith('characters/') || rel.startsWith('images/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else {
        // index.html·main.js·main.css·characters.json 은 배포 즉시 반영되도록 매번 재검증(ETag)
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});
app.use('/api', apiLimiter);

/*
 * 로그인(무차별 대입 방지)과 가입 흐름(캡차·중복 확인·가입)은 한도를 따로 센다.
 * 예전에는 한 limiter 를 다섯 경로가 공유해 가입 한 번(캡차·중복확인 2회·1단계·가입·로그인)만으로
 * 분당 10회에 걸려 정상 사용자가 막혔다.
 */
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});
const signupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '너무 많은 시도입니다. 잠시 후 다시 시도해 주세요.' },
});
app.use('/api/login', loginLimiter);
app.use(['/api/register', '/api/signup', '/api/users/check'], signupLimiter);

/** 게시판 쓰기(작성·수정·삭제·댓글·추천)만 따로 제한. 조회·조회수 증가는 전역 한도만 적용. */
const clanBoardWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.path.endsWith('/view'),
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});
app.use('/api/clan-board', clanBoardWriteLimiter);

app.use('/api', express.json({ limit: '2mb' }));

/* ───────────── 공개 설정 · 회원가입 ───────────── */

app.get('/api/config', (req, res) => {
  const protection = getSignupProtection();
  res.json({
    ok: true,
    recaptchaSiteKey: protection.recaptchaConfigured ? protection.site : null,
    signupAvailable: protection.available,
  });
});

app.get('/api/signup/captcha', (req, res) => {
  if (!getSignupProtection().available) {
    res.status(503).json({ ok: false, error: SIGNUP_UNAVAILABLE_ERROR });
    return;
  }
  const { id, svg } = createSignupCaptchaChallenge();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, id, svg });
});

app.post('/api/signup/verify-step1', (req, res) => {
  if (!getSignupProtection().available) {
    res.status(503).json({ ok: false, error: SIGNUP_UNAVAILABLE_ERROR });
    return;
  }
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

/* ───────────── 내 정보 ───────────── */

app.get('/api/me', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!getSessionSecret() || !pool) {
    res.json({ ok: true, user: null });
    return;
  }
  const sessionUser = await getSessionUser(req);
  const user = sessionUser ? await loadPublicUser(sessionUser.id) : null;
  if (!user && hasSessionCookie(req)) appendClearSessionCookie(res);
  res.json({ ok: true, user });
}));

app.get('/api/me/owned-characters', asyncRoute(async (req, res) => {
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;
  let characters;
  if (characterLibrary) {
    const r = await pool.query(
      `SELECT character_id AS id FROM user_owned_characters WHERE user_id = $1::uuid`,
      [sessionUser.id]
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
      [sessionUser.id]
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
}));

app.patch('/api/me/owned-characters', asyncRoute(async (req, res) => {
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;
  const body = req.body || {};
  if (!Array.isArray(body.characterIds)) {
    res.status(400).json({ ok: false, error: 'characterIds 배열이 필요합니다.' });
    return;
  }
  const requestedCharacterIds = normalizeCharacterIds(body.characterIds);
  const validIds = await loadValidCharacterIdSet(pool);
  if (requestedCharacterIds.length > 0 && validIds.size === 0) {
    res.status(503).json({
      ok: false,
      error: '캐릭터 데이터가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
    });
    return;
  }
  if (requestedCharacterIds.some((id) => !validIds.has(id))) {
    res.status(400).json({
      ok: false,
      error: '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_owned_characters WHERE user_id = $1::uuid', [sessionUser.id]);
    await insertOwnedCharacters(client, sessionUser.id, requestedCharacterIds);
    await client.query('COMMIT');
  } catch (txErr) {
    await client.query('ROLLBACK').catch(() => {});
    throw txErr;
  } finally {
    client.release();
  }
  res.json({ ok: true, ownedCharacterCount: requestedCharacterIds.length });
}));

/* ───────────── 로그인 ───────────── */

app.post('/api/login', asyncRoute(async (req, res) => {
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
  if (username.length > 64 || password.length > PASSWORD_MAX) {
    res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    return;
  }
  let r;
  if (isPiiEncryptionReady()) {
    r = await pool.query(
      `SELECT id, password_hash FROM users
       WHERE username_blind = $1
          OR (
            (username_blind IS NULL OR username_blind = '')
            AND username IS NOT NULL
            AND LOWER(username) = LOWER($2)
          )
       LIMIT 1`,
      [usernameBlindIndex(username), username]
    );
  } else {
    r = await pool.query('SELECT id, password_hash FROM users WHERE username = $1 LIMIT 1', [username]);
  }
  const row = r.rows[0];
  const match = await bcrypt.compare(password, row ? row.password_hash : getDummyPasswordHash());
  if (!row || !match) {
    res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    return;
  }
  const sid = await createUserSession(row.id);
  appendSessionCookie(res, signSession(secret, row.id, sid));
  res.json({ ok: true, user: await loadPublicUser(row.id) });
}));

app.post('/api/logout', asyncRoute(async (req, res) => {
  const secret = getSessionSecret();
  const tok = secret ? getSessionFromRequest(secret, req.headers.cookie || '') : null;
  if (pool && tok && UUID_RE.test(tok.sid)) {
    await pool.query('DELETE FROM user_sessions WHERE id = $1::uuid', [tok.sid]);
  }
  appendClearSessionCookie(res);
  res.json({ ok: true });
}));

app.get('/api/health', (req, res) => {
  const protection = getSignupProtection();
  res.json({
    ok: true,
    database: {
      poolReady: Boolean(pool),
      ...getPublicDbDiagnostics(),
    },
    recaptcha: {
      siteKeyConfigured: Boolean(protection.site),
      secretConfigured: Boolean(protection.secret),
      signupProtected: protection.recaptchaConfigured,
      signupAvailable: protection.available,
    },
    hint:
      'poolReady가 false이면 Railway 웹 서비스에 Postgres의 DATABASE_PRIVATE_URL(또는 DATABASE_URL) 변수 **참조**를 추가하고 재배포하세요. Postgres 서비스 이름이 "Postgres"가 아니면 참조 문법의 서비스명도 맞춥니다.',
  });
});

app.get('/api/users/check', asyncRoute(async (req, res) => {
  if (!requirePool(res)) return;
  const username = String(req.query.username || '').trim();
  const nickname = String(req.query.nickname || '').trim();
  if (!username && !nickname) {
    res.status(400).json({ ok: false, error: 'username 또는 nickname 쿼리가 필요합니다.' });
    return;
  }

  // 본인 닉네임 재확인(마이페이지)일 때만 자기 자신을 제외한다.
  let excludeUserId = null;
  const excludeRaw = String(req.query.excludeUserId || '').trim();
  if (excludeRaw && UUID_RE.test(excludeRaw)) {
    const sessionUser = await getSessionUser(req);
    if (sessionUser && sessionUser.id === excludeRaw) excludeUserId = excludeRaw;
  }

  const out = { ok: true, usernameAvailable: true, nicknameAvailable: true };
  if (username) {
    if (!USERNAME_RE.test(username)) {
      out.usernameAvailable = false;
    } else if (isPiiEncryptionReady()) {
      out.usernameAvailable = !(await isUsernameTaken(username, excludeUserId));
    } else {
      const r = await pool.query(
        `SELECT 1 FROM users
         WHERE username IS NOT NULL AND LOWER(username) = LOWER($1)
           ${excludeUserId ? 'AND id <> $2::uuid' : ''}
         LIMIT 1`,
        excludeUserId ? [username, excludeUserId] : [username]
      );
      out.usernameAvailable = r.rowCount === 0;
    }
  }
  if (nickname) {
    const nlen = codepointLength(nickname);
    if (nlen < NICKNAME_MIN || nlen > NICKNAME_MAX) {
      out.nicknameAvailable = false;
    } else if (!isValidNicknameChars(nickname)) {
      res.status(400).json({
        ok: false,
        error: '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.',
      });
      return;
    } else if (isPiiEncryptionReady()) {
      out.nicknameAvailable = !(await isNicknameTaken(nickname, excludeUserId));
    } else {
      const r = await pool.query(
        `SELECT 1 FROM users
         WHERE nickname IS NOT NULL AND nickname = $1
           ${excludeUserId ? 'AND id <> $2::uuid' : ''}
         LIMIT 1`,
        excludeUserId ? [nickname, excludeUserId] : [nickname]
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
}));

app.patch('/api/me', asyncRoute(async (req, res) => {
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;
  const userId = sessionUser.id;

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
    const nLen = codepointLength(nicknameNext);
    if (nLen < NICKNAME_MIN || nLen > NICKNAME_MAX) {
      res.status(400).json({
        ok: false,
        error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`,
      });
      return;
    }
    if (!isValidNicknameChars(nicknameNext)) {
      res.status(400).json({
        ok: false,
        error: '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.',
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
      if (!PROFILE_DATA_URL_RE.test(profileNext)) {
        res.status(400).json({
          ok: false,
          error: '프로필 이미지는 PNG·JPEG·WebP·GIF base64 데이터 URL 형식이어야 합니다.',
        });
        return;
      }
    }
  }

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
    let taken;
    if (isPiiEncryptionReady()) {
      taken = await isNicknameTaken(nicknameNext, userId);
    } else {
      const conflict = await pool.query(
        `SELECT 1 FROM users
         WHERE nickname IS NOT NULL AND nickname = $1 AND id <> $2::uuid
         LIMIT 1`,
        [nicknameNext, userId]
      );
      taken = conflict.rowCount > 0;
    }
    if (taken || nicknameCollidesWithAdminAccount(nicknameNext, await loadAdminUserRows(pool), userId)) {
      res.status(409).json({ ok: false, error: '다른 사용자가 이미 사용 중인 닉네임입니다.' });
      return;
    }
  }

  const setParts = [];
  const vals = [];
  let p = 1;
  if (nickWillChange) {
    if (isPiiEncryptionReady()) {
      setParts.push(`nickname = NULL`, `nickname_blind = $${p++}`, `nickname_cipher = $${p++}`);
      vals.push(nicknameBlindIndex(nicknameNext), encryptUtf8(nicknameNext.trim()));
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

  try {
    await pool.query(`UPDATE users SET ${setParts.join(', ')} WHERE id = $${p}::uuid`, vals);
  } catch (err) {
    if (err.code === '23505') {
      res.status(409).json({ ok: false, error: '다른 사용자가 이미 사용 중인 닉네임입니다.' });
      return;
    }
    throw err;
  }

  res.json({ ok: true, user: await loadPublicUser(userId) });
}));

app.post('/api/register', asyncRoute(async (req, res) => {
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

  const protection = getSignupProtection();
  if (protection.partial) {
    console.warn(
      'reCAPTCHA: RECAPTCHA_SITE_KEY 과 RECAPTCHA_SECRET_KEY 를 함께 설정해야 회원가입 보호가 동작합니다.'
    );
  }
  if (!protection.available) {
    res.status(503).json({ ok: false, error: SIGNUP_UNAVAILABLE_ERROR });
    return;
  }

  const username = String(body.username || '').trim();
  const nickname = String(body.nickname || '').trim();
  const password = String(body.password || '');
  const profileImageRaw = body.profileImage == null ? '' : String(body.profileImage).trim();
  const profileImage = profileImageRaw === '' ? null : profileImageRaw;

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({
      ok: false,
      error: '아이디는 영문만 사용하고 8~20자로 입력해 주세요.',
    });
    return;
  }
  const nLen = codepointLength(nickname);
  if (nLen < NICKNAME_MIN || nLen > NICKNAME_MAX) {
    res.status(400).json({
      ok: false,
      error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`,
    });
    return;
  }
  if (!isValidNicknameChars(nickname)) {
    res.status(400).json({
      ok: false,
      error: '닉네임은 한국어, 영어, 일본어 문자만 사용할 수 있습니다.',
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
  if (profileImage && !PROFILE_DATA_URL_RE.test(profileImage)) {
    res.status(400).json({ ok: false, error: '프로필 이미지는 PNG·JPEG·WebP·GIF base64 데이터 URL 형식이어야 합니다.' });
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

  // 1단계 통과 토큰은 여기서 확인만 하고, 실제 가입 직전에 소모한다(중복 등 검증 실패 시 1단계 재진행 방지).
  if (!isStepPassTokenValid(stepPassToken)) {
    res.status(400).json({
      ok: false,
      error:
        '회원가입 1단계가 만료되었거나 보안 문자 확인이 완료되지 않았습니다. 첫 단계로 돌아가 보안 문자부터 다시 진행해 주세요.',
    });
    return;
  }

  const validIds = await loadValidCharacterIdSet(pool);
  if (validIds.size === 0 && (requestedCharacterIds.length > 0 || !deferOwnedCharacters)) {
    res.status(503).json({
      ok: false,
      error: '캐릭터 데이터가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
    });
    return;
  }
  if (requestedCharacterIds.some((id) => !validIds.has(id))) {
    res.status(400).json({
      ok: false,
      error: '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    });
    return;
  }

  const adminRows = await loadAdminUserRows(pool);
  if (usernameCollidesWithAdminAccount(username, adminRows, null) || (await isUsernameTaken(username))) {
    res.status(409).json({ ok: false, error: '다른 사용자가 이미 사용 중인 아이디입니다.' });
    return;
  }
  if (nicknameCollidesWithAdminAccount(nickname, adminRows, null) || (await isNicknameTaken(nickname))) {
    res.status(409).json({ ok: false, error: '다른 사용자가 이미 사용 중인 닉네임입니다.' });
    return;
  }

  if (protection.recaptchaConfigured) {
    const recaptchaToken = String(body.recaptchaToken || '').trim();
    if (!recaptchaToken) {
      res.status(400).json({
        ok: false,
        error: '보안 확인(Google reCAPTCHA)을 완료한 뒤 다시 시도해 주세요.',
      });
      return;
    }
    let verify;
    try {
      verify = await verifyRecaptchaResponse({
        secret: protection.secret,
        token: recaptchaToken,
        remoteip: req.ip,
      });
    } catch (err) {
      console.error('reCAPTCHA siteverify 오류:', err && err.message ? err.message : err);
      res.status(502).json({
        ok: false,
        error: '보안 확인 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
      return;
    }
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
  }

  if (!consumeStepPassToken(stepPassToken)) {
    res.status(400).json({
      ok: false,
      error:
        '회원가입 1단계가 만료되었거나 보안 문자 확인이 완료되지 않았습니다. 첫 단계로 돌아가 보안 문자부터 다시 진행해 주세요.',
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const profileForInsert = profileImage || getDefaultSignupProfileDataUrl();

  const client = await pool.connect();
  let userRow;
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO users (username, nickname, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, profile_image)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6)
       RETURNING id, username_cipher, nickname_cipher, created_at AS "createdAt"`,
      [
        usernameBlindIndex(username),
        nicknameBlindIndex(nickname),
        encryptUtf8(normalizeUsername(username)),
        encryptUtf8(nickname),
        passwordHash,
        profileForInsert || null,
      ]
    );
    userRow = ins.rows[0];
    await insertOwnedCharacters(client, userRow.id, requestedCharacterIds);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      res.status(409).json({ ok: false, error: '이미 사용 중인 아이디 또는 닉네임입니다.' });
      return;
    }
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({
    ok: true,
    user: {
      id: userRow.id,
      username: displayUsernameFromRow(userRow),
      nickname: displayNicknameFromRow(userRow),
      createdAt: userRow.createdAt,
    },
    ownedCharacterCount: requestedCharacterIds.length,
    deferOwnedCharacters,
  });
}));

/* ───────────── 미래시 API ───────────── */

app.get('/api/future-sight', asyncRoute(async (req, res) => {
  if (!requirePool(res)) return;
  const maintained = await runFutureSightMaintenanceJob();
  const data = await hydrateFutureSightState(pool, maintained.state);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ ok: true, data, updatedAt: maintained.updatedAt || null });
}));

app.put('/api/admin/future-sight', asyncRoute(async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;

  const state = applyFutureSightMonthMaintenance(req.body && req.body.data).state;
  const validIds = await loadValidCharacterIdSet(pool);
  for (const month of state.months) {
    for (const entries of Object.values(month.categories)) {
      if (entries.some((entry) => !validIds.has(entry.characterId))) {
        res.status(400).json({
          ok: false,
          error: '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
        });
        return;
      }
    }
  }
  await updateFutureSightLocked(() => state);
  const data = await hydrateFutureSightState(pool, state);
  res.json({ ok: true, data });
}));

/* ───────────── 캐릭터 ───────────── */

app.get('/api/characters', asyncRoute(async (req, res) => {
  if (characterLibrary) {
    res.setHeader('Cache-Control', 'public, max-age=300');
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
}));

app.get('/api/characters/:id/image', asyncRoute(async (req, res) => {
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
}));

/* ───────────── 게시판 ───────────── */

function clanBoardRequirePool(res) {
  if (!pool) {
    res.status(503).json({ ok: false, error: '데이터베이스 연결 준비 중입니다.' });
    return false;
  }
  return true;
}

/** 게시물 id 가 UUID 가 아니면 DB 형변환 오류(500) 대신 404 */
app.param('postId', (req, res, next, postId) => {
  if (!UUID_RE.test(String(postId))) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }
  next();
});

const CLAN_BOARD_BOARDS = ['clan', 'free'];
const CLAN_BOARD_VALID_CATEGORIES = ['none', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5'];
const CLAN_BOARD_VALID_SUB_BOARDS = ['clan-semi', 'clan-fullauto'];
const CLAN_BOARD_TITLE_MAX = 50;
const CLAN_BOARD_COMMENT_MAX = 2000;
const CLAN_BOARD_SEARCH_MAX = 100;
/** 게시물 구분(클랜전 게시판 전용) — index.html 의 선택지와 동일 */
const CLAN_POST_CLASSIFIERS = {
  year: /^(before\d{4}|\d{4})$/,
  month: /^(1[0-2]|[1-9])$/,
  stage: /^[1-4]$/,
  named: /^[1-5]$/,
};

/** 클랜전 글은 연도·월·단계·네임드 필수(네임드 → category phaseN), 자유 게시판은 구분 없음 */
function parsePostClassification(body, board) {
  if (board !== 'clan') {
    return { ok: true, values: { year: null, month: null, stage: null, named: null, category: 'none' } };
  }
  const values = {};
  for (const [key, re] of Object.entries(CLAN_POST_CLASSIFIERS)) {
    const v = String((body && body[key]) || '').trim();
    if (!re.test(v)) return { ok: false, error: '게시물 구분(연도·월·단계·네임드)을 모두 선택해 주세요.' };
    values[key] = v;
  }
  values.category = `phase${values.named}`;
  return { ok: true, values };
}

/** 제목·본문 공통 검증 + 본문 정제. 실패 시 { error } */
function preparePostContent(body) {
  const title = String((body && body.title) || '').trim();
  const rawContent = String((body && body.content) || '');
  if (!title) return { error: '제목을 입력해 주세요.' };
  if (codepointLength(title) > CLAN_BOARD_TITLE_MAX) {
    return { error: `게시물 제목은 ${CLAN_BOARD_TITLE_MAX}자 이내로만 작성 가능합니다.` };
  }
  if (rawContent.length > MAX_POST_HTML_LENGTH) {
    return { error: '본문 용량이 너무 큽니다. 이미지·동영상 크기를 줄여 주세요.' };
  }
  const content = sanitizePostHtml(rawContent);
  const contentText = extractPostText(content);
  if (!hasMeaningfulContent(content, contentText)) return { error: '내용을 입력해 주세요.' };
  return { title, content, contentText };
}

function escapeLikePattern(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** 같은 사람이 같은 글을 새로고침해도 조회수가 계속 오르지 않도록(메모리, 6시간) */
const VIEW_DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;
const VIEW_DEDUPE_MAX = 100_000;
const recentPostViews = new Map();

function shouldCountPostView(viewerKey, postId) {
  const key = `${viewerKey}|${postId}`;
  const now = Date.now();
  const seenAt = recentPostViews.get(key);
  if (seenAt && now - seenAt < VIEW_DEDUPE_TTL_MS) return false;
  recentPostViews.delete(key);
  recentPostViews.set(key, now);
  if (recentPostViews.size > VIEW_DEDUPE_MAX) {
    recentPostViews.delete(recentPostViews.keys().next().value);
  }
  return true;
}

function toIso(value) {
  return value?.toISOString?.() || value || null;
}

function mapPostListRow(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    year: row.year,
    month: row.month,
    stage: row.stage,
    named: row.named,
    view_count: row.view_count,
    like_count: Number(row.like_count) || 0,
    comment_count: Number(row.comment_count) || 0,
    is_pinned: row.is_pinned,
    created_at: toIso(row.created_at),
    author: {
      nickname: displayNicknameFromRow({ nickname: row.nickname, nickname_cipher: row.nickname_cipher }),
    },
  };
}

app.get('/api/clan-board/posts', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(40, Math.max(1, parseInt(String(req.query.limit || '40'), 10) || 40));
  const board = String(req.query.board || 'clan').trim();
  if (!CLAN_BOARD_BOARDS.includes(board)) {
    res.status(400).json({ ok: false, error: '올바른 게시판이 아닙니다.' });
    return;
  }
  const category = String(req.query.category || '').trim();
  const subBoard = String(req.query.sub_board || '').trim();
  const search = String(req.query.search || '').trim().slice(0, CLAN_BOARD_SEARCH_MAX);

  const params = [board];
  const conditions = ['p.board = $1'];
  const addCondition = (sqlWithPlaceholder, value) => {
    params.push(value);
    conditions.push(sqlWithPlaceholder.replace('?', `$${params.length}`));
  };

  if (CLAN_BOARD_VALID_CATEGORIES.includes(category)) addCondition('p.category = ?', category);
  if (CLAN_BOARD_VALID_SUB_BOARDS.includes(subBoard)) addCondition('p.sub_board = ?', subBoard);
  for (const key of ['year', 'month', 'stage']) {
    const v = String(req.query[key] || '').trim();
    if (CLAN_POST_CLASSIFIERS[key].test(v)) addCondition(`p.${key} = ?`, v);
  }
  const named = String(req.query.named || '').trim();
  if (CLAN_POST_CLASSIFIERS.named.test(named)) addCondition('p.category = ?', `phase${named}`);
  if (search) {
    params.push(`%${escapeLikePattern(search)}%`);
    conditions.push(`(p.title ILIKE $${params.length} OR p.content_text ILIKE $${params.length})`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const selectColumns = `
    p.id, p.title, p.category, p.year, p.month, p.stage, p.named,
    p.view_count, p.is_pinned, p.created_at,
    u.nickname, u.nickname_cipher,
    (SELECT COUNT(*) FROM clan_board_comments c WHERE c.post_id = p.id) AS comment_count,
    (SELECT COUNT(*) FROM clan_board_likes l WHERE l.post_id = p.id) AS like_count
  `;

  let pinnedPosts = [];
  if (page === 1) {
    const pinnedResult = await pool.query(
      `SELECT ${selectColumns}
       FROM clan_board_posts p
       JOIN users u ON p.author_id = u.id
       ${whereClause} AND p.is_pinned = true
       ORDER BY p.created_at DESC`,
      params
    );
    pinnedPosts = pinnedResult.rows.map(mapPostListRow);
  }

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM clan_board_posts p ${whereClause} AND p.is_pinned = false`,
    params
  );
  const total = totalResult.rows[0].total;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;

  const result = await pool.query(
    `SELECT ${selectColumns}
     FROM clan_board_posts p
     JOIN users u ON p.author_id = u.id
     ${whereClause} AND p.is_pinned = false
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    posts: [...pinnedPosts, ...result.rows.map(mapPostListRow)],
    pinned: pinnedPosts,
    pagination: { page: safePage, limit, total, totalPages },
  });
}));

app.get('/api/clan-board/posts/:postId', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const { postId } = req.params;
  const sessionUser = await getSessionUser(req);

  const result = await pool.query(
    `SELECT
       p.id, p.title, p.content, p.category, p.year, p.month, p.stage, p.named,
       p.board, p.sub_board, p.view_count, p.created_at, p.updated_at, p.author_id,
       u.nickname, u.nickname_cipher,
       (SELECT COUNT(*) FROM clan_board_likes l WHERE l.post_id = p.id) AS like_count,
       (SELECT COUNT(*) FROM clan_board_comments c WHERE c.post_id = p.id) AS comment_count,
       EXISTS (
         SELECT 1 FROM clan_board_likes l WHERE l.post_id = p.id AND l.user_id = $2::uuid
       ) AS liked
     FROM clan_board_posts p
     JOIN users u ON p.author_id = u.id
     WHERE p.id = $1::uuid
     LIMIT 1`,
    [postId, sessionUser ? sessionUser.id : null]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }
  const row = result.rows[0];
  const isAuthor = Boolean(sessionUser && String(row.author_id) === sessionUser.id);
  const isAdmin = Boolean(sessionUser && sessionUser.role === 'admin');

  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    ok: true,
    post: {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      year: row.year,
      month: row.month,
      stage: row.stage,
      named: row.named,
      board: row.board,
      sub_board: row.sub_board,
      view_count: row.view_count,
      like_count: Number(row.like_count) || 0,
      comment_count: Number(row.comment_count) || 0,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      author: {
        nickname: displayNicknameFromRow({ nickname: row.nickname, nickname_cipher: row.nickname_cipher }),
      },
      liked: Boolean(row.liked),
      can_edit: isAuthor,
      can_delete: isAuthor || isAdmin,
    },
  });
}));

app.patch('/api/clan-board/posts/:postId/view', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const { postId } = req.params;
  const sessionUser = await getSessionUser(req);
  const viewerKey = sessionUser ? `u:${sessionUser.id}` : `ip:${req.ip}`;
  if (!shouldCountPostView(viewerKey, postId)) {
    const cur = await pool.query(`SELECT view_count FROM clan_board_posts WHERE id = $1::uuid`, [postId]);
    if (cur.rowCount === 0) {
      res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
      return;
    }
    res.json({ ok: true, view_count: cur.rows[0].view_count, counted: false });
    return;
  }
  const result = await pool.query(
    `UPDATE clan_board_posts SET view_count = view_count + 1 WHERE id = $1::uuid RETURNING view_count`,
    [postId]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }
  res.json({ ok: true, view_count: result.rows[0].view_count, counted: true });
}));

app.post('/api/clan-board/posts/:postId/likes', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;
  const { postId } = req.params;
  const postCheck = await pool.query(`SELECT 1 FROM clan_board_posts WHERE id = $1::uuid LIMIT 1`, [postId]);
  if (postCheck.rowCount === 0) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }

  // 삭제를 먼저 시도하고, 지운 게 없으면 추가한다(동시 클릭에도 PK 충돌 없이 토글).
  const removed = await pool.query(
    `DELETE FROM clan_board_likes WHERE user_id = $1::uuid AND post_id = $2::uuid`,
    [sessionUser.id, postId]
  );
  let liked = false;
  if (removed.rowCount === 0) {
    await pool.query(
      `INSERT INTO clan_board_likes (user_id, post_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
      [sessionUser.id, postId]
    );
    liked = true;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM clan_board_likes WHERE post_id = $1::uuid`,
    [postId]
  );
  res.json({ ok: true, liked, like_count: countResult.rows[0].count });
}));

app.get('/api/clan-board/posts/:postId/comments', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const { postId } = req.params;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM clan_board_comments WHERE post_id = $1::uuid`,
    [postId]
  );
  const total = totalResult.rows[0].total;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;

  const result = await pool.query(
    `SELECT
       c.id, c.content, c.created_at,
       u.nickname, u.nickname_cipher, u.profile_image AS author_profile_image
     FROM clan_board_comments c
     JOIN users u ON c.author_id = u.id
     WHERE c.post_id = $1::uuid
     ORDER BY c.created_at ASC
     LIMIT $2 OFFSET $3`,
    [postId, limit, offset]
  );

  const comments = result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    created_at: toIso(row.created_at),
    author: {
      nickname: displayNicknameFromRow({ nickname: row.nickname, nickname_cipher: row.nickname_cipher }),
      profileImage: row.author_profile_image || null,
    },
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, comments, pagination: { page: safePage, limit, total, totalPages } });
}));

app.post('/api/clan-board/posts', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;

  const body = req.body || {};
  const board = String(body.board || 'clan').trim();
  if (!CLAN_BOARD_BOARDS.includes(board)) {
    res.status(400).json({ ok: false, error: '올바른 게시판을 선택해 주세요.' });
    return;
  }
  let subBoard = 'none';
  if (board === 'clan') {
    subBoard = String(body.sub_board || 'clan-fullauto').trim();
    if (!CLAN_BOARD_VALID_SUB_BOARDS.includes(subBoard)) {
      res.status(400).json({ ok: false, error: '올바른 게시판을 선택해 주세요.' });
      return;
    }
  }
  const classification = parsePostClassification(body, board);
  if (!classification.ok) {
    res.status(400).json({ ok: false, error: classification.error });
    return;
  }
  const prepared = preparePostContent(body);
  if (prepared.error) {
    res.status(400).json({ ok: false, error: prepared.error });
    return;
  }
  const c = classification.values;

  const result = await pool.query(
    `INSERT INTO clan_board_posts
       (author_id, title, content, content_text, category, sub_board, board, year, month, stage, named)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [sessionUser.id, prepared.title, prepared.content, prepared.contentText, c.category, subBoard, board, c.year, c.month, c.stage, c.named]
  );
  res.status(201).json({ ok: true, id: result.rows[0].id });
}));

app.patch('/api/clan-board/posts/:postId', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;
  const { postId } = req.params;

  const postResult = await pool.query(
    `SELECT author_id, board FROM clan_board_posts WHERE id = $1::uuid LIMIT 1`,
    [postId]
  );
  if (postResult.rowCount === 0) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }
  if (String(postResult.rows[0].author_id) !== sessionUser.id) {
    res.status(403).json({ ok: false, error: '게시물을 수정할 권한이 없습니다.' });
    return;
  }

  const body = req.body || {};
  const classification = parsePostClassification(body, postResult.rows[0].board);
  if (!classification.ok) {
    res.status(400).json({ ok: false, error: classification.error });
    return;
  }
  const prepared = preparePostContent(body);
  if (prepared.error) {
    res.status(400).json({ ok: false, error: prepared.error });
    return;
  }
  const c = classification.values;

  const result = await pool.query(
    `UPDATE clan_board_posts
     SET title = $2, content = $3, content_text = $4, category = $5,
         year = $6, month = $7, stage = $8, named = $9, updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING id, updated_at`,
    [postId, prepared.title, prepared.content, prepared.contentText, c.category, c.year, c.month, c.stage, c.named]
  );
  res.json({
    ok: true,
    id: result.rows[0].id,
    updated_at: toIso(result.rows[0].updated_at),
  });
}));

app.delete('/api/clan-board/posts/:postId', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;
  const { postId } = req.params;

  const postResult = await pool.query(
    `SELECT author_id FROM clan_board_posts WHERE id = $1::uuid LIMIT 1`,
    [postId]
  );
  if (postResult.rowCount === 0) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }
  const isAuthor = String(postResult.rows[0].author_id) === sessionUser.id;
  if (!isAuthor && sessionUser.role !== 'admin') {
    res.status(403).json({ ok: false, error: '게시물을 삭제할 권한이 없습니다.' });
    return;
  }

  await pool.query(`DELETE FROM clan_board_posts WHERE id = $1::uuid`, [postId]);
  res.json({ ok: true });
}));

app.post('/api/clan-board/posts/:postId/comments', asyncRoute(async (req, res) => {
  if (!clanBoardRequirePool(res)) return;
  const sessionUser = await requireSessionUser(req, res);
  if (!sessionUser) return;

  const { postId } = req.params;
  const trimmedContent = String((req.body && req.body.content) || '').trim();

  if (!trimmedContent) {
    res.status(400).json({ ok: false, error: '댓글 내용을 입력해 주세요.' });
    return;
  }
  if (codepointLength(trimmedContent) > CLAN_BOARD_COMMENT_MAX) {
    res.status(400).json({ ok: false, error: `댓글은 ${CLAN_BOARD_COMMENT_MAX}자 이내로 작성해 주세요.` });
    return;
  }

  const result = await pool.query(
    `INSERT INTO clan_board_comments (post_id, author_id, content)
     SELECT p.id, $2::uuid, $3 FROM clan_board_posts p WHERE p.id = $1::uuid
     RETURNING id, created_at`,
    [postId, sessionUser.id, trimmedContent]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ ok: false, error: '게시물을 찾을 수 없습니다.' });
    return;
  }
  res.status(201).json({
    ok: true,
    comment: {
      id: result.rows[0].id,
      content: trimmedContent,
      created_at: toIso(result.rows[0].created_at),
    },
  });
}));

app.all('/api/*', (req, res) => {
  res.status(404).json({ ok: false, error: '알 수 없는 API입니다.' });
});

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err && err.type === 'entity.too.large') {
    res.status(413).json({ ok: false, error: '요청 데이터가 너무 큽니다. 이미지·동영상 용량을 줄여 주세요.' });
    return;
  }
  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, error: '요청 형식이 올바르지 않습니다.' });
    return;
  }
  console.error(err);
  res.status(500).json({ ok: false, error: '서버 오류가 발생했습니다.' });
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

function warnAboutRiskyProductionConfig() {
  if (!isProductionLike()) return;
  if (!getSessionSecret()) {
    console.warn(
      'SESSION_SECRET이 비어 있습니다. 로그인(POST /api/login)은 동작하지 않습니다. 변수를 추가한 뒤 재배포하세요.'
    );
  } else if (isPiiKeyDerivedFromSessionSecret()) {
    console.warn(
      '[users] USER_PII_ENCRYPTION_KEY 가 없어 아이디·닉네임 암호화 키를 SESSION_SECRET 에서 파생합니다. ' +
        'SESSION_SECRET 을 바꾸면 기존 계정이 모두 로그인 불가가 되므로 교체하지 마세요.'
    );
  }
  const protection = getSignupProtection();
  if (!protection.available) {
    console.warn(
      '[signup] RECAPTCHA_SITE_KEY·RECAPTCHA_SECRET_KEY 가 모두 설정되지 않아 운영 환경 회원가입을 막았습니다.'
    );
  }
}

async function start() {
  await initDb();
  await bootstrapAdminFromEnvIfNeeded(pool);
  characterLibrary = readCharacterLibrarySync(__dirname);
  if (characterLibrary) {
    console.log(`캐릭터 정적 라이브러리 사용: ${characterLibrary.list.length}건 (public/data/characters.json)`);
  }
  try {
    const bootMaintained = await runFutureSightMaintenanceJob();
    if (bootMaintained.changed) {
      console.log('[future-sight] 기동 시 월별 유지보수를 적용했습니다.');
    }
  } catch (err) {
    console.error('[future-sight] 기동 시 월별 유지보수 실패:', err);
  }
  scheduleFutureSightMaintenanceDaily();
  scheduleExpiredSessionCleanup();
  console.log(
    `[future-sight] 매일 KST ${String(FUTURE_SIGHT_MAINTENANCE_KST_HOUR).padStart(2, '0')}:${String(FUTURE_SIGHT_MAINTENANCE_KST_MINUTE).padStart(2, '0')}에 월별 유지보수를 실행합니다.`
  );
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on ${PORT}`);
    warnAboutRiskyProductionConfig();
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
