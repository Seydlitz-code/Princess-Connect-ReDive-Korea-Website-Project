/**
 * 브라우저 E2E: 글쓰기·텍틱 표·수정·추천·댓글·필터·검색·보안 검증·세션·관리자 미래시.
 * tests/e2e/run-all.mjs 가 서버와 테스트 계정을 준비한 뒤 실행한다.
 * 브라우저: E2E_BROWSER_PATH(예: Edge/Chrome 실행 파일) 또는 playwright-core 가 설치한 chromium
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://127.0.0.1:3999';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER_PATH || undefined, headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
const cspViolations = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text()); });
page.on('dialog', (d) => { console.log('   [dialog]', d.message()); d.accept(); });

async function login(username, password) {
  await page.goto(BASE + '/');
  await page.click('#open-login');
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-submit-btn');
  await page.waitForSelector('#header-actions-logged:not([hidden])', { timeout: 5000 });
}

async function selectAllIn(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, selector);
}

// ── 로그인 ──
await login('testeruser', 'password123');
check('로그인', true);
const cookieAfterLogin = (await ctx.cookies()).find((c) => c.name === 'priconne_sid');

// ── 1. 자유 게시판 글쓰기 ──
await page.click('.nav-link[data-board="free"]');
await page.click('#free-write-open');
check('자유게시판: 게시물 구분 숨김', await page.locator('#clan-write-category-field').isHidden());
await page.fill('#clan-write-title', '자유 테스트 글');
await page.click('#clan-write-content');
await page.keyboard.type('자유 게시판 본문입니다');
await page.click('#clan-write-submit');
await page.waitForSelector('.clan-detail-title', { timeout: 5000 }).catch(() => {});
const freeTitle = await page.locator('.clan-detail-title').textContent().catch(() => '');
check('자유게시판 글 작성 성공', freeTitle.includes('자유 테스트 글'), freeTitle);
check('자유게시판 상세: 게시판명', (await page.locator('#clan-detail-board-title').textContent()).includes('자유'));

// ── 2. 클랜전 글쓰기: 분류 + 글꼴 + 텍틱 표 ──
await page.click('.nav-link[data-board="clan-all"]');
await page.click('#clan-write-open');
await page.selectOption('#clan-write-year', '2026');
await page.selectOption('#clan-write-month', '10');
await page.selectOption('#clan-write-stage', '3');
await page.selectOption('#clan-write-named', '2');
await page.fill('#clan-write-title', '클랜전 텍틱 테스트');
await page.click('#clan-write-content');
await page.keyboard.type('작은글씨');
await selectAllIn('#clan-write-content');
await page.selectOption('#clan-write-fontsize', '12');
const small = await page.evaluate(() => getComputedStyle(document.querySelector('#clan-write-content span')).fontSize);
await page.evaluate(() => {
  const c = document.getElementById('clan-write-content');
  const p = document.createElement('div');
  p.id = 'big-line';
  p.textContent = '큰글씨';
  c.appendChild(p);
  const r = document.createRange();
  r.selectNodeContents(p);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
await page.selectOption('#clan-write-fontsize', '40');
const big = await page.evaluate(() => getComputedStyle(document.querySelector('#big-line span')).fontSize);
check('글꼴 크기 12px 적용', small === '12px', small);
check('글꼴 크기 40px 적용', big === '40px', big);

// 텍틱 표 삽입(커서는 에디터 끝)
await page.evaluate(() => {
  const c = document.getElementById('clan-write-content');
  const r = document.createRange(); r.selectNodeContents(c); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
});
const errorsBefore = pageErrors.length;
await page.click('#clan-write-btn-tactic');
check('텍틱 표 삽입 시 예외 없음', pageErrors.length === errorsBefore, pageErrors.slice(errorsBefore).join(' | '));
await page.selectOption('.clan-tactic-table__theme-select', '3');
await page.fill('.clan-tactic-table__damage-input', '12a345');
check('데미지 입력 숫자 필터', (await page.inputValue('.clan-tactic-table__damage-input')) === '12345');
await page.selectOption('.clan-tactic-table__dropdown--extra', 'X');
// 시간 1:99 → 1:30 보정
await page.fill('.clan-tactic-table__time-min', '1');
await page.fill('.clan-tactic-table__time-sec', '99');
check('시간 입력 보정(1:99→1:30)', (await page.inputValue('.clan-tactic-table__time-sec')) === '30');
// 캐릭터 1명 추가 → 성급 5 선택
await page.click('.clan-tactic-table__char-cell[data-tactic-slot="1"] .clan-tactic-table__char-btn');
await page.waitForSelector('#tactic-character-popup:not([hidden]) .tactic-char-picker-btn');
await page.click('#tactic-character-popup .tactic-char-picker-btn >> nth=0');
await page.click('#tactic-character-popup-confirm');
await page.waitForSelector('.clan-tactic-table__char-cell[data-tactic-slot="1"] .clan-tactic-table__boss-img');
await page.click('.clan-tactic-table__star-grade-cell[data-tactic-slot="1"] .clan-tactic-table__star-grade-trigger');
await page.click('.clan-tactic-table__star-grade-cell[data-tactic-slot="1"] .clan-tactic-table__star-grade-option[data-grade="5"]');
check('성급 선택(새 표)', (await page.locator('.clan-tactic-table__star-grade-cell[data-tactic-slot="1"] .clan-tactic-table__star-grade-label').textContent()) === '5성');
await page.fill('.clan-tactic-table__rank-input-cell[data-tactic-slot="1"] .clan-tactic-table__rank-input', '25');
// SET 여부 slot1 → OFF
await page.selectOption('.clan-tactic-table__input-row .clan-tactic-table__auto-cell[data-tactic-slot="1"] select', 'X');
await page.click('.clan-tactic-table__add-tactic-btn');
check('텍틱 행 추가', (await page.locator('.clan-tactic-table__input-row').count()) === 2);

// 동영상(data:) — CSP 위반이 없어야 함
const cspBefore = cspViolations.length;
await page.evaluate(() => {
  const v = document.createElement('video');
  v.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29t';
  v.setAttribute('controls', '');
  document.getElementById('clan-write-content').appendChild(v);
});
await page.waitForTimeout(300);
check('data: 동영상 CSP 허용', cspViolations.length === cspBefore, cspViolations.slice(cspBefore).join(' | '));

await page.click('#clan-write-submit');
await page.waitForSelector('.clan-detail-title', { timeout: 5000 });
check('클랜전 글 작성 성공', (await page.locator('.clan-detail-title').textContent()).includes('클랜전 텍틱 테스트'));
check('카테고리 배지 = 2넴', (await page.locator('.clan-detail-category-badge').textContent()) === '2넴');
const detail = await page.evaluate(() => {
  const b = document.querySelector('.clan-detail-body');
  return {
    auto: b.querySelector('.clan-tactic-table__dropdown--extra')?.value,
    set1: b.querySelector('.clan-tactic-table__input-row .clan-tactic-table__auto-cell[data-tactic-slot="1"] select')?.value,
    theme: b.querySelector('.clan-tactic-table__theme-select')?.value,
    themeBg: b.querySelector('.clan-tactic-table__theme-row')?.style.background,
    dmg: b.querySelector('.clan-tactic-table__damage-input')?.value,
    star: b.querySelector('.clan-tactic-table__star-grade-label')?.textContent,
    rank: b.querySelector('.clan-tactic-table__rank-input')?.value,
    timeSec: b.querySelector('.clan-tactic-table__time-sec')?.value,
    charImg: b.querySelector('.clan-tactic-table__char-cell .clan-tactic-table__boss-img')?.getAttribute('src'),
    charImgLoaded: b.querySelector('.clan-tactic-table__char-cell .clan-tactic-table__boss-img')?.complete,
    bigFont: [...b.querySelectorAll('span')].some((s) => s.style.fontSize === '40px'),
    video: Boolean(b.querySelector('video[src^="data:video/"]')),
    rows: b.querySelectorAll('.clan-tactic-table__input-row').length,
    carryBtn: Boolean(b.querySelector('.clan-tactic-table__carryover-btn')),
  };
});
check('저장 후 Auto 여부 = OFF 유지', detail.auto === 'X', String(detail.auto));
check('저장 후 SET 여부 = OFF 유지', detail.set1 === 'X', String(detail.set1));
check('저장 후 테마 3 유지', detail.theme === '3' && /255, 235, 59|ffeb3b/i.test(detail.themeBg || ''), `${detail.theme} ${detail.themeBg}`);
check('저장 후 데미지·랭크·시간·성급 유지', detail.dmg === '12345' && detail.rank === '25' && detail.timeSec === '30' && detail.star === '5성', JSON.stringify(detail));
check('저장 후 캐릭터 이미지(정적 경로)', /^\/characters\//.test(detail.charImg || ''), detail.charImg);
check('저장 후 글꼴 40px 유지', detail.bigFont);
check('저장 후 동영상 유지', detail.video);
check('저장 후 텍틱 행 2개 + 이월타 버튼', detail.rows === 2 && detail.carryBtn);
const clanPostId = page.url().split('/').pop();

// ── 3. 수정 모드: 다시 불러온 표의 동작 ──
await page.click('#clan-detail-edit-btn');
await page.waitForSelector('#clan-write-content .clan-tactic-table');
check('수정 모드: 분류 값 복원', (await page.inputValue('#clan-write-named')) === '2' && (await page.inputValue('#clan-write-year')) === '2026');
await page.click('#clan-write-content .clan-tactic-table__star-grade-trigger');
check('수정 모드: 성급 메뉴 열림', await page.locator('#clan-write-content .clan-tactic-table__star-grade-menu').isVisible());
await page.click('#clan-write-content .clan-tactic-table__star-grade-option[data-grade="2"]');
check('수정 모드: 성급 변경', (await page.locator('#clan-write-content .clan-tactic-table__star-grade-label').textContent()) === '2성');
await page.fill('#clan-write-content .clan-tactic-table__time-sec >> nth=1', '77');
check('수정 모드: 시간 보정(0:77→0:59)', (await page.inputValue('#clan-write-content .clan-tactic-table__time-sec >> nth=1')) === '59');
await page.selectOption('#clan-write-content .clan-tactic-table__theme-select', '5');
await page.click('#clan-write-content .clan-tactic-table__delete-tactic-btn');
check('수정 모드: 텍틱 행 삭제', (await page.locator('#clan-write-content .clan-tactic-table__input-row').count()) === 1);
await page.click('#clan-write-submit');
await page.waitForSelector('.clan-detail-body .clan-tactic-table');
const edited = await page.evaluate(() => ({
  star: document.querySelector('.clan-detail-body .clan-tactic-table__star-grade-label')?.textContent,
  theme: document.querySelector('.clan-detail-body .clan-tactic-table__theme-select')?.value,
}));
check('수정 저장 반영(성급 2, 테마 5)', edited.star === '2성' && edited.theme === '5', JSON.stringify(edited));

// 수정 모드에서 표 전체 삭제 버튼
await page.click('#clan-detail-edit-btn');
await page.waitForSelector('#clan-write-content .clan-tactic-table');
await page.click('#clan-write-content .clan-tactic-table__delete-btn');
check('수정 모드: 표 삭제 버튼', (await page.locator('#clan-write-content .clan-tactic-table').count()) === 0);
await page.click('#clan-write-cancel');

// ── 4. 추천·댓글 (URL 직접 진입) ──
await page.goto(`${BASE}/clan-board/post/${clanPostId}`);
await page.waitForSelector('#clan-like-btn:not([disabled])');
await page.waitForSelector('#header-actions-logged:not([hidden])');
check('URL 직접 진입 시 댓글 폼 표시(로그인)', await page.locator('#clan-comment-write-form').isVisible());
await page.click('#clan-like-btn');
await page.waitForTimeout(400);
const like1 = await page.locator('#clan-like-count').textContent();
await page.click('#clan-like-btn');
await page.waitForTimeout(400);
const like0 = await page.locator('#clan-like-count').textContent();
check('추천 토글(1→0)', like1 === '1' && like0 === '0', `${like1}->${like0}`);
await page.fill('#clan-comment-input', '댓글 테스트');
await page.click('#clan-comment-submit');
await page.waitForSelector('.clan-comment-item');
check('댓글 작성 + 개수 갱신', (await page.locator('#clan-comment-count').textContent()) === '1');

// ── 5. 목록 필터·검색 ──
const api = async (path, opts) => page.evaluate(async ([p, o]) => {
  const r = await fetch(p, o);
  return { status: r.status, body: await r.json().catch(() => null), headers: Object.fromEntries(r.headers) };
}, [path, opts || {}]);
let r = await api('/api/clan-board/posts?named=2&year=2026');
check('필터(2네임드·2026) 결과 포함', r.body.posts.some((p) => p.id === clanPostId));
r = await api('/api/clan-board/posts?named=4');
check('필터(4네임드) 결과 제외', !r.body.posts.some((p) => p.id === clanPostId));
r = await api('/api/clan-board/posts?search=' + encodeURIComponent('작은글씨'));
check('본문 검색', r.body.posts.some((p) => p.id === clanPostId));
r = await api('/api/clan-board/posts?search=' + encodeURIComponent('base64'));
check('검색이 base64/태그를 매칭하지 않음', !r.body.posts.some((p) => p.id === clanPostId));
r = await api('/api/clan-board/posts?search=%25');
check('검색 % 와일드카드 이스케이프', r.status === 200 && r.body.posts.length === 0, String(r.body.posts.length));
check('목록 응답에 프로필 이미지 없음', !JSON.stringify(r.body).includes('data:image'));
r = await api('/api/clan-board/posts?board=free');
check('자유게시판 목록', r.body.posts.some((p) => p.title === '자유 테스트 글'));
r = await api('/api/clan-board/posts?board=hack');
check('잘못된 board 400', r.status === 400);

// 0건 검색 후에도 검색창 유지
await page.click('.nav-link[data-board="free"]');
await page.waitForSelector('#free-board-bottom-search');
await page.fill('#free-board-bottom-search', '존재하지않는검색어zz');
await page.click('#free-board-bottom-search-btn');
await page.waitForTimeout(600);
check('0건 검색 후 검색창 유지', await page.locator('#free-board-bottom-search').isVisible());

// 마이페이지 타이틀
await page.click('#header-open-mypage');
await page.waitForTimeout(400);
check('마이페이지 헤더 타이틀 표시', await page.locator('#header-mypage-title').isVisible());
await page.click('#mypage-to-main');

// ── 6. 서버 검증 ──
r = await api('/api/clan-board/posts/abc');
check('잘못된 게시물 ID → 404', r.status === 404, String(r.status));
r = await api('/api/clan-board/posts/abc/view', { method: 'PATCH' });
check('잘못된 ID 조회수 → 404', r.status === 404);
r = await api('/api/clan-board/posts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ board: 'free', title: 'xss', content: '<p>ok</p><img src=x onerror="alert(1)"><script>alert(2)</script><div class="modal" style="position:fixed;color:#ff0000">x</div><a href="javascript:alert(3)">l</a><img src="https://evil.example/x.png"><iframe src="https://evil.example"></iframe>' }),
});
const xssId = r.body?.id;
r = await api('/api/clan-board/posts/' + xssId);
const stored = r.body?.post?.content || '';
check('XSS 정제(script/onerror/javascript:/외부 img/iframe/position 제거)',
  !/script|onerror|javascript:|evil\.example|iframe|position|modal/i.test(stored) && stored.includes("color:#ff0000"), stored);
r = await api('/api/clan-board/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'clan', title: 'x', content: '<p>x</p>', sub_board: 'clan-semi' }) });
check('클랜전 글 분류 누락 → 400', r.status === 400, r.body?.error);
r = await api('/api/clan-board/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'free', title: '가'.repeat(51), content: '<p>x</p>' }) });
check('제목 51자 → 400', r.status === 400);
r = await api('/api/clan-board/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
check('잘못된 JSON → 400(JSON 응답)', r.status === 400 && r.body?.ok === false);
// 조회수 중복 방지
const v1 = await api(`/api/clan-board/posts/${clanPostId}/view`, { method: 'PATCH' });
const v2 = await api(`/api/clan-board/posts/${clanPostId}/view`, { method: 'PATCH' });
check('같은 사용자 조회수 중복 미집계', v2.body.view_count === v1.body.view_count && v2.body.counted === false);
// 동시 추천
const multi = await page.evaluate(async (id) => {
  const rs = await Promise.all([1, 2, 3, 4].map(() => fetch(`/api/clan-board/posts/${id}/likes`, { method: 'POST' })));
  return rs.map((x) => x.status);
}, clanPostId);
check('동시 추천 요청 500 없음', multi.every((s) => s === 200), multi.join(','));

// ── 7. 정적 이미지가 rate limit 에 걸리지 않음 ──
const burst = await page.evaluate(async () => {
  const list = (await (await fetch('/api/characters')).json()).characters;
  const statuses = {};
  for (let i = 0; i < 400; i += 1) {
    const res = await fetch(list[i % list.length].imageUrl, { cache: 'no-store' });
    statuses[res.status] = (statuses[res.status] || 0) + 1;
  }
  const cfg = await fetch('/api/config');
  return { statuses, cfg: cfg.status, cache: (await fetch(list[0].imageUrl, { cache: 'no-store' })).headers.get('cache-control') };
});
check('이미지 400장 요청에도 429 없음', !burst.statuses['429'] && burst.cfg === 200, JSON.stringify(burst));
check('캐릭터 이미지 캐시 헤더', /max-age=86400/.test(burst.cache || ''), burst.cache);

// ── 8. 캡차 ──
r = await api('/api/signup/captcha');
check('캡차 SVG 에 <text> 없음', r.status === 200 && !/<text/i.test(r.body.svg));
const naive = [...r.body.svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]).join('');
r = await api('/api/signup/verify-step1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ captchaId: r.body.id, captchaAnswer: naive || 'AAAAA' }) });
check('SVG 파싱 공격 실패', r.status === 400);

// ── 8-1. 회원가입 모달: 비밀번호 눈 아이콘 ──
await page.goto(BASE + '/');
await page.waitForSelector('#header-actions-logged:not([hidden])');
await page.click('#header-logout');
await page.waitForSelector('#header-actions-guest:not([hidden])');
await page.click('#open-signup');
const eye = async () => page.evaluate(() => ({
  type: document.getElementById('password').type,
  open: getComputedStyle(document.querySelector('#password-visibility .pw-eye-open')).display !== 'none',
  shut: getComputedStyle(document.querySelector('#password-visibility .pw-eye-shut')).display !== 'none',
}));
const e0 = await eye();
await page.click('#password-visibility');
const e1 = await eye();
check('비밀번호 눈 아이콘 토글', e0.type === 'password' && e0.open && !e0.shut && e1.type === 'text' && !e1.open && e1.shut, JSON.stringify([e0, e1]));
check('회원가입 보안문자 이미지 표시', (await page.locator('#signup-captcha-svg svg path').count()) >= 2);
await page.keyboard.press('Escape');
await login('testeruser', 'password123');

// ── 9. 로그아웃 후 기존 쿠키 재사용 차단 ──
await page.click('#header-logout');
await page.waitForSelector('#header-actions-guest:not([hidden])');
await ctx.addCookies([cookieAfterLogin]);
r = await api('/api/me');
check('로그아웃한 세션 쿠키 재사용 불가', r.body.user === null);
r = await api('/api/clan-board/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'free', title: 'x', content: 'x' }) });
check('로그아웃 쿠키로 글쓰기 → 401', r.status === 401);

// ── 10. 관리자 미래시 저장 ──
await ctx.clearCookies();
await login('adminuserr', 'adminpass123');
const chars = (await api('/api/characters')).body.characters;
const fs1 = await api('/api/future-sight');
const months = fs1.body.data.months;
months[0].categories.new = [{ characterId: chars[0].id, type: 'limited' }];
r = await api('/api/admin/future-sight', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { version: 1, months } }) });
check('관리자 미래시 저장', r.status === 200 && r.body.data.months[0].categories.new[0]?.id === chars[0].id, String(r.status));
r = await api('/api/future-sight');
check('미래시 조회 반영', r.body.data.months[0].categories.new[0]?.name === chars[0].name);
await page.goto(BASE + '/');
await page.waitForSelector('.future-char-card');
check('메인 미래시 카드 렌더링', (await page.locator('.future-char-card').count()) >= 1);

check('페이지 JS 오류 없음', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
