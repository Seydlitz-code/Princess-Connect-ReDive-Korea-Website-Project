/** 회원 조회·중복 확인 공통 (기존 server.js의 loadPublicUser·isUsernameTaken 등 이식) */
import type { Context } from 'hono';
import type { AppEnv } from '../types.ts';
import { ApiError } from './http.ts';
import { decryptOrEmpty, getPiiCrypto, type PiiCrypto } from './pii.ts';

export type PublicUser = { id: string; username: string; nickname: string; profileImage: string | null; role: string };

type UserRow = {
  id: string;
  username_cipher: string;
  nickname_cipher: string;
  profile_image: string | null;
  role: string;
};

/** 암호화 키가 없으면 회원 기능을 쓸 수 없으므로 503을 던진다. */
export function requirePii(c: Context<AppEnv>): Promise<PiiCrypto> {
  const pii = getPiiCrypto(c.env.USER_PII_ENCRYPTION_KEY);
  if (!pii) {
    throw new ApiError(503, '회원 기능 서버 설정이 완료되지 않았습니다. 서버에 USER_PII_ENCRYPTION_KEY 비밀값을 설정해 주세요.');
  }
  return pii;
}

export async function loadPublicUser(c: Context<AppEnv>, userId: string): Promise<PublicUser | null> {
  const row = await c.env.DB.prepare(
    'SELECT id, username_cipher, nickname_cipher, profile_image, role FROM users WHERE id = ?'
  )
    .bind(userId)
    .first<UserRow>();
  if (!row) return null;
  const pii = await requirePii(c);
  return {
    id: row.id,
    username: await decryptOrEmpty(pii, row.username_cipher),
    nickname: await decryptOrEmpty(pii, row.nickname_cipher),
    profileImage: row.profile_image,
    role: row.role
  };
}

async function isBlindTaken(db: D1Database, column: 'username_blind' | 'nickname_blind', blind: string, excludeUserId: string | null) {
  // column은 코드 안의 두 값 중 하나라 SQL에 이어 붙여도 안전하다.
  const row = excludeUserId
    ? await db.prepare(`SELECT 1 AS found FROM users WHERE ${column} = ? AND id <> ?`).bind(blind, excludeUserId).first()
    : await db.prepare(`SELECT 1 AS found FROM users WHERE ${column} = ?`).bind(blind).first();
  return row !== null;
}

export async function isUsernameTaken(c: Context<AppEnv>, pii: PiiCrypto, username: string, excludeUserId: string | null = null) {
  return isBlindTaken(c.env.DB, 'username_blind', await pii.usernameBlindIndex(username), excludeUserId);
}

export async function isNicknameTaken(c: Context<AppEnv>, pii: PiiCrypto, nickname: string, excludeUserId: string | null = null) {
  return isBlindTaken(c.env.DB, 'nickname_blind', await pii.nicknameBlindIndex(nickname), excludeUserId);
}
