/** 바이트 ↔ 문자열 변환 (Buffer가 없는 Workers용) */

/** String.fromCharCode에 한 번에 넘기는 바이트 수: 32KB (인자 개수 상한을 넘지 않게) */
const CHUNK_BYTES = 0x8000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeUtf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** 큰 배열도 한 바이트씩 이어 붙이지 않고 32KB 조각씩 바꿔 CPU 시간을 아낀다. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_BYTES)));
  }
  return btoa(parts.join(''));
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 형식이 틀리면 null */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return base64ToBytes(padded);
  } catch {
    return null;
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await sha256(encodeUtf8(text)));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** 0 이상 max 미만의 고른 정수 (나머지 편향을 없애려고 범위를 벗어난 값은 다시 뽑는다) */
export function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}
