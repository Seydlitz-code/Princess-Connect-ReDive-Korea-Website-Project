'use strict';

const crypto = require('crypto');

const CHALLENGE_TTL_MS = 8 * 60 * 1000;
const PASS_TTL_MS = 30 * 60 * 1000;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const MAX_CHALLENGES = 5000;
const MAX_STEP_PASSES = 5000;

const challenges = new Map();
const stepPasses = new Map();

/**
 * 선분 글리프(가로 0~10, 세로 0~14). 글자를 <text> 로 내보내면 SVG 를 파싱하는 것만으로 정답이
 * 드러나므로, 획을 왜곡한 path 로만 그린다.
 */
const GLYPHS = {
  A: [[[0, 14], [5, 0], [10, 14]], [[2, 8], [8, 8]]],
  B: [[[0, 0], [0, 14], [7, 14], [10, 11], [10, 9], [7, 7], [0, 7]], [[0, 0], [6, 0], [9, 2], [9, 5], [6, 7]]],
  C: [[[10, 2], [8, 0], [2, 0], [0, 3], [0, 11], [2, 14], [8, 14], [10, 12]]],
  D: [[[0, 0], [0, 14], [6, 14], [10, 10], [10, 4], [6, 0], [0, 0]]],
  E: [[[10, 0], [0, 0], [0, 14], [10, 14]], [[0, 7], [7, 7]]],
  F: [[[10, 0], [0, 0], [0, 14]], [[0, 7], [7, 7]]],
  G: [[[10, 2], [8, 0], [2, 0], [0, 3], [0, 11], [2, 14], [8, 14], [10, 12], [10, 8], [6, 8]]],
  H: [[[0, 0], [0, 14]], [[10, 0], [10, 14]], [[0, 7], [10, 7]]],
  J: [[[3, 0], [10, 0]], [[8, 0], [8, 11], [6, 14], [2, 14], [0, 11]]],
  K: [[[0, 0], [0, 14]], [[10, 0], [0, 8]], [[3, 6], [10, 14]]],
  L: [[[0, 0], [0, 14], [10, 14]]],
  M: [[[0, 14], [0, 0], [5, 8], [10, 0], [10, 14]]],
  N: [[[0, 14], [0, 0], [10, 14], [10, 0]]],
  P: [[[0, 14], [0, 0], [7, 0], [10, 2], [10, 5], [7, 7], [0, 7]]],
  Q: [[[2, 0], [8, 0], [10, 3], [10, 11], [8, 14], [2, 14], [0, 11], [0, 3], [2, 0]], [[6, 10], [10, 15]]],
  R: [[[0, 14], [0, 0], [7, 0], [10, 2], [10, 5], [7, 7], [0, 7]], [[5, 7], [10, 14]]],
  S: [[[10, 2], [8, 0], [2, 0], [0, 2], [0, 5], [2, 7], [8, 7], [10, 9], [10, 12], [8, 14], [2, 14], [0, 12]]],
  T: [[[0, 0], [10, 0]], [[5, 0], [5, 14]]],
  U: [[[0, 0], [0, 11], [2, 14], [8, 14], [10, 11], [10, 0]]],
  V: [[[0, 0], [5, 14], [10, 0]]],
  W: [[[0, 0], [2, 14], [5, 6], [8, 14], [10, 0]]],
  X: [[[0, 0], [10, 14]], [[10, 0], [0, 14]]],
  Y: [[[0, 0], [5, 7], [10, 0]], [[5, 7], [5, 14]]],
  Z: [[[0, 0], [10, 0], [0, 14], [10, 14]]],
  2: [[[0, 3], [2, 0], [8, 0], [10, 3], [10, 6], [0, 14], [10, 14]]],
  3: [[[0, 1], [2, 0], [8, 0], [10, 2], [10, 5], [7, 7], [3, 7]], [[7, 7], [10, 9], [10, 12], [8, 14], [2, 14], [0, 13]]],
  4: [[[8, 14], [8, 0], [0, 10], [10, 10]]],
  5: [[[10, 0], [1, 0], [0, 6], [7, 6], [10, 8], [10, 12], [8, 14], [2, 14], [0, 12]]],
  6: [[[9, 1], [7, 0], [3, 0], [0, 4], [0, 11], [2, 14], [8, 14], [10, 11], [10, 8], [8, 6], [2, 6], [0, 8]]],
  7: [[[0, 0], [10, 0], [4, 14]]],
  8: [[[5, 7], [2, 6], [0, 4], [0, 2], [2, 0], [8, 0], [10, 2], [10, 4], [8, 6], [5, 7], [1, 9], [0, 11], [1, 13], [3, 14], [7, 14], [9, 13], [10, 11], [9, 9], [5, 7]]],
  9: [[[10, 6], [8, 8], [2, 8], [0, 6], [0, 2], [2, 0], [8, 0], [10, 3], [10, 10], [7, 14], [2, 14]]],
};

const SVG_W = 200;
const SVG_H = 64;

function rand(min, max) {
  return min + (crypto.randomInt(0, 1_000_001) / 1_000_000) * (max - min);
}

function randomCode(len) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += CHARSET[crypto.randomInt(0, CHARSET.length)];
  return s;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const fmt = (n) => n.toFixed(1);

/** 선분을 잘게 나누고 각 점을 흔들어 템플릿 정합을 어렵게 한다 */
function wobblePolyline(points, jitter) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 6));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push([x1 + (x2 - x1) * t + rand(-jitter, jitter), y1 + (y2 - y1) * t + rand(-jitter, jitter)]);
    }
  }
  const last = points[points.length - 1];
  out.push([last[0] + rand(-jitter, jitter), last[1] + rand(-jitter, jitter)]);
  return out;
}

function toSubpath(points) {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`).join('');
}

/** 글자 하나를 무작위 크기·기울임·회전으로 변환한 subpath 목록 */
function glyphSubpaths(ch, centerX) {
  const scale = rand(2.2, 2.6);
  const skew = rand(-0.25, 0.25);
  const rot = rand(-0.22, 0.22);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cy = SVG_H / 2 + rand(-4, 4);
  return GLYPHS[ch].map((stroke) => {
    const transformed = stroke.map(([gx, gy]) => {
      const lx = (gx - 5) * scale + (gy - 7) * scale * skew;
      const ly = (gy - 7) * scale;
      return [centerX + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    });
    return toSubpath(wobblePolyline(transformed, 0.7));
  });
}

/** 배경 잡선(화면 전체를 가로지름, 얇고 옅게 그린다) */
function noiseCurve() {
  const x1 = rand(0, SVG_W);
  const y1 = rand(0, SVG_H);
  const x2 = rand(0, SVG_W);
  const y2 = rand(0, SVG_H);
  return `M${fmt(x1)} ${fmt(y1)}Q${fmt(rand(0, SVG_W))} ${fmt(rand(0, SVG_H))} ${fmt(x2)} ${fmt(y2)}`;
}

/** 글자 획과 같은 굵기의 짧은 방해 획(사람은 무시하기 쉽지만 획 분리를 어렵게 함) */
function decoyStroke() {
  const x1 = rand(8, SVG_W - 8);
  const y1 = rand(10, SVG_H - 10);
  const len = rand(8, 16);
  const ang = rand(0, Math.PI * 2);
  const x2 = x1 + Math.cos(ang) * len;
  const y2 = y1 + Math.sin(ang) * len;
  return `M${fmt(x1)} ${fmt(y1)}Q${fmt((x1 + x2) / 2 + rand(-5, 5))} ${fmt((y1 + y2) / 2 + rand(-5, 5))} ${fmt(x2)} ${fmt(y2)}`;
}

function buildSvg(code) {
  const gap = SVG_W / (code.length + 1);
  const glyphParts = [];
  for (let i = 0; i < code.length; i += 1) {
    glyphParts.push(...glyphSubpaths(code[i], gap * (i + 1) + rand(-5, 5)));
  }
  const decoys = [];
  for (let i = 0; i < 2; i += 1) decoys.push(decoyStroke());
  const bg = [];
  for (let i = 0; i < 6; i += 1) bg.push(noiseCurve());

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="보안 문자">` +
    `<path d="${shuffle(bg).join('')}" fill="none" stroke="#c4c4c4" stroke-width="1"/>` +
    `<path d="${shuffle([...glyphParts, ...decoys]).join('')}" fill="none" stroke="#0a0a0a" stroke-width="${fmt(rand(2.4, 2.8))}" stroke-linecap="round" stroke-linejoin="round"/>` +
    '</svg>'
  );
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

function createSignupCaptchaChallenge() {
  sweepMaps();
  if (challenges.size >= MAX_CHALLENGES) {
    const oldest = challenges.keys().next().value;
    if (oldest) challenges.delete(oldest);
  }
  const code = randomCode(CODE_LENGTH);
  const id = crypto.randomBytes(16).toString('hex');
  challenges.set(id, { answer: code, exp: Date.now() + CHALLENGE_TTL_MS });
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

/** 소모하지 않고 유효성만 확인(가입 검증 실패 시 1단계를 다시 하지 않도록) */
function isStepPassTokenValid(token) {
  if (!token) return false;
  const row = stepPasses.get(String(token));
  return Boolean(row && row.exp >= Date.now());
}

function consumeStepPassToken(token) {
  sweepMaps();
  if (!isStepPassTokenValid(token)) return false;
  stepPasses.delete(String(token));
  return true;
}

module.exports = {
  createSignupCaptchaChallenge,
  verifySignupCaptchaAndIssueStepPass,
  isStepPassTokenValid,
  consumeStepPassToken,
  // 테스트용
  _CHARSET: CHARSET,
  _GLYPHS: GLYPHS,
};
