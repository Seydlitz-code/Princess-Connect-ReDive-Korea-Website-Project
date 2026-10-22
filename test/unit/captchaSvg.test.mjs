/** 보안 문자 그림 (기존 tests/signupCaptcha.test.js의 그림 부분 이식. 1회용 검증은 통합 테스트가 맡는다) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCaptchaSvg, CAPTCHA_CHARSET, createCaptchaCode, GLYPHS, normalizeCaptchaAnswer } from '../../src/lib/captchaSvg.ts';

test('모든 문자에 글리프가 정의돼 있다', () => {
  for (const ch of CAPTCHA_CHARSET) {
    assert.ok(Array.isArray(GLYPHS[ch]) && GLYPHS[ch].length > 0, `글리프 없음: ${ch}`);
  }
});

test('SVG에 정답 텍스트가 드러나지 않는다', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = createCaptchaCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
    const svg = buildCaptchaSvg(code);
    assert.doesNotMatch(svg, /<text|<tspan|aria-label="[A-Z0-9]{5}"/);
    // path 좌표 외에 영문 대문자 5자 연속이 나오지 않아야 한다(정답 노출 없음)
    const withoutAttrs = svg.replace(/"[^"]*"/g, '""');
    assert.doesNotMatch(withoutAttrs, /[A-HJ-NP-Z2-9]{5}/);
  }
});

test('입력한 답은 공백을 지우고 대문자로 맞춘다', () => {
  assert.equal(normalizeCaptchaAnswer(' ab 2c d '), 'AB2CD');
  assert.equal(normalizeCaptchaAnswer(null), '');
});
