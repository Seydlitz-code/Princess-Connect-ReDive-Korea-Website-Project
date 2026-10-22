'use strict';

/**
 * 테스트 전용 프리로드: node -r tests/e2e/captcha-stub.cjs server.js
 * 보안 문자 답이 'TESTPASS' 면 1단계를 통과시킨다. 운영 코드에는 우회 경로가 없고,
 * 회원가입 API 흐름을 자동 검증할 때만 이 파일로 모듈을 바꿔 끼운다.
 */

const path = require('path');
const crypto = require('crypto');

const modPath = path.join(__dirname, '..', '..', 'lib', 'signupCaptcha.js');
const real = require(modPath);
const passes = new Set();

require.cache[require.resolve(modPath)].exports = {
  ...real,
  verifySignupCaptchaAndIssueStepPass(id, answer) {
    if (answer !== 'TESTPASS') return { ok: false, error: '보안 문자가 일치하지 않습니다.' };
    const token = crypto.randomBytes(12).toString('hex');
    passes.add(token);
    return { ok: true, stepPassToken: token };
  },
  isStepPassTokenValid: (token) => passes.has(token),
  consumeStepPassToken: (token) => passes.delete(token),
};
