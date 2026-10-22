'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const captcha = require('../lib/signupCaptcha');

test('모든 문자에 글리프가 정의돼 있다', () => {
  for (const ch of captcha._CHARSET) {
    assert.ok(Array.isArray(captcha._GLYPHS[ch]) && captcha._GLYPHS[ch].length > 0, `글리프 없음: ${ch}`);
  }
});

test('SVG 에 정답 텍스트가 드러나지 않는다', () => {
  for (let i = 0; i < 50; i += 1) {
    const { svg } = captcha.createSignupCaptchaChallenge();
    assert.doesNotMatch(svg, /<text|<tspan|aria-label="[A-Z0-9]{5}"/);
    // path 좌표 외에 영문 대문자 5자 연속이 나오지 않아야 한다(정답 노출 없음)
    const withoutAttrs = svg.replace(/"[^"]*"/g, '""');
    assert.doesNotMatch(withoutAttrs, /[A-HJ-NP-Z2-9]{5}/);
  }
});

test('보안 문자 검증은 1회용이다', () => {
  const { id } = captcha.createSignupCaptchaChallenge();
  const wrong = captcha.verifySignupCaptchaAndIssueStepPass(id, 'ZZZZZ');
  assert.equal(wrong.ok, false);
  const again = captcha.verifySignupCaptchaAndIssueStepPass(id, 'ZZZZZ');
  assert.equal(again.ok, false);
  assert.match(again.error, /만료/);
});

test('잘못된 1단계 토큰은 거부된다', () => {
  assert.equal(captcha.isStepPassTokenValid(''), false);
  assert.equal(captcha.isStepPassTokenValid('nope'), false);
  assert.equal(captcha.consumeStepPassToken('nope'), false);
});
