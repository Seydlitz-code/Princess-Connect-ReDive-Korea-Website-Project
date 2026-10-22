/**
 * 로그인 세션: 쿠키 발급·조회·삭제 (기존 server.js의 getSessionUser·requireSessionUser 등 이식).
 * 쿠키 서명이 맞고 user_sessions 행이 남아 있을 때만 로그인 상태로 본다.
 */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionUser } from '../types.ts';
import { jsonError } from './http.ts';
import { isUuid } from './ids.ts';
import { SESSION_MAX_AGE_SEC, signSession, verifySession } from './sessionToken.ts';
import { NOW_SQL } from './time.ts';

const COOKIE_NAME = 'priconne_sid';

export function getSessionSecret(c: Context<AppEnv>): string {
  return String(c.env.SESSION_SECRET || '').trim();
}

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/** 로그인한 회원(id·권한). 요청마다 한 번만 조회하도록 결과를 c.var에 기억한다. */
export async function loadSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const cached = c.get('sessionUser');
  if (cached !== undefined) return cached;
  c.set('sessionUser', null);
  const secret = getSessionSecret(c);
  const raw = getCookie(c, COOKIE_NAME);
  if (!secret || !raw) return null;
  const claims = await verifySession(secret, raw);
  if (!claims || !isUuid(claims.sub) || !isUuid(claims.sid)) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.role
       FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND s.expires_at > ${NOW_SQL}`
  )
    .bind(claims.sid, claims.sub)
    .first<{ id: string; role: string }>();
  const user = row ? { id: row.id, role: row.role } : null;
  c.set('sessionUser', user);
  return user;
}

export function hasSessionCookie(c: Context<AppEnv>): boolean {
  return getCookie(c, COOKIE_NAME) !== undefined;
}

/** 로그인이 필요한 API 공통 검사. 실패하면 보낼 응답(Response)을 돌려준다. */
export async function requireSessionUser(c: Context<AppEnv>): Promise<SessionUser | Response> {
  if (!getSessionSecret(c)) {
    return jsonError(c, 503, '로그인 기능을 사용할 수 없습니다. 서버에 SESSION_SECRET 비밀값을 설정해 주세요.');
  }
  const user = await loadSessionUser(c);
  if (!user) {
    if (hasSessionCookie(c)) clearSessionCookie(c);
    return jsonError(c, 401, '로그인이 필요합니다.');
  }
  return user;
}

export async function requireAdminUser(c: Context<AppEnv>): Promise<SessionUser | Response> {
  const user = await requireSessionUser(c);
  if (user instanceof Response) return user;
  if (user.role !== 'admin') return jsonError(c, 403, '관리자 권한이 필요합니다.');
  return user;
}

/** user_sessions에 행을 만들고 서명한 쿠키를 붙인다. */
export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000).toISOString();
  await c.env.DB.prepare('INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sid, userId, expiresAt)
    .run();
  setCookie(c, COOKIE_NAME, await signSession(getSessionSecret(c), userId, sid), {
    maxAge: SESSION_MAX_AGE_SEC,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c)
  });
}

/** 로그아웃: 서버 쪽 세션 행을 지워 같은 쿠키를 다시 쓸 수 없게 한다. */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const secret = getSessionSecret(c);
  const raw = getCookie(c, COOKIE_NAME);
  const claims = secret && raw ? await verifySession(secret, raw) : null;
  if (claims && isUuid(claims.sid)) {
    await c.env.DB.prepare('DELETE FROM user_sessions WHERE id = ?').bind(claims.sid).run();
  }
  clearSessionCookie(c);
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'Lax', secure: isHttps(c) });
}
