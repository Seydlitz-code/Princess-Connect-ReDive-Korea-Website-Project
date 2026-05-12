'use strict';

/**
 * Google reCAPTCHA v2 siteverify (https://developers.google.com/recaptcha/docs/verify )
 */

async function verifyRecaptchaResponse({ secret, token, remoteip }) {
  if (!secret || !token) {
    return { success: false, 'error-codes': ['missing-input-secret-or-response'] };
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.append('remoteip', remoteip);

  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });

  if (!res.ok) {
    return { success: false, 'error-codes': [`http_${res.status}`] };
  }
  return res.json();
}

module.exports = { verifyRecaptchaResponse };
