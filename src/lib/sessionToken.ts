/**
 * 세션 쿠키 토큰 서명·검증 (기존 lib/sessionAuth.js를 Web Crypto로 이식).
 * 형식: base64url(JSON { sub: 회원 id, sid: user_sessions id, exp: 만료 초 }) + '.' + base64url(HMAC-SHA256)
 * 라우트와 떨어진 순수 함수라 Node 단위 테스트에서도 그대로 쓴다.
 */
import { base64UrlToBytes, bytesToBase64Url, decodeUtf8, encodeUtf8 } from './encoding.ts';

/** 세션 유지 기간: 7일 (기존과 같음) */
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
/** 쿠키 값 최대 길이: 1024자. 정상 토큰은 200자 안팎이라, 이보다 길면 서명 계산 없이 버린다. */
const TOKEN_MAX_LENGTH = 1024;

export type SessionClaims = { sub: string; sid: string };

/** 같은 isolate에서 같은 비밀값으로 키를 다시 만들지 않도록 마지막 키 하나만 기억한다. */
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function importHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey('raw', encodeUtf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    };
  }
  return cachedKey.key;
}

export async function signSession(secret: string, userId: string, sid: string, nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SEC;
  const payload = bytesToBase64Url(encodeUtf8(JSON.stringify({ sub: userId, sid, exp })));
  const signature = await crypto.subtle.sign('HMAC', await importHmacKey(secret), encodeUtf8(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** 서명이 맞고 만료 전이면 { sub, sid }, 아니면 null */
export async function verifySession(secret: string, rawToken: string, nowMs = Date.now()): Promise<SessionClaims | null> {
  if (!secret || !rawToken || rawToken.length > TOKEN_MAX_LENGTH) return null;
  const dot = rawToken.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = rawToken.slice(0, dot);
  const signature = base64UrlToBytes(rawToken.slice(dot + 1));
  if (!signature) return null;
  // crypto.subtle.verify는 상수 시간으로 비교한다.
  const isValid = await crypto.subtle.verify('HMAC', await importHmacKey(secret), signature, encodeUtf8(payload));
  if (!isValid) return null;
  const payloadBytes = base64UrlToBytes(payload);
  if (!payloadBytes) return null;
  let data: unknown;
  try {
    data = JSON.parse(decodeUtf8(payloadBytes));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { sub, sid, exp } = data as Record<string, unknown>;
  if (typeof sub !== 'string' || typeof sid !== 'string' || typeof exp !== 'number') return null;
  if (exp < Math.floor(nowMs / 1000)) return null;
  return { sub, sid };
}
