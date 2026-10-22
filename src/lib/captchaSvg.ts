/**
 * 회원가입 보안 문자 그림(SVG) 만들기 (기존 lib/signupCaptcha.js의 그림 부분 이식, 순수 함수).
 * 글자를 <text>로 내보내면 SVG를 파싱하는 것만으로 정답이 드러나므로, 획을 왜곡한 path로만 그린다.
 */
import { randomInt } from './encoding.ts';

export const CAPTCHA_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CAPTCHA_CODE_LENGTH = 5;

type Point = [number, number];

/** 선분 글리프(가로 0~10, 세로 0~14) */
export const GLYPHS: Record<string, Point[][]> = {
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
  9: [[[10, 6], [8, 8], [2, 8], [0, 6], [0, 2], [2, 0], [8, 0], [10, 3], [10, 10], [7, 14], [2, 14]]]
};

const SVG_WIDTH = 200;
const SVG_HEIGHT = 64;
/** 무작위 실수의 단계 수 (기존 crypto.randomInt(0, 1_000_001)과 같은 해상도) */
const RANDOM_STEPS = 1_000_001;

function randomBetween(min: number, max: number): number {
  return min + (randomInt(RANDOM_STEPS) / (RANDOM_STEPS - 1)) * (max - min);
}

export function createCaptchaCode(): string {
  let code = '';
  for (let i = 0; i < CAPTCHA_CODE_LENGTH; i += 1) code += CAPTCHA_CHARSET[randomInt(CAPTCHA_CHARSET.length)];
  return code;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const formatNumber = (n: number) => n.toFixed(1);

/** 선분을 잘게 나누고 각 점을 흔들어 템플릿 정합을 어렵게 한다. */
function wobblePolyline(points: Point[], jitter: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 6));
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push([x1 + (x2 - x1) * t + randomBetween(-jitter, jitter), y1 + (y2 - y1) * t + randomBetween(-jitter, jitter)]);
    }
  }
  const last = points[points.length - 1];
  out.push([last[0] + randomBetween(-jitter, jitter), last[1] + randomBetween(-jitter, jitter)]);
  return out;
}

function toSubpath(points: Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${formatNumber(x)} ${formatNumber(y)}`).join('');
}

/** 글자 하나를 무작위 크기·기울임·회전으로 변환한 subpath 목록 */
function glyphSubpaths(ch: string, centerX: number): string[] {
  const scale = randomBetween(2.2, 2.6);
  const skew = randomBetween(-0.25, 0.25);
  const rotation = randomBetween(-0.22, 0.22);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centerY = SVG_HEIGHT / 2 + randomBetween(-4, 4);
  return GLYPHS[ch].map((stroke) => {
    const transformed = stroke.map(([gx, gy]): Point => {
      const lx = (gx - 5) * scale + (gy - 7) * scale * skew;
      const ly = (gy - 7) * scale;
      return [centerX + lx * cos - ly * sin, centerY + lx * sin + ly * cos];
    });
    return toSubpath(wobblePolyline(transformed, 0.7));
  });
}

/** 배경 잡선(화면 전체를 가로지름, 얇고 옅게 그린다) */
function noiseCurve(): string {
  const x1 = randomBetween(0, SVG_WIDTH);
  const y1 = randomBetween(0, SVG_HEIGHT);
  const x2 = randomBetween(0, SVG_WIDTH);
  const y2 = randomBetween(0, SVG_HEIGHT);
  return `M${formatNumber(x1)} ${formatNumber(y1)}Q${formatNumber(randomBetween(0, SVG_WIDTH))} ${formatNumber(randomBetween(0, SVG_HEIGHT))} ${formatNumber(x2)} ${formatNumber(y2)}`;
}

/** 글자 획과 같은 굵기의 짧은 방해 획(사람은 무시하기 쉽지만 획 분리를 어렵게 함) */
function decoyStroke(): string {
  const x1 = randomBetween(8, SVG_WIDTH - 8);
  const y1 = randomBetween(10, SVG_HEIGHT - 10);
  const length = randomBetween(8, 16);
  const angle = randomBetween(0, Math.PI * 2);
  const x2 = x1 + Math.cos(angle) * length;
  const y2 = y1 + Math.sin(angle) * length;
  return `M${formatNumber(x1)} ${formatNumber(y1)}Q${formatNumber((x1 + x2) / 2 + randomBetween(-5, 5))} ${formatNumber((y1 + y2) / 2 + randomBetween(-5, 5))} ${formatNumber(x2)} ${formatNumber(y2)}`;
}

export function buildCaptchaSvg(code: string): string {
  const gap = SVG_WIDTH / (code.length + 1);
  const glyphParts: string[] = [];
  for (let i = 0; i < code.length; i += 1) {
    glyphParts.push(...glyphSubpaths(code[i], gap * (i + 1) + randomBetween(-5, 5)));
  }
  const decoys = [decoyStroke(), decoyStroke()];
  const background = Array.from({ length: 6 }, noiseCurve);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="보안 문자">` +
    `<path d="${shuffle(background).join('')}" fill="none" stroke="#c4c4c4" stroke-width="1"/>` +
    `<path d="${shuffle([...glyphParts, ...decoys]).join('')}" fill="none" stroke="#0a0a0a" stroke-width="${formatNumber(randomBetween(2.4, 2.8))}" stroke-linecap="round" stroke-linejoin="round"/>` +
    '</svg>'
  );
}

/** 사용자가 입력한 답을 비교용으로 맞춘다 (대문자, 공백 제거) */
export function normalizeCaptchaAnswer(answer: unknown): string {
  return String(answer ?? '').trim().toUpperCase().replace(/\s+/g, '');
}
