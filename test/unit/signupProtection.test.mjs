/** 회원가입을 열지 판단하는 규칙 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSignupProtection } from '../../src/lib/signupProtection.ts';

const KEYS = { RECAPTCHA_SITE_KEY: 'site', RECAPTCHA_SECRET_KEY: 'secret' };

test('reCAPTCHA 키가 모두 있으면 연다', () => {
  const p = getSignupProtection(KEYS);
  assert.deepEqual([p.isAvailable, p.isRecaptchaConfigured, p.isPartial], [true, true, false]);
});

test('키가 없으면 설정값에 따라 보안 문자만으로 연다', () => {
  assert.equal(getSignupProtection({}).isAvailable, false);
  assert.equal(getSignupProtection({ ALLOW_SIGNUP_WITHOUT_RECAPTCHA: 'false' }).isAvailable, false);
  assert.equal(getSignupProtection({ ALLOW_SIGNUP_WITHOUT_RECAPTCHA: 'true' }).isAvailable, true);
  assert.equal(getSignupProtection({ ALLOW_SIGNUP_WITHOUT_RECAPTCHA: ' true ' }).isAvailable, true);
  assert.equal(getSignupProtection({ ENVIRONMENT: 'development' }).isAvailable, true);
  assert.equal(getSignupProtection({ ENVIRONMENT: 'production' }).isAvailable, false);
});

test('키가 하나만 있으면 설정 실수로 보고 닫는다', () => {
  for (const env of [{ RECAPTCHA_SITE_KEY: 'site' }, { RECAPTCHA_SECRET_KEY: 'secret' }]) {
    const p = getSignupProtection({ ...env, ALLOW_SIGNUP_WITHOUT_RECAPTCHA: 'true', ENVIRONMENT: 'development' });
    assert.deepEqual([p.isAvailable, p.isPartial], [false, true]);
  }
});
