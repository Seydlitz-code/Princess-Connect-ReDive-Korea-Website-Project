/**
 * 보안 헤더와 CSRF 출처 검사 (기존 helmet 설정 이식).
 * Worker가 만든 응답(API)에만 붙는다. 정적 파일(index.html 등)은 public/_headers에서 같은 값을 붙인다.
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.ts';
import { jsonError } from './http.ts';

/**
 * 기존 helmet 기본값 + server.js의 지시문과 같은 CSP.
 * reCAPTCHA 스크립트·iframe(google.com, gstatic.com)과 게시물의 data: 이미지·동영상을 허용한다.
 * public/_headers의 Content-Security-Policy와 같은 값이어야 한다.
 */
export const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' https: data:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' https://www.google.com https://www.gstatic.com",
  "script-src-attr 'none'",
  "style-src 'self' https: 'unsafe-inline'",
  "frame-src 'self' https://www.google.com",
  "media-src 'self' data:",
  'upgrade-insecure-requests'
].join(';');

/** HTTPS에서 HSTS 유지 기간: 365일 (helmet 기본값) */
const HSTS_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export const addSecurityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set('Content-Security-Policy', CSP);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Origin-Agent-Cluster', '?1');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-DNS-Prefetch-Control', 'off');
  headers.set('X-Download-Options', 'noopen');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  headers.set('X-XSS-Protection', '0');
  if (new URL(c.req.url).protocol === 'https:') {
    headers.set('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_SEC}; includeSubDomains`);
  }
};

function getHost(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 상태를 바꾸는 요청(POST/PUT/PATCH/DELETE)은 같은 사이트에서 온 것만 허용한다 (CSRF 방어).
 * 기존 서버는 SameSite=Lax 쿠키와 JSON 본문에만 기대었는데, 본문이 없는 요청(로그아웃·삭제·추천)도 막기 위해 더했다.
 * Origin(없으면 Referer)의 호스트를 요청 호스트와 비교한다. 두 헤더가 모두 없으면 SameSite=Lax 쿠키 정책에 맡긴다.
 */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  const source = origin && origin !== 'null' ? origin : c.req.header('referer');
  if (!source) {
    if (origin === 'null') return jsonError(c, 403, '허용되지 않은 요청 출처입니다.');
    return next();
  }
  if (getHost(source) === new URL(c.req.url).host.toLowerCase()) return next();
  return jsonError(c, 403, '허용되지 않은 요청 출처입니다.');
};
