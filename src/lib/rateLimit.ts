/**
 * 시도 제한 (기존 express-rate-limit을 D1 고정 시간 창 카운터로 이식).
 * Workers는 요청마다 다른 isolate에서 실행될 수 있어 메모리 카운터를 쓸 수 없다.
 * 요청마다 D1 쓰기 1회가 들므로, 기존의 /api 전체 한도(분당 300회)는 옮기지 않고
 * 무차별 대입·도배를 막는 세 가지(로그인·회원가입 흐름·게시판 쓰기)만 남겼다.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.ts';
import { getClientIp, jsonError } from './http.ts';

export type WindowRule = { prefix: string; windowMs: number; max: number; message: string };

const TOO_MANY = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

/** 로그인: IP당 1분에 10회 (기존과 같음) */
export const LOGIN_RULE: WindowRule = {
  prefix: 'login',
  windowMs: 60 * 1000,
  max: 10,
  message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
};
/** 회원가입 흐름(보안 문자·중복 확인·가입): IP당 1분에 30회 (기존과 같음) */
export const SIGNUP_RULE: WindowRule = {
  prefix: 'signup',
  windowMs: 60 * 1000,
  max: 30,
  message: '너무 많은 시도입니다. 잠시 후 다시 시도해 주세요.'
};
/** 게시판 쓰기(작성·수정·삭제·댓글·추천): IP당 1분에 30회 (기존과 같음) */
export const BOARD_WRITE_RULE: WindowRule = { prefix: 'board-write', windowMs: 60 * 1000, max: 30, message: TOO_MANY };

/** Cron 정리 기준: 가장 긴 창(1분)보다 넉넉하게 1시간 지난 기록 */
export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000;

/**
 * 횟수를 1 늘리고 한도를 넘었는지 돌려준다. 창이 지났으면 1부터 다시 센다.
 * 쿼리 한 번(INSERT … ON CONFLICT … RETURNING)으로 끝난다.
 */
export async function hitRateLimit(db: D1Database, rule: WindowRule, key: string, nowMs = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count        = CASE WHEN window_start <= ?3 THEN 1  ELSE count + 1   END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       RETURNING count`
    )
    .bind(`${rule.prefix}:${key}`, nowMs, nowMs - rule.windowMs)
    .first<{ count: number }>();
  return row !== null && row.count > rule.max;
}

/** skip이 true를 돌려주는 요청은 세지 않는다. */
export function rateLimit(rule: WindowRule, skip?: (method: string, path: string) => boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (skip?.(c.req.method, c.req.path)) return next();
    if (await hitRateLimit(c.env.DB, rule, getClientIp(c))) {
      c.header('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      return jsonError(c, 429, rule.message);
    }
    return next();
  };
}
