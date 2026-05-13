'use strict';

const crypto = require('crypto');
const { getSessionSecret } = require('./sessionAuth');

const BLIND_LABEL_USER = Buffer.from('username:v1\0', 'utf8');
const BLIND_LABEL_NICK = Buffer.from('nickname:v1\0', 'utf8');

let cachedKey;

function resolveKey32() {
  const k = String(process.env.USER_PII_ENCRYPTION_KEY || '').trim();
  if (k) {
    if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
    return crypto.createHash('sha256').update(k, 'utf8').digest();
  }
  const sess = getSessionSecret();
  if (sess) return crypto.createHash('sha256').update(`pii:v1:${sess}`, 'utf8').digest();
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[users] USER_PII_ENCRYPTION_KEY 또는 SESSION_SECRET이 없어 개발용 고정 키로 닉네임·아이디를 암호화합니다.'
    );
    return crypto.createHash('sha256').update('dev-fixed-user-pii', 'utf8').digest();
  }
  return null;
}

function getAesKey() {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = resolveKey32();
  return cachedKey;
}

function isPiiEncryptionReady() {
  return getAesKey() !== null;
}

function blindHmac(labelBuf, normalizedUtf8) {
  const key = getAesKey();
  if (!key) throw new Error('PII_KEY_UNAVAILABLE');
  const macKey = crypto.createHash('sha256').update(Buffer.concat([key, labelBuf])).digest();
  return crypto.createHmac('sha256', macKey).update(normalizedUtf8, 'utf8').digest('hex');
}

function normalizeUsername(s) {
  return String(s || '').trim().toLowerCase();
}

function usernameBlindIndex(loginUsername) {
  return blindHmac(BLIND_LABEL_USER, normalizeUsername(loginUsername));
}

function nicknameBlindIndex(nickname) {
  return blindHmac(BLIND_LABEL_NICK, String(nickname || '').trim());
}

function encryptUtf8(plain) {
  const key = getAesKey();
  if (!key) throw new Error('PII_KEY_UNAVAILABLE');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decryptUtf8(b64url) {
  const key = getAesKey();
  if (!key) throw new Error('PII_KEY_UNAVAILABLE');
  let buf;
  try {
    buf = Buffer.from(String(b64url || ''), 'base64url');
  } catch (_) {
    return null;
  }
  if (buf.length < 12 + 16) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch (_) {
    return null;
  }
}

function displayUsernameFromRow(row) {
  if (row.username_cipher) {
    const d = decryptUtf8(row.username_cipher);
    if (d) return d;
  }
  return row.username ? String(row.username) : '';
}

function displayNicknameFromRow(row) {
  if (row.nickname_cipher) {
    const d = decryptUtf8(row.nickname_cipher);
    if (d) return d;
  }
  return row.nickname ? String(row.nickname) : '';
}

module.exports = {
  normalizeUsername,
  usernameBlindIndex,
  nicknameBlindIndex,
  encryptUtf8,
  decryptUtf8,
  displayUsernameFromRow,
  displayNicknameFromRow,
  isPiiEncryptionReady,
};
