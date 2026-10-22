/**
 * 회원가입 1단계(보안 문자) 상태 관리 (기존 lib/signupCaptcha.js의 메모리 Map을 D1 signup_tokens로 이식).
 * 문제 id와 1단계 통과 토큰은 원문 대신 SHA-256만 저장한다. 문제의 정답은 SHA-256(id + ':' + 정답)으로 둔다.
 * 문제는 답을 한 번 확인하면 맞든 틀리든 지워진다(1회용).
 */
import { bytesToBase64Url, bytesToHex, randomBytes, sha256Hex } from './encoding.ts';
import { buildCaptchaSvg, createCaptchaCode, normalizeCaptchaAnswer } from './captchaSvg.ts';

/** 문제 유효 시간: 8분 (기존과 같음) */
const CHALLENGE_TTL_MS = 8 * 60 * 1000;
/** 1단계 통과 토큰 유효 시간: 30분 (기존과 같음) */
const PASS_TTL_MS = 30 * 60 * 1000;
/** 문제 id 길이: 16바이트 (16진수 32자, 기존과 같음) */
const CHALLENGE_ID_BYTES = 16;
/** 통과 토큰 길이: 24바이트 (base64url 32자, 기존과 같음) */
const PASS_TOKEN_BYTES = 24;
/** 입력 토큰 최대 길이: 128자. 이보다 길면 해시 계산 없이 버린다. */
const TOKEN_MAX_LENGTH = 128;

export function hashCaptchaAnswer(challengeId: string, answer: string): Promise<string> {
  return sha256Hex(`${challengeId}:${answer}`);
}

export async function createSignupChallenge(db: D1Database, nowMs = Date.now()): Promise<{ id: string; svg: string }> {
  const code = createCaptchaCode();
  const id = bytesToHex(randomBytes(CHALLENGE_ID_BYTES));
  await db
    .prepare("INSERT INTO signup_tokens (token_hash, kind, answer_hash, expires_at) VALUES (?, 'challenge', ?, ?)")
    .bind(await sha256Hex(id), await hashCaptchaAnswer(id, code), nowMs + CHALLENGE_TTL_MS)
    .run();
  return { id, svg: buildCaptchaSvg(code) };
}

export type StepPassResult = { ok: true; stepPassToken: string } | { ok: false; error: string };

export async function verifySignupChallenge(
  db: D1Database,
  challengeId: string,
  answer: unknown,
  nowMs = Date.now()
): Promise<StepPassResult> {
  const normalized = normalizeCaptchaAnswer(answer);
  if (!challengeId || !normalized) return { ok: false, error: '보안 문자를 입력해 주세요.' };
  if (challengeId.length > TOKEN_MAX_LENGTH) {
    return { ok: false, error: '보안 문자가 만료되었습니다. 이미지를 새로 받은 뒤 다시 입력해 주세요.' };
  }
  const row = await db
    .prepare("DELETE FROM signup_tokens WHERE token_hash = ? AND kind = 'challenge' RETURNING answer_hash, expires_at")
    .bind(await sha256Hex(challengeId))
    .first<{ answer_hash: string; expires_at: number }>();
  if (!row || row.expires_at < nowMs) {
    return { ok: false, error: '보안 문자가 만료되었습니다. 이미지를 새로 받은 뒤 다시 입력해 주세요.' };
  }
  if ((await hashCaptchaAnswer(challengeId, normalized)) !== row.answer_hash) {
    return { ok: false, error: '보안 문자가 일치하지 않습니다.' };
  }
  const token = bytesToBase64Url(randomBytes(PASS_TOKEN_BYTES));
  await db
    .prepare("INSERT INTO signup_tokens (token_hash, kind, answer_hash, expires_at) VALUES (?, 'pass', NULL, ?)")
    .bind(await sha256Hex(token), nowMs + PASS_TTL_MS)
    .run();
  return { ok: true, stepPassToken: token };
}

/** 소모하지 않고 유효성만 확인(가입 검증 실패 시 1단계를 다시 하지 않도록) */
export async function isStepPassValid(db: D1Database, token: string, nowMs = Date.now()): Promise<boolean> {
  if (!token || token.length > TOKEN_MAX_LENGTH) return false;
  const row = await db
    .prepare("SELECT 1 AS found FROM signup_tokens WHERE token_hash = ? AND kind = 'pass' AND expires_at >= ?")
    .bind(await sha256Hex(token), nowMs)
    .first();
  return row !== null;
}

/** 가입 직전에 토큰을 지운다. 지운 행이 없으면(이미 쓰였거나 만료) false */
export async function consumeStepPass(db: D1Database, token: string, nowMs = Date.now()): Promise<boolean> {
  if (!token || token.length > TOKEN_MAX_LENGTH) return false;
  const row = await db
    .prepare("DELETE FROM signup_tokens WHERE token_hash = ? AND kind = 'pass' AND expires_at >= ? RETURNING token_hash")
    .bind(await sha256Hex(token), nowMs)
    .first();
  return row !== null;
}
