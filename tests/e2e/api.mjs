/**
 * 회원가입 API 흐름(캡차 스텁 서버) + 운영 모드 서버 점검: node api.mjs <stubUrl> <prodUrl>
 * tests/e2e/run-all.mjs 가 서버와 테스트 계정을 준비한 뒤 실행한다.
 */
const DEV = process.argv[2] || 'http://127.0.0.1:4000';
const PROD = process.argv[3] || 'http://127.0.0.1:4001';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const chars = (await (await fetch(DEV + '/api/characters')).json()).characters;
const step = async () => (await (await post(DEV, '/api/signup/verify-step1', { captchaId: 'x', captchaAnswer: 'TESTPASS' })).json()).stepPassToken;
const uname = 'signupuser' + 'abcdefghij'[Math.floor(Math.random() * 10)] + 'x';
const base = { username: uname, nickname: '가입자' + 'ㄱㄴㄷㄹ'[Math.floor(Math.random() * 4)], password: 'password123', characterIds: [chars[0].id, chars[1].id], recaptchaToken: '' };

let r = await post(DEV, '/api/register', { ...base, stepPassToken: 'bogus' });
check('잘못된 1단계 토큰 → 400', r.status === 400);

let token = await step();
r = await post(DEV, '/api/register', { ...base, nickname: '테스터', stepPassToken: token });
check('닉네임 중복 → 409', r.status === 409, (await r.json()).error);
r = await post(DEV, '/api/register', { ...base, stepPassToken: token });
const reg = await r.json();
check('중복 실패 후 같은 1단계 토큰으로 가입 성공(토큰 미소모)', r.status === 201, JSON.stringify(reg).slice(0, 120));
r = await post(DEV, '/api/register', { ...base, username: uname + 'q', nickname: '다른닉', stepPassToken: token });
check('가입에 쓴 토큰 재사용 불가', r.status === 400);
r = await post(DEV, '/api/register', { ...base, profileImage: 'data:image/svg+xml;base64,PHN2Zz4=', username: uname + 'z', nickname: '새닉', stepPassToken: await step() });
check('SVG 프로필 이미지 거부', r.status === 400);

r = await post(DEV, '/api/login', { username: uname, password: 'password123' });
const cookie = r.headers.get('set-cookie') || '';
check('가입 계정 로그인', r.status === 200 && /priconne_sid=/.test(cookie));
const me = await (await fetch(DEV + '/api/me/owned-characters', { headers: { cookie: cookie.split(';')[0] } })).json();
check('가입 시 보유 캐릭터 2명 저장', me.characters?.length === 2);
check('개발 모드 쿠키에는 Secure 없음', !/Secure/i.test(cookie));

// 운영 모드
let cfg = await (await fetch(PROD + '/api/config')).json();
check('운영: reCAPTCHA 미설정 시 signupAvailable=false', cfg.signupAvailable === false);
r = await fetch(PROD + '/api/signup/captcha');
check('운영: 보안문자 발급 503', r.status === 503);
r = await post(PROD, '/api/register', { ...base, stepPassToken: 'x' });
check('운영: 가입 503', r.status === 503);
const health = await (await fetch(PROD + '/api/health')).json();
check('운영: health 에 환경 변수 이름 목록 없음', !('postgresUriKeySample' in health.database), JSON.stringify(health.database).slice(0, 160));
r = await post(PROD, '/api/login', { username: uname, password: 'password123' });
check('운영: 세션 쿠키 Secure·HttpOnly·SameSite', /Secure/.test(r.headers.get('set-cookie')) && /HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Lax/.test(r.headers.get('set-cookie')));
const head = await fetch(PROD + '/');
check('보안 헤더(CSP media-src, nosniff, x-powered-by 없음)',
  /media-src 'self' data:/.test(head.headers.get('content-security-policy')) && head.headers.get('x-content-type-options') === 'nosniff' && !head.headers.get('x-powered-by'));
check('index.html no-cache', /no-cache/.test(head.headers.get('cache-control') || ''));
r = await fetch(PROD + '/api/does-not-exist', { method: 'POST' });
check('알 수 없는 API → JSON 404', r.status === 404 && (await r.json()).ok === false);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
