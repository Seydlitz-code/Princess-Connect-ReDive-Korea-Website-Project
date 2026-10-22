/** API 응답·요청 본문 공통 처리 (기존 Express의 express.json·오류 미들웨어 역할) */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../types.ts';

/** 요청 본문 상한: 2MB (기존 express.json의 limit '2mb'와 같음. 게시물 본문에 이미지·동영상이 data URL로 들어간다) */
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

export type JsonObject = Record<string, unknown>;

/** 라우트 어디서든 던지면 app.onError가 { ok: false, error } JSON으로 바꾼다. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;

  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(c: Context<AppEnv>, status: ContentfulStatusCode, error: string) {
  return c.json({ ok: false, error }, status);
}

/**
 * JSON 본문을 객체로 읽는다. Express처럼 Content-Type이 JSON이 아니면 빈 객체로 본다.
 * 형식이 틀리거나 객체·배열이 아니면 400.
 */
export async function readJsonBody(c: Context<AppEnv>): Promise<JsonObject> {
  const type = c.req.header('content-type') || '';
  if (!/^application\/([a-z0-9.+-]*\+)?json\b/i.test(type)) return {};
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
  }
  if (parsed === null || typeof parsed !== 'object') throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
  return parsed as JsonObject;
}

/** 값이 문자열·숫자면 문자열로, 그 밖(null·객체 등)은 빈 문자열로 (기존 String(body.x || '')와 같은 결과) */
export function readString(body: JsonObject, key: string): string {
  const value = body[key];
  if (value === undefined || value === null || value === false || value === 0 || value === '') return '';
  return String(value);
}

export function hasOwn(body: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/** Cloudflare가 붙여 주는 실제 접속 IP (로컬 개발에서는 없을 수 있음) */
export function getClientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') || '0.0.0.0';
}

/** 이모지 등도 한 글자로 세는 길이 */
export function codepointLength(text: string): number {
  return [...text].length;
}

/** 페이지 번호 등 양의 정수 쿼리 (기존 parseInt(...) || 기본값과 같은 결과) */
export function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(String(value || ''), 10);
  return parsed > 0 ? parsed : fallback;
}

/** D1(SQLite)의 UNIQUE 제약 위반인지 (기존 PostgreSQL 오류 코드 23505 대신) */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
