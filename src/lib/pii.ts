/**
 * 아이디·닉네임 보호 (기존 lib/userPiiCrypto.js를 Web Crypto로 이식, 같은 알고리즘·저장 형식).
 * - blind index: HMAC-SHA256(키 = SHA-256(암호화 키 ‖ 용도 라벨)), 16진수. 중복 확인·로그인 조회에 쓴다.
 * - 암호문: AES-256-GCM, base64url(iv 12바이트 ‖ 인증 태그 16바이트 ‖ 암호문)
 * 라우트와 떨어진 순수 함수라 Node 단위 테스트·scripts/admin.mjs와 같은 결과를 내는지 확인할 수 있다.
 */
import { base64UrlToBytes, bytesToBase64Url, bytesToHex, concatBytes, decodeUtf8, encodeUtf8, hexToBytes, randomBytes, sha256 } from './encoding.ts';

/** 용도 라벨 끝의 0 바이트까지 기존과 같아야 같은 blind index가 나온다. */
const USERNAME_LABEL = encodeUtf8('username:v1\0');
const NICKNAME_LABEL = encodeUtf8('nickname:v1\0');
/** AES-GCM IV 길이: 12바이트 (GCM 권장값) */
const IV_BYTES = 12;
/** AES-GCM 인증 태그 길이: 16바이트 */
const TAG_BYTES = 16;

export type PiiCrypto = {
  usernameBlindIndex(username: string): Promise<string>;
  nicknameBlindIndex(nickname: string): Promise<string>;
  encrypt(plain: string): Promise<string>;
  /** 복호화에 실패하면 null */
  decrypt(cipherText: string): Promise<string | null>;
};

/** 아이디는 대소문자를 구분하지 않는다. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** 64자리 16진수면 그대로 32바이트 키로, 아니면 문자열의 SHA-256을 키로 쓴다 (기존과 같음). */
async function resolveKeyBytes(rawKey: string): Promise<Uint8Array> {
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) return hexToBytes(rawKey);
  return sha256(encodeUtf8(rawKey));
}

async function importMacKey(keyBytes: Uint8Array, label: Uint8Array): Promise<CryptoKey> {
  const macKeyBytes = await sha256(concatBytes(keyBytes, label));
  return crypto.subtle.importKey('raw', macKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function buildPiiCrypto(rawKey: string): Promise<PiiCrypto> {
  const keyBytes = await resolveKeyBytes(rawKey);
  const [aesKey, usernameMacKey, nicknameMacKey] = await Promise.all([
    crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']),
    importMacKey(keyBytes, USERNAME_LABEL),
    importMacKey(keyBytes, NICKNAME_LABEL)
  ]);
  const sign = async (key: CryptoKey, text: string) =>
    bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeUtf8(text))));

  return {
    usernameBlindIndex: (username) => sign(usernameMacKey, normalizeUsername(username)),
    nicknameBlindIndex: (nickname) => sign(nicknameMacKey, nickname.trim()),
    async encrypt(plain) {
      const iv = randomBytes(IV_BYTES);
      // Web Crypto는 암호문 뒤에 태그를 붙여 돌려주므로 기존 형식(iv ‖ 태그 ‖ 암호문)으로 순서를 바꾼다.
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encodeUtf8(plain)));
      const body = sealed.subarray(0, sealed.length - TAG_BYTES);
      const tag = sealed.subarray(sealed.length - TAG_BYTES);
      return bytesToBase64Url(concatBytes(iv, tag, body));
    },
    async decrypt(cipherText) {
      const bytes = base64UrlToBytes(cipherText);
      if (!bytes || bytes.length < IV_BYTES + TAG_BYTES) return null;
      const iv = bytes.subarray(0, IV_BYTES);
      const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const body = bytes.subarray(IV_BYTES + TAG_BYTES);
      try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, concatBytes(body, tag));
        return decodeUtf8(new Uint8Array(plain));
      } catch {
        return null;
      }
    }
  };
}

/** 같은 isolate에서는 키를 한 번만 만든다 (키 문자열이 바뀌면 다시 만든다). */
let cached: { rawKey: string; crypto: Promise<PiiCrypto> } | null = null;

/** 키가 설정되지 않았으면 null */
export function getPiiCrypto(rawKey: string | undefined): Promise<PiiCrypto> | null {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  if (cached?.rawKey !== key) cached = { rawKey: key, crypto: buildPiiCrypto(key) };
  return cached.crypto;
}

/** 표시용 문자열. 복호화에 실패하면 빈 문자열 (기존 displayNicknameFromRow와 같음) */
export async function decryptOrEmpty(pii: PiiCrypto, cipherText: string | null): Promise<string> {
  if (!cipherText) return '';
  return (await pii.decrypt(cipherText)) ?? '';
}
