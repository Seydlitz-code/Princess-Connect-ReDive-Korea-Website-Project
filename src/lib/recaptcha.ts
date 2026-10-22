/** Google reCAPTCHA v2 서버 확인 (https://developers.google.com/recaptcha/docs/verify) (기존 lib/recaptcha.js 이식) */

export type RecaptchaResult = { success: boolean; 'error-codes'?: string[] };

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

export async function verifyRecaptcha(secret: string, token: string, remoteIp?: string): Promise<RecaptchaResult> {
  if (!secret || !token) return { success: false, 'error-codes': ['missing-input-secret-or-response'] };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.append('remoteip', remoteIp);
  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body
  });
  if (!res.ok) return { success: false, 'error-codes': [`http_${res.status}`] };
  return res.json<RecaptchaResult>();
}
