/** 내 정보·보유 캐릭터 API (기존 server.js 이식): /api/me, /api/me/owned-characters */
import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import {
  isValidNicknameChars,
  isValidProfileDataUrl,
  MAX_PROFILE_DATA_URL_LENGTH,
  NICKNAME_CHARS_ERROR,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PROFILE_FORMAT_ERROR,
  PROFILE_TOO_LARGE_ERROR
} from '../lib/accountRules.ts';
import { findCharacter, toCharacterMeta } from '../lib/characters.ts';
import { codepointLength, hasOwn, isUniqueViolation, jsonError, readJsonBody } from '../lib/http.ts';
import { normalizeCharacterIds, replaceOwnedCharactersStatements, validateCharacterIds } from '../lib/ownedCharacters.ts';
import { decryptOrEmpty } from '../lib/pii.ts';
import { clearSessionCookie, getSessionSecret, hasSessionCookie, loadSessionUser, requireSessionUser } from '../lib/session.ts';
import { isNicknameTaken, loadPublicUser, requirePii } from '../lib/users.ts';

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!getSessionSecret(c)) return c.json({ ok: true, user: null });
  const sessionUser = await loadSessionUser(c);
  const user = sessionUser ? await loadPublicUser(c, sessionUser.id) : null;
  if (!user && hasSessionCookie(c)) clearSessionCookie(c);
  return c.json({ ok: true, user });
});

app.patch('/', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const pii = await requirePii(c);
  const userId = sessionUser.id;

  const body = await readJsonBody(c);
  const hasNickname = hasOwn(body, 'nickname');
  const hasProfile = hasOwn(body, 'profileImage');
  if (!hasNickname && !hasProfile) {
    return jsonError(c, 400, '변경할 닉네임(nickname) 또는 프로필 이미지(profileImage) 중 하나 이상을 보내 주세요.');
  }

  let nicknameNext = '';
  if (hasNickname) {
    nicknameNext = String(body.nickname || '').trim();
    const length = codepointLength(nicknameNext);
    if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
      return jsonError(c, 400, `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`);
    }
    if (!isValidNicknameChars(nicknameNext)) return jsonError(c, 400, NICKNAME_CHARS_ERROR);
  }

  let profileNext: string | null = null;
  if (hasProfile && body.profileImage != null) {
    profileNext = String(body.profileImage);
    if (profileNext.length > MAX_PROFILE_DATA_URL_LENGTH) return jsonError(c, 400, PROFILE_TOO_LARGE_ERROR);
    if (!isValidProfileDataUrl(profileNext)) return jsonError(c, 400, PROFILE_FORMAT_ERROR);
  }

  const row = await c.env.DB.prepare('SELECT nickname_cipher, profile_image FROM users WHERE id = ?')
    .bind(userId)
    .first<{ nickname_cipher: string; profile_image: string | null }>();
  if (!row) {
    clearSessionCookie(c);
    return jsonError(c, 401, '세션이 만료되었거나 계정을 찾을 수 없습니다.');
  }
  const currentNickname = await decryptOrEmpty(pii, row.nickname_cipher);
  const willChangeNickname = hasNickname && nicknameNext !== currentNickname;
  const willChangeProfile = hasProfile && (profileNext ?? '') !== (row.profile_image ?? '');
  if (!willChangeNickname && !willChangeProfile) return jsonError(c, 400, '변경된 내용이 없습니다.');

  if (willChangeNickname && (await isNicknameTaken(c, pii, nicknameNext, userId))) {
    return jsonError(c, 409, '다른 사용자가 이미 사용 중인 닉네임입니다.');
  }

  const statements: D1PreparedStatement[] = [];
  if (willChangeNickname) {
    statements.push(
      c.env.DB.prepare('UPDATE users SET nickname_blind = ?, nickname_cipher = ? WHERE id = ?').bind(
        await pii.nicknameBlindIndex(nicknameNext),
        await pii.encrypt(nicknameNext),
        userId
      )
    );
  }
  if (willChangeProfile) {
    statements.push(c.env.DB.prepare('UPDATE users SET profile_image = ? WHERE id = ?').bind(profileNext, userId));
  }
  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err)) return jsonError(c, 409, '다른 사용자가 이미 사용 중인 닉네임입니다.');
    throw err;
  }
  return c.json({ ok: true, user: await loadPublicUser(c, userId) });
});

app.get('/owned-characters', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const { results } = await c.env.DB.prepare('SELECT character_id FROM user_owned_characters WHERE user_id = ?')
    .bind(sessionUser.id)
    .all<{ character_id: string }>();
  const characters = results
    .map((row) => findCharacter(row.character_id))
    .filter((entry) => entry !== undefined)
    .map(toCharacterMeta)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true, characters });
});

app.patch('/owned-characters', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await readJsonBody(c);
  if (!Array.isArray(body.characterIds)) return jsonError(c, 400, 'characterIds 배열이 필요합니다.');
  const characterIds = normalizeCharacterIds(body.characterIds);
  const invalid = validateCharacterIds(c, characterIds);
  if (invalid) return invalid;
  await c.env.DB.batch(replaceOwnedCharactersStatements(c.env.DB, sessionUser.id, characterIds));
  return c.json({ ok: true, ownedCharacterCount: characterIds.length });
});

export default app;
