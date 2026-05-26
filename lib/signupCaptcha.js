'use strict';

const crypto = require('crypto');

const CHALLENGE_TTL_MS = 8 * 60 * 1000;
const PASS_TTL_MS = 30 * 60 * 1000;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CHALLENGES = 5000;
const MAX_STEP_PASSES = 5000;

const challenges = new Map();
const stepPasses = new Map();

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i += 1) s += CHARSET[bytes[i] % CHARSET.length];
  return s;
}

function sweepMaps() {
  const now = Date.now();
  for (const [id, v] of challenges) {
    if (v.exp < now) challenges.delete(id);
  }
  for (const [t, v] of stepPasses) {
    if (v.exp < now) stepPasses.delete(t);
  }
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function buildSvg(code) {
  const w = 200;
  const h = 64;
  const lines = [];
  for (let i = 0; i < 5; i += 1) {
    const x1 = crypto.randomInt(0, w);
    const y1 = crypto.randomInt(0, h);
    const x2 = crypto.randomInt(0, w);
    const y2 = crypto.randomInt(0, h);
    lines.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c8c8c8" stroke-width="1"/>`
    );
  }
  let letters = '';
  const gap = w / (code.length + 1);
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const x = Math.round(gap * (i + 1) + crypto.randomInt(-6, 7));
    const y = 40 + crypto.randomInt(-8, 9);
    const rot = crypto.randomInt(-16, 17);
    letters += `<text x="${x}" y="${y}" fill="#0a0a0a" font-size="26" font-family="system-ui,sans-serif" font-weight="800" transform="rotate(${rot} ${x} ${y})">${escapeXml(
      ch
    )}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="보안 문자">${lines.join(
    ''
  )}${letters}</svg>`;
}

function createSignupCaptchaChallenge() {
  sweepMaps();
  if (challenges.size >= MAX_CHALLENGES) {
    const oldest = challenges.keys().next().value;
    if (oldest) challenges.delete(oldest);
  }
  const code = randomCode(5);
  const id = crypto.randomBytes(16).toString('hex');
  challenges.set(id, { answer: code.toUpperCase(), exp: Date.now() + CHALLENGE_TTL_MS });
  return { id, svg: buildSvg(code) };
}

function verifySignupCaptchaAndIssueStepPass(captchaId, answer) {
  sweepMaps();
  if (!captchaId || answer == null || String(answer).trim() === '') {
    return { ok: false, error: '보안 문자를 입력해 주세요.' };
  }
  const row = challenges.get(String(captchaId));
  if (!row) {
    return { ok: false, error: '보안 문자가 만료되었습니다. 이미지를 새로 받은 뒤 다시 입력해 주세요.' };
  }
  challenges.delete(String(captchaId));
  const norm = String(answer).trim().toUpperCase().replace(/\s+/g, '');
  if (norm !== row.answer) {
    return { ok: false, error: '보안 문자가 일치하지 않습니다.' };
  }
  const token = crypto.randomBytes(24).toString('base64url');
  if (stepPasses.size >= MAX_STEP_PASSES) {
    const oldest = stepPasses.keys().next().value;
    if (oldest) stepPasses.delete(oldest);
  }
  stepPasses.set(token, { exp: Date.now() + PASS_TTL_MS });
  return { ok: true, stepPassToken: token };
}

function consumeStepPassToken(token) {
  sweepMaps();
  if (!token) return false;
  const row = stepPasses.get(String(token));
  if (!row || row.exp < Date.now()) {
    if (row) stepPasses.delete(String(token));
    return false;
  }
  stepPasses.delete(String(token));
  return true;
}

module.exports = {
  createSignupCaptchaChallenge,
  verifySignupCaptchaAndIssueStepPass,
  consumeStepPassToken,
};
