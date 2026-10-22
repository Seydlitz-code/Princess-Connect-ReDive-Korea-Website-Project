/**
 * 비밀번호 해시: PBKDF2-SHA256 (Web Crypto). 기존 bcrypt(cost 11)는 Workers에서 쓸 수 없어 바꿨다.
 * 저장 형식: pbkdf2_sha256$<반복 횟수>$<salt base64>$<hash base64>
 * 반복 횟수를 함께 저장하므로 나중에 값을 바꿔도 기존 해시를 계속 검증할 수 있다.
 * scripts/admin.mjs도 같은 형식으로 해시를 만든다.
 */
import { base64ToBytes, bytesToBase64, encodeUtf8 } from './encoding.ts';

/** 반복 횟수: 5만 회 (2026-10-22 결정. 무료 플랜 CPU 한도를 고려해 Workers 상한 10만 회의 절반으로 둠) */
export const PBKDF2_ITERATIONS = 50_000;
/** Workers의 PBKDF2 반복 상한. 이보다 큰 값이 저장돼 있으면 검증할 수 없다. */
const PBKDF2_MAX_ITERATIONS = 100_000;
/** salt 길이: 16바이트 (128비트, 일반 권장값) */
const SALT_BYTES = 16;
/** 해시 길이: 32바이트 (SHA-256 출력 길이와 같게) */
const KEY_BYTES = 32;
const PREFIX = 'pbkdf2_sha256';

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encodeUtf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

function isEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * stored가 null(없는 아이디)이면 같은 계산을 한 번 하고 false를 돌려준다.
 * 응답 시간으로 계정 존재 여부가 드러나지 않게 하기 위해서다.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) {
    await derive(password, new Uint8Array(SALT_BYTES), PBKDF2_ITERATIONS);
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }
  // 상수 시간 비교: 앞부분이 맞는 정도가 응답 시간으로 드러나지 않게 한다.
  return isEqualBytes(await derive(password, salt, iterations), expected);
}
