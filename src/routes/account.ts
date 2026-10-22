/**
 * 공개 설정·회원가입·로그인·로그아웃 API (기존 server.js 이식, 경로·응답 형식 그대로).
 * /api/config, /api/health, /api/signup/*, /api/users/check, /api/register, /api/login, /api/logout
 */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types.ts';
import {
  isValidNicknameChars,
  isValidProfileDataUrl,
  LOGIN_USERNAME_MAX,
  MAX_PROFILE_DATA_URL_LENGTH,
  NICKNAME_CHARS_ERROR,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PROFILE_FORMAT_ERROR,
  PROFILE_TOO_LARGE_ERROR,
  USERNAME_PATTERN
} from '../lib/accountRules.ts';
import { normalizeCharacterIds, replaceOwnedCharactersStatements, validateCharacterIds } from '../lib/ownedCharacters.ts';
import { getDefaultProfileDataUrl } from '../lib/defaultProfile.ts';
import { codepointLength, getClientIp, isUniqueViolation, jsonError, readJsonBody, readString } from '../lib/http.ts';
import { isUuid } from '../lib/ids.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { normalizeUsername } from '../lib/pii.ts';
import { verifyRecaptcha, type RecaptchaResult } from '../lib/recaptcha.ts';
import { endSession, getSessionSecret, loadSessionUser, startSession } from '../lib/session.ts';
import { consumeStepPass, createSignupChallenge, isStepPassValid, verifySignupChallenge } from '../lib/signupCaptcha.ts';
import { getSignupProtection } from '../lib/signupProtection.ts';
import { NOW_SQL } from '../lib/time.ts';
import { isNicknameTaken, isUsernameTaken, loadPublicUser, requirePii } from '../lib/users.ts';

const app = new Hono<AppEnv>();

const SIGNUP_UNAVAILABLE_ERROR = '회원가입이 일시 중단되었습니다. 관리자에게 문의해 주세요. (보안 확인 reCAPTCHA 설정 필요)';
const LOGIN_FAILED_ERROR = '아이디 또는 비밀번호가 올바르지 않습니다.';
const STEP_PASS_EXPIRED_ERROR =
  '회원가입 1단계가 만료되었거나 보안 문자 확인이 완료되지 않았습니다. 첫 단계로 돌아가 보안 문자부터 다시 진행해 주세요.';

app.get('/config', (c) => {
  const protection = getSignupProtection(c.env);
  return c.json({
    ok: true,
    recaptchaSiteKey: protection.isRecaptchaConfigured ? protection.site : null,
    signupAvailable: protection.isAvailable
  });
});

/** 상태 확인. 기존 응답의 database.poolReady는 D1 바인딩이 있으면 true다. */
app.get('/health', (c) => {
  const protection = getSignupProtection(c.env);
  return c.json({
    ok: true,
    database: { poolReady: Boolean(c.env.DB) },
    session: { secretConfigured: Boolean(getSessionSecret(c)), piiKeyConfigured: Boolean(String(c.env.USER_PII_ENCRYPTION_KEY || '').trim()) },
    recaptcha: {
      siteKeyConfigured: Boolean(protection.site),
      secretConfigured: Boolean(protection.secret),
      signupProtected: protection.isRecaptchaConfigured,
      signupAvailable: protection.isAvailable
    }
  });
});

app.get('/signup/captcha', async (c) => {
  if (!getSignupProtection(c.env).isAvailable) return jsonError(c, 503, SIGNUP_UNAVAILABLE_ERROR);
  const { id, svg } = await createSignupChallenge(c.env.DB);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, id, svg });
});

app.post('/signup/verify-step1', async (c) => {
  if (!getSignupProtection(c.env).isAvailable) return jsonError(c, 503, SIGNUP_UNAVAILABLE_ERROR);
  const body = await readJsonBody(c);
  const result = await verifySignupChallenge(c.env.DB, readString(body, 'captchaId').trim(), body.captchaAnswer);
  if (!result.ok) return jsonError(c, 400, result.error);
  return c.json({ ok: true, stepPassToken: result.stepPassToken });
});

app.post('/login', async (c) => {
  if (!getSessionSecret(c)) {
    return jsonError(c, 503, '로그인이 비활성화되었습니다. 서버에 SESSION_SECRET 비밀값을 설정해 주세요.');
  }
  const pii = await requirePii(c);
  const body = await readJsonBody(c);
  const username = readString(body, 'username').trim();
  const password = readString(body, 'password');
  if (!username || !password) return jsonError(c, 400, '아이디와 비밀번호를 입력해 주세요.');
  if (username.length > LOGIN_USERNAME_MAX || password.length > PASSWORD_MAX) return jsonError(c, 401, LOGIN_FAILED_ERROR);

  const row = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE username_blind = ?')
    .bind(await pii.usernameBlindIndex(username))
    .first<{ id: string; password_hash: string }>();
  const isMatch = await verifyPassword(password, row ? row.password_hash : null);
  if (!row || !isMatch) return jsonError(c, 401, LOGIN_FAILED_ERROR);
  await startSession(c, row.id);
  return c.json({ ok: true, user: await loadPublicUser(c, row.id) });
});

app.post('/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

app.get('/users/check', async (c) => {
  const pii = await requirePii(c);
  const username = String(c.req.query('username') || '').trim();
  const nickname = String(c.req.query('nickname') || '').trim();
  if (!username && !nickname) return jsonError(c, 400, 'username 또는 nickname 쿼리가 필요합니다.');

  // 본인 닉네임 재확인(마이페이지)일 때만 자기 자신을 제외한다.
  let excludeUserId: string | null = null;
  const excludeRaw = String(c.req.query('excludeUserId') || '').trim();
  if (isUuid(excludeRaw)) {
    const sessionUser = await loadSessionUser(c);
    if (sessionUser && sessionUser.id === excludeRaw) excludeUserId = excludeRaw;
  }

  const out = { ok: true, usernameAvailable: true, nicknameAvailable: true };
  if (username) {
    out.usernameAvailable = USERNAME_PATTERN.test(username) && !(await isUsernameTaken(c, pii, username, excludeUserId));
  }
  if (nickname) {
    const length = codepointLength(nickname);
    if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
      out.nicknameAvailable = false;
    } else if (!isValidNicknameChars(nickname)) {
      return jsonError(c, 400, NICKNAME_CHARS_ERROR);
    } else {
      out.nicknameAvailable = !(await isNicknameTaken(c, pii, nickname, excludeUserId));
    }
  }
  return c.json(out);
});

async function checkRecaptcha(c: Context<AppEnv>, secret: string, token: string): Promise<Response | null> {
  if (!token) return jsonError(c, 400, '보안 확인(Google reCAPTCHA)을 완료한 뒤 다시 시도해 주세요.');
  let result: RecaptchaResult;
  try {
    result = await verifyRecaptcha(secret, token, getClientIp(c));
  } catch (err) {
    console.error('reCAPTCHA siteverify 오류:', err instanceof Error ? err.message : err);
    return jsonError(c, 502, '보안 확인 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!result.success) {
    console.warn('reCAPTCHA 검증 실패:', (result['error-codes'] || []).join(','));
    return jsonError(c, 400, '보안 확인에 실패했습니다. 확인란을 다시 체크한 뒤 시도해 주세요.');
  }
  return null;
}

app.post('/register', async (c) => {
  const pii = await requirePii(c);
  const protection = getSignupProtection(c.env);
  if (protection.isPartial) {
    console.warn('reCAPTCHA: RECAPTCHA_SITE_KEY와 RECAPTCHA_SECRET_KEY를 함께 설정해야 회원가입 보호가 동작합니다.');
  }
  if (!protection.isAvailable) return jsonError(c, 503, SIGNUP_UNAVAILABLE_ERROR);

  const body = await readJsonBody(c);
  const stepPassToken = readString(body, 'stepPassToken').trim();
  const username = readString(body, 'username').trim();
  const nickname = readString(body, 'nickname').trim();
  const password = readString(body, 'password');
  const profileImageRaw = body.profileImage == null ? '' : String(body.profileImage).trim();
  const profileImage = profileImageRaw === '' ? null : profileImageRaw;

  if (!USERNAME_PATTERN.test(username)) return jsonError(c, 400, '아이디는 영문만 사용하고 8~20자로 입력해 주세요.');
  const nicknameLength = codepointLength(nickname);
  if (nicknameLength < NICKNAME_MIN || nicknameLength > NICKNAME_MAX) {
    return jsonError(c, 400, `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`);
  }
  if (!isValidNicknameChars(nickname)) return jsonError(c, 400, NICKNAME_CHARS_ERROR);
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return jsonError(c, 400, `비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해 주세요.`);
  }
  if (profileImage && profileImage.length > MAX_PROFILE_DATA_URL_LENGTH) return jsonError(c, 400, PROFILE_TOO_LARGE_ERROR);
  if (profileImage && !isValidProfileDataUrl(profileImage)) return jsonError(c, 400, PROFILE_FORMAT_ERROR);

  const shouldDeferOwnedCharacters = Boolean(body.deferOwnedCharacters);
  const characterIds = normalizeCharacterIds(body.characterIds);
  if (!shouldDeferOwnedCharacters && characterIds.length === 0) {
    return jsonError(c, 400, '보유 캐릭터를 한 명 이상 선택하거나, ‘보유 캐릭터 추후 등록’을 체크해 주세요.');
  }

  // 1단계 통과 토큰은 여기서 확인만 하고, 실제 가입 직전에 소모한다(중복 등 검증 실패 시 1단계 재진행 방지).
  if (!(await isStepPassValid(c.env.DB, stepPassToken))) return jsonError(c, 400, STEP_PASS_EXPIRED_ERROR);

  const invalidCharacters = validateCharacterIds(c, characterIds);
  if (invalidCharacters) return invalidCharacters;

  if (await isUsernameTaken(c, pii, username)) return jsonError(c, 409, '다른 사용자가 이미 사용 중인 아이디입니다.');
  if (await isNicknameTaken(c, pii, nickname)) return jsonError(c, 409, '다른 사용자가 이미 사용 중인 닉네임입니다.');

  if (protection.isRecaptchaConfigured) {
    const failure = await checkRecaptcha(c, protection.secret, readString(body, 'recaptchaToken').trim());
    if (failure) return failure;
  }

  if (!(await consumeStepPass(c.env.DB, stepPassToken))) return jsonError(c, 400, STEP_PASS_EXPIRED_ERROR);

  const userId = crypto.randomUUID();
  const [usernameBlind, nicknameBlind, usernameCipher, nicknameCipher, passwordHash] = await Promise.all([
    pii.usernameBlindIndex(username),
    pii.nicknameBlindIndex(nickname),
    pii.encrypt(normalizeUsername(username)),
    pii.encrypt(nickname),
    hashPassword(password)
  ]);
  let createdAt: string;
  try {
    // 회원 행과 보유 캐릭터를 한 batch(한 트랜잭션)로 저장한다.
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, username_blind, nickname_blind, username_cipher, nickname_cipher, password_hash, profile_image, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${NOW_SQL}) RETURNING created_at`
      ).bind(userId, usernameBlind, nicknameBlind, usernameCipher, nicknameCipher, passwordHash, profileImage || getDefaultProfileDataUrl()),
      ...replaceOwnedCharactersStatements(c.env.DB, userId, characterIds, { isNewUser: true })
    ]);
    createdAt = (results[0].results[0] as { created_at: string }).created_at;
  } catch (err) {
    if (isUniqueViolation(err)) return jsonError(c, 409, '이미 사용 중인 아이디 또는 닉네임입니다.');
    throw err;
  }

  return c.json(
    {
      ok: true,
      user: { id: userId, username: normalizeUsername(username), nickname, createdAt },
      ownedCharacterCount: characterIds.length,
      deferOwnedCharacters: shouldDeferOwnedCharacters
    },
    201
  );
});

export default app;
