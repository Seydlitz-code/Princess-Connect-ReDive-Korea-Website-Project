'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'priconne_sid';
/** 7일 */
const MAX_AGE_SEC = 7 * 24 * 60 * 60;

let devSecretWarned = false;

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/** 서명에 쓸 비밀. production 에서 없으면 로그인 비활성. */
function getSessionSecret() {
  const fromEnv = typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET.trim() : '';
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return '';
  if (!devSecretWarned) {
    devSecretWarned = true;
    console.warn('[session] SESSION_SECRET 없음 — 개발 전용 기본 키 사용. 운영에서는 반드시 SESSION_SECRET 을 설정하세요.');
  }
  return 'priconne-dev-session-secret';
}

function signSession(secret, userId) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = Buffer.from(JSON.stringify({ sub: String(userId), exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * @returns {string|null} user UUID
 */
function verifySession(secret, rawToken) {
  if (!secret || !rawToken || typeof rawToken !== 'string') return null;
  const dot = rawToken.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadStr = rawToken.slice(0, dot);
  const sig = rawToken.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadStr).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.sub !== 'string' || typeof data.exp !== 'number') return null;
  if (data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.sub;
}

function getUserIdFromRequest(secret, cookieHeader) {
  const cookies = parseCookies(cookieHeader || '');
  return verifySession(secret, cookies[COOKIE_NAME] || '');
}

function appendSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${MAX_AGE_SEC}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function appendClearSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [`${COOKIE_NAME}=`, 'Max-Age=0', 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (isProd) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_SEC,
  parseCookies,
  getSessionSecret,
  signSession,
  verifySession,
  getUserIdFromRequest,
  appendSessionCookie,
  appendClearSessionCookie,
};
