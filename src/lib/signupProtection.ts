/** 회원가입을 열지 판단 (기존 server.js의 getSignupProtection 이식, 순수 함수라 단위 테스트에서 바로 쓴다) */

export type SignupProtectionEnv = {
  RECAPTCHA_SITE_KEY?: string;
  RECAPTCHA_SECRET_KEY?: string;
  ENVIRONMENT?: string;
  ALLOW_SIGNUP_WITHOUT_RECAPTCHA?: string;
};

/**
 * reCAPTCHA(사이트 키 + 시크릿)가 모두 있으면 보안 문자 + reCAPTCHA로 가입을 연다.
 * reCAPTCHA가 없어도 다음 경우에는 보안 문자(+ 시도 제한)만으로 연다:
 * - ENVIRONMENT=development (로컬)
 * - ALLOW_SIGNUP_WITHOUT_RECAPTCHA=true (배포 환경, 2026-10-22 결정: reCAPTCHA 없이 바로 가입을 열기로 함)
 * 키가 하나만 있으면 설정 실수로 보고 가입을 닫는다.
 */
export function getSignupProtection(env: SignupProtectionEnv) {
  const site = String(env.RECAPTCHA_SITE_KEY || '').trim();
  const secret = String(env.RECAPTCHA_SECRET_KEY || '').trim();
  const isRecaptchaConfigured = Boolean(site && secret);
  const isPartial = Boolean(site || secret) && !isRecaptchaConfigured;
  const isCaptchaOnlyAllowed = env.ENVIRONMENT === 'development' || String(env.ALLOW_SIGNUP_WITHOUT_RECAPTCHA || '').trim() === 'true';
  const isAvailable = isRecaptchaConfigured || (!isPartial && isCaptchaOnlyAllowed);
  return { site, secret, isRecaptchaConfigured, isPartial, isAvailable };
}
