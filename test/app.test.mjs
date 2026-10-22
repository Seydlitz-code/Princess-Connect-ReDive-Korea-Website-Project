/**
 * 통합 테스트: wrangler dev(로컬 D1)를 띄우고 public/js/main.js가 쓰는 API를 실제로 호출한다.
 * 실행: npm test (단위 테스트와 함께) — wrangler dev 기동에 20~40초 걸린다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ADMIN, Client, ROOT, runD1Sql, seedCaptchaChallenges, startServer } from './helpers.mjs';

const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'characters.json'), 'utf8'));
const [CHAR_A, CHAR_B] = manifest.characters;
const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';
const CLAN_FIELDS = { board: 'clan', sub_board: 'clan-semi', year: '2026', month: '10', stage: '2', named: '3' };

let server;
let challenges;

before(async () => {
  server = await startServer();
  challenges = seedCaptchaChallenges(server.persistDir, 8);
});

after(async () => {
  await server?.stop();
});

const nextChallenge = () => challenges.shift();

describe('공개 API·정적 파일', () => {
  it('설정·상태 확인', async () => {
    const client = new Client(server.base);
    const config = await client.get('/api/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.data, { ok: true, recaptchaSiteKey: null, signupAvailable: true });
    const health = await client.get('/api/health');
    assert.equal(health.data.database.poolReady, true);
    assert.equal(health.data.session.secretConfigured, true);
  });

  it('API 응답에 보안 헤더를 붙인다', async () => {
    const res = await new Client(server.base).get('/api/config');
    assert.match(res.headers.get('content-security-policy'), /script-src 'self' https:\/\/www\.google\.com/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  });

  it('캐릭터 목록과 이미지', async () => {
    const client = new Client(server.base);
    const list = await client.get('/api/characters');
    assert.equal(list.data.source, 'library');
    assert.ok(list.data.characters.length > 300);
    const names = list.data.characters.map((ch) => ch.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ko')));

    const image = await fetch(`${server.base}/api/characters/${CHAR_A.id}/image`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), CHAR_A.imageMime);
    const bytes = new Uint8Array(await image.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

    assert.equal((await client.get('/api/characters/not-a-uuid/image')).status, 400);
    assert.equal((await client.get(`/api/characters/${UNKNOWN_UUID}/image`)).status, 404);
    const staticImage = await fetch(server.base + CHAR_A.imageUrl);
    assert.equal(staticImage.status, 200);
    assert.equal(staticImage.headers.get('cache-control'), 'public, max-age=86400');
  });

  it('없는 API는 JSON 404, 그 밖의 주소는 index.html', async () => {
    const client = new Client(server.base);
    const api = await client.get('/api/nope');
    assert.equal(api.status, 404);
    assert.equal(api.data.ok, false);
    const page = await client.get('/clan-board/some-post', { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.match(page.text, /<!DOCTYPE html>/i);
    assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
  });

  it('다른 사이트에서 보낸 쓰기 요청은 막는다', async () => {
    const res = await new Client(server.base).post('/api/logout', {}, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
  });

  it('너무 큰 본문은 413, 깨진 JSON은 400', async () => {
    const client = new Client(server.base);
    const big = await client.request('POST', '/api/login', {
      body: JSON.stringify({ username: 'x'.repeat(2.2 * 1024 * 1024) }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(big.status, 413);
    const broken = await client.request('POST', '/api/login', { body: '{bad', headers: { 'Content-Type': 'application/json' } });
    assert.equal(broken.status, 400);
    assert.equal(broken.data.error, '요청 형식이 올바르지 않습니다.');
  });
});

describe('회원가입·로그인', () => {
  const user = { username: 'TesterUser', nickname: '테스터', password: 'password123' };

  it('보안 문자 그림을 받고, 틀린 답은 1회용으로 거부한다', async () => {
    const client = new Client(server.base);
    const captcha = await client.get('/api/signup/captcha');
    assert.equal(captcha.status, 200);
    assert.match(captcha.data.svg, /^<svg[^>]*>.*<\/svg>$/);
    assert.doesNotMatch(captcha.data.svg, /<text/);
    assert.equal(captcha.headers.get('cache-control'), 'no-store');
    const wrong = await client.post('/api/signup/verify-step1', { captchaId: captcha.data.id, captchaAnswer: 'ZZZZZ' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error, '보안 문자가 일치하지 않습니다.');
    const again = await client.post('/api/signup/verify-step1', { captchaId: captcha.data.id, captchaAnswer: 'ZZZZZ' });
    assert.match(again.data.error, /만료/);
  });

  it('입력 검증', async () => {
    const client = new Client(server.base);
    const challenge = nextChallenge();
    const step = await client.post('/api/signup/verify-step1', { captchaId: challenge.id, captchaAnswer: ` ${challenge.answer} ` });
    assert.equal(step.status, 200);
    const token = step.data.stepPassToken;
    const cases = [
      [{ username: 'short' }, /아이디는 영문만/],
      [{ username: 'validname', nickname: 'a' }, /닉네임은 2~10자/],
      [{ username: 'validname', nickname: '닉네임!!' }, /한국어, 영어, 일본어/],
      [{ username: 'validname', nickname: '좋은닉', password: 'short' }, /비밀번호는 8~72자/],
      [{ username: 'validname', nickname: '좋은닉', profileImage: 'data:text/html;base64,AAAA' }, /PNG·JPEG/],
      [{ username: 'validname', nickname: '좋은닉', deferOwnedCharacters: false }, /보유 캐릭터를 한 명 이상/],
      [{ username: 'validname', nickname: '좋은닉', characterIds: [UNKNOWN_UUID], deferOwnedCharacters: false }, /목록에 없는 캐릭터/]
    ];
    for (const [fields, pattern] of cases) {
      const res = await client.post('/api/register', { stepPassToken: token, password: 'password123', deferOwnedCharacters: true, ...fields });
      assert.equal(res.status, 400, JSON.stringify(fields));
      assert.match(res.data.error, pattern);
    }
    const expired = await client.post('/api/register', { stepPassToken: 'nope', username: 'validname', nickname: '좋은닉', password: 'password123', deferOwnedCharacters: true });
    assert.match(expired.data.error, /1단계가 만료/);
  });

  it('가입 → 중복 확인 → 로그인 → 내 정보 → 로그아웃', async () => {
    const client = new Client(server.base);
    const res = await client.register(nextChallenge(), { ...user, characterIds: [CHAR_A.id], deferOwnedCharacters: false });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.data.user.username, 'testeruser');
    assert.equal(res.data.user.nickname, user.nickname);
    assert.equal(res.data.ownedCharacterCount, 1);
    assert.match(res.data.user.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    // 아이디는 대소문자를 구분하지 않고, 아이디·닉네임은 암호화돼 저장된다.
    const check = await client.get('/api/users/check?username=TESTERUSER&nickname=%ED%85%8C%EC%8A%A4%ED%84%B0');
    assert.deepEqual(check.data, { ok: true, usernameAvailable: false, nicknameAvailable: false });
    const free = await client.get('/api/users/check?username=anotheruser&nickname=%EB%B9%88%EC%9E%90%EB%A6%AC');
    assert.deepEqual(free.data, { ok: true, usernameAvailable: true, nicknameAvailable: true });
    const rows = runD1Sql(server.persistDir, 'SELECT username_cipher, nickname_cipher, password_hash, profile_image FROM users WHERE role = \'user\'');
    assert.equal(rows.length, 1);
    assert.doesNotMatch(JSON.stringify(rows[0].username_cipher), /tester/i);
    assert.match(rows[0].password_hash, /^pbkdf2_sha256\$50000\$/);
    assert.match(rows[0].profile_image, /^data:image\/png;base64,/);

    // 중복으로 실패해도 1단계 토큰은 남아 같은 토큰으로 다시 가입할 수 있고, 가입에 쓰면 사라진다.
    const retry = new Client(server.base);
    const challenge = nextChallenge();
    const step = await retry.post('/api/signup/verify-step1', { captchaId: challenge.id, captchaAnswer: challenge.answer });
    const token = step.data.stepPassToken;
    const signup = (fields) => retry.post('/api/register', { password: 'password123', deferOwnedCharacters: true, stepPassToken: token, ...fields });
    assert.equal((await signup({ username: user.username, nickname: '다른닉' })).status, 409);
    assert.equal((await signup({ username: 'retryusers', nickname: user.nickname })).status, 409);
    const retried = await signup({ username: 'retryusers', nickname: '재시도' });
    assert.equal(retried.status, 201, retried.text);
    assert.match((await signup({ username: 'reuseduser', nickname: '재사용' })).data.error, /1단계가 만료/);

    const anonymous = await client.get('/api/me');
    assert.equal(anonymous.data.user, null);
    const wrong = await client.post('/api/login', { username: user.username, password: 'wrongpass1' });
    assert.equal(wrong.status, 401);
    const logged = await client.login(user.username.toUpperCase(), user.password);
    assert.equal(logged.username, 'testeruser');
    assert.equal(logged.role, 'user');
    const cookieValue = client.cookies.get('priconne_sid');
    assert.ok(cookieValue);
    const me = await client.get('/api/me');
    assert.equal(me.data.user.nickname, user.nickname);
    assert.equal(me.headers.get('cache-control'), 'private, no-store');

    const logout = await client.post('/api/logout', {});
    assert.equal(logout.status, 200);
    // 로그아웃한 쿠키를 다시 보내도 서버 세션이 지워져 로그인되지 않는다.
    const replay = new Client(server.base);
    replay.cookies.set('priconne_sid', cookieValue);
    const replayed = await replay.get('/api/me/owned-characters');
    assert.equal(replayed.status, 401);
  });

  it('로그인 시도는 1분에 10회까지', async () => {
    const client = new Client(server.base);
    for (let i = 0; i < 10; i++) {
      const res = await client.post('/api/login', { username: 'nobodyuser', password: 'password123' });
      assert.equal(res.status, 401);
    }
    const blocked = await client.post('/api/login', { username: 'nobodyuser', password: 'password123' });
    assert.equal(blocked.status, 429);
    assert.match(blocked.data.error, /로그인 시도가 너무 많습니다/);
    // 다른 IP는 영향을 받지 않는다.
    const other = await new Client(server.base).post('/api/login', { username: 'nobodyuser', password: 'password123' });
    assert.equal(other.status, 401);
  });
});

describe('내 정보·보유 캐릭터', () => {
  let client;

  before(async () => {
    client = new Client(server.base);
    const res = await client.register(nextChallenge(), { username: 'ownerusers', nickname: '보유자' });
    assert.equal(res.status, 201, res.text);
    await client.login('ownerusers', 'password123');
  });

  it('보유 캐릭터 저장·조회', async () => {
    assert.equal((await new Client(server.base).get('/api/me/owned-characters')).status, 401);
    const empty = await client.get('/api/me/owned-characters');
    assert.deepEqual(empty.data.characters, []);
    const saved = await client.patch('/api/me/owned-characters', { characterIds: [CHAR_B.id, CHAR_A.id, CHAR_A.id, 'bad'] });
    assert.deepEqual(saved.data, { ok: true, ownedCharacterCount: 2 });
    const list = await client.get('/api/me/owned-characters');
    assert.deepEqual(
      list.data.characters.map((ch) => ch.id),
      [CHAR_A, CHAR_B].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((ch) => ch.id)
    );
    assert.equal(list.data.characters[0].imageUrl.startsWith('/characters/'), true);
    assert.equal((await client.patch('/api/me/owned-characters', { characterIds: [UNKNOWN_UUID] })).status, 400);
    assert.equal((await client.patch('/api/me/owned-characters', {})).status, 400);
    const cleared = await client.patch('/api/me/owned-characters', { characterIds: [] });
    assert.equal(cleared.data.ownedCharacterCount, 0);
  });

  it('닉네임·프로필 이미지 변경', async () => {
    assert.match((await client.patch('/api/me', {})).data.error, /하나 이상/);
    assert.equal((await client.patch('/api/me', { nickname: '보유자' })).data.error, '변경된 내용이 없습니다.');
    assert.equal((await client.patch('/api/me', { nickname: '테스터' })).status, 409);
    const changed = await client.patch('/api/me', { nickname: '새닉네임' });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.nickname, '새닉네임');
    const me = await client.get('/api/me');
    const check = await client.get(`/api/users/check?nickname=${encodeURIComponent('새닉네임')}&excludeUserId=${me.data.user.id}`);
    assert.equal(check.data.nicknameAvailable, true);

    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const image = await client.patch('/api/me', { profileImage: png });
    assert.equal(image.data.user.profileImage, png);
    assert.equal((await client.patch('/api/me', { profileImage: 'javascript:alert(1)' })).status, 400);
    const removed = await client.patch('/api/me', { profileImage: null });
    assert.equal(removed.data.user.profileImage, null);
  });
});

describe('미래시', () => {
  it('기본값 조회, 관리자만 저장', async () => {
    const anonymous = new Client(server.base);
    const initial = await anonymous.get('/api/future-sight');
    assert.equal(initial.status, 200);
    assert.equal(initial.data.data.months.length, 1);
    assert.match(initial.data.updatedAt, /^\d{4}-/);

    const payload = {
      data: {
        months: [
          {
            id: 'month-1',
            label: 'x',
            info: '안내',
            categories: { new: [{ characterId: CHAR_A.id, type: 'limited' }], special: [{ characterId: CHAR_B.id, princessPass: true }] }
          }
        ]
      }
    };
    assert.equal((await anonymous.put('/api/admin/future-sight', payload)).status, 401);
    const member = new Client(server.base);
    await member.login('testeruser', 'password123');
    assert.equal((await member.put('/api/admin/future-sight', payload)).status, 403);

    const admin = new Client(server.base);
    const adminUser = await admin.login(ADMIN.username, ADMIN.password);
    assert.equal(adminUser.role, 'admin');
    assert.match(adminUser.profileImage, /^data:image\/png;base64,/);
    const saved = await admin.put('/api/admin/future-sight', payload);
    assert.equal(saved.status, 200, saved.text);
    const month = saved.data.data.months[0];
    assert.equal(month.categories.new[0].name, CHAR_A.name);
    assert.deepEqual(month.categories.event.map((e) => [e.characterId, e.type]), [[CHAR_B.id, 'pass']]);
    assert.equal(month.info, '안내');

    const reread = await anonymous.get('/api/future-sight');
    assert.deepEqual(reread.data.data, saved.data.data);
    const bad = await admin.put('/api/admin/future-sight', { data: { months: [{ categories: { new: [{ characterId: UNKNOWN_UUID }] } }] } });
    assert.equal(bad.status, 400);
  });

  it('지난달 데이터는 조회할 때 정리한다', async () => {
    const stale = JSON.stringify({
      version: 1,
      lastMonthCheckedAt: '2020-01-01T00:00:00.000Z',
      months: [{ id: 'old', monthNumber: 1, label: '1월', categories: {}, info: '지난' }]
    });
    runD1Sql(server.persistDir, `UPDATE site_future_sight SET data = '${stale}' WHERE id = 1`);
    const res = await new Client(server.base).get('/api/future-sight');
    const currentMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(new Date()));
    assert.equal(res.data.data.months[0].monthNumber, currentMonth);
    const [row] = runD1Sql(server.persistDir, 'SELECT data FROM site_future_sight WHERE id = 1');
    assert.notEqual(JSON.parse(row.data).lastMonthCheckedAt, '2020-01-01T00:00:00.000Z');
  });
});

describe('게시판', () => {
  let author;
  let other;
  let admin;
  let postId;

  before(async () => {
    author = new Client(server.base);
    await author.login('testeruser', 'password123');
    other = new Client(server.base);
    await other.login('ownerusers', 'password123');
    admin = new Client(server.base);
    await admin.login(ADMIN.username, ADMIN.password);
  });

  it('글쓰기 검증과 본문 정제', async () => {
    assert.equal((await new Client(server.base).post('/api/clan-board/posts', { ...CLAN_FIELDS, title: 't', content: '<p>a</p>' })).status, 401);
    assert.match((await author.post('/api/clan-board/posts', { board: 'clan', title: 't', content: '<p>a</p>' })).data.error, /게시물 구분/);
    assert.match((await author.post('/api/clan-board/posts', { ...CLAN_FIELDS, title: '', content: '<p>a</p>' })).data.error, /제목/);
    assert.match((await author.post('/api/clan-board/posts', { ...CLAN_FIELDS, title: 'x'.repeat(51), content: '<p>a</p>' })).data.error, /50자/);
    assert.match((await author.post('/api/clan-board/posts', { ...CLAN_FIELDS, title: 't', content: '<script>x</script>' })).data.error, /내용을 입력/);
    assert.equal((await author.post('/api/clan-board/posts', { board: 'nope', title: 't', content: '<p>a</p>' })).status, 400);

    const image = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
    const created = await author.post('/api/clan-board/posts', {
      ...CLAN_FIELDS,
      title: '3넴 세미오토 택틱',
      content: `<p onclick="x()">공략 Alpha 본문</p><script>alert(1)</script><img src="${image}"><img src="https://evil.example/a.png">`
    });
    assert.equal(created.status, 201, created.text);
    postId = created.data.id;
    const detail = await author.get(`/api/clan-board/posts/${postId}`);
    const post = detail.data.post;
    assert.equal(post.title, '3넴 세미오토 택틱');
    assert.equal(post.category, 'phase3');
    assert.equal(post.sub_board, 'clan-semi');
    assert.doesNotMatch(post.content, /script|onclick|evil\.example/);
    assert.ok(post.content.includes(`<img src="${image}" />`) || post.content.includes(`<img src="${image}">`), post.content.slice(0, 200));
    assert.equal(post.author.nickname, '테스터');
    assert.equal(post.can_edit, true);
    assert.equal(post.can_delete, true);
    assert.equal(post.liked, false);

    const free = await other.post('/api/clan-board/posts', { board: 'free', title: '자유글', content: '<p>안녕하세요</p>' });
    assert.equal(free.status, 201);
  });

  it('목록·필터·검색', async () => {
    const client = new Client(server.base);
    const clan = await client.get('/api/clan-board/posts?board=clan');
    assert.equal(clan.data.pagination.total, 1);
    assert.equal(clan.data.posts[0].id, postId);
    assert.equal(clan.data.posts[0].author.nickname, '테스터');
    assert.equal(clan.data.posts[0].is_pinned, false);
    assert.equal('content' in clan.data.posts[0], false);
    assert.equal((await client.get('/api/clan-board/posts?board=free')).data.posts[0].title, '자유글');
    assert.equal((await client.get('/api/clan-board/posts?board=clan&named=3&stage=2&year=2026&month=10&sub_board=clan-semi')).data.pagination.total, 1);
    assert.equal((await client.get('/api/clan-board/posts?board=clan&named=4')).data.pagination.total, 0);
    assert.equal((await client.get('/api/clan-board/posts?board=clan&search=alpha')).data.pagination.total, 1);
    assert.equal((await client.get('/api/clan-board/posts?board=clan&search=%25')).data.pagination.total, 0);
    assert.equal((await client.get('/api/clan-board/posts?board=bad')).status, 400);
  });

  it('조회수는 같은 사람이 6시간에 한 번만 센다', async () => {
    const first = await author.patch(`/api/clan-board/posts/${postId}/view`);
    assert.deepEqual([first.data.view_count, first.data.counted], [1, true]);
    const repeat = await author.patch(`/api/clan-board/posts/${postId}/view`);
    assert.deepEqual([repeat.data.view_count, repeat.data.counted], [1, false]);
    const guest = await new Client(server.base).patch(`/api/clan-board/posts/${postId}/view`);
    assert.equal(guest.data.view_count, 2);
    assert.equal((await author.patch(`/api/clan-board/posts/${'2'.repeat(8)}-2222-4222-8222-222222222222/view`)).status, 404);
    assert.equal((await author.get('/api/clan-board/posts/not-a-uuid')).status, 404);
  });

  it('추천 토글·댓글', async () => {
    const liked = await other.post(`/api/clan-board/posts/${postId}/likes`, {});
    assert.deepEqual([liked.data.liked, liked.data.like_count], [true, 1]);
    assert.equal((await other.get(`/api/clan-board/posts/${postId}`)).data.post.liked, true);
    const unliked = await other.post(`/api/clan-board/posts/${postId}/likes`, {});
    assert.deepEqual([unliked.data.liked, unliked.data.like_count], [false, 0]);

    assert.equal((await other.post(`/api/clan-board/posts/${postId}/comments`, { content: '   ' })).status, 400);
    assert.equal((await other.post(`/api/clan-board/posts/${postId}/comments`, { content: 'x'.repeat(2001) })).status, 400);
    const comment = await other.post(`/api/clan-board/posts/${postId}/comments`, { content: '  <b>좋아요</b>  ' });
    assert.equal(comment.status, 201);
    assert.equal(comment.data.comment.content, '<b>좋아요</b>');
    const list = await new Client(server.base).get(`/api/clan-board/posts/${postId}/comments?page=1&limit=20`);
    assert.equal(list.data.pagination.total, 1);
    assert.equal(list.data.comments[0].author.nickname, '새닉네임');
    assert.equal((await author.get(`/api/clan-board/posts/${postId}`)).data.post.comment_count, 1);
  });

  it('수정은 글쓴이만, 삭제는 글쓴이·관리자', async () => {
    const update = { ...CLAN_FIELDS, named: '5', title: '수정한 제목', content: '<p>수정 본문</p>' };
    assert.equal((await other.patch(`/api/clan-board/posts/${postId}`, update)).status, 403);
    assert.equal((await admin.patch(`/api/clan-board/posts/${postId}`, update)).status, 403);
    const edited = await author.patch(`/api/clan-board/posts/${postId}`, update);
    assert.equal(edited.status, 200);
    assert.match(edited.data.updated_at, /^\d{4}-/);
    const detail = (await other.get(`/api/clan-board/posts/${postId}`)).data.post;
    assert.deepEqual([detail.title, detail.category, detail.can_edit, detail.can_delete], ['수정한 제목', 'phase5', false, false]);
    assert.equal((await admin.get(`/api/clan-board/posts/${postId}`)).data.post.can_delete, true);

    assert.equal((await other.delete(`/api/clan-board/posts/${postId}`)).status, 403);
    assert.equal((await admin.delete(`/api/clan-board/posts/${postId}`)).status, 200);
    assert.equal((await author.get(`/api/clan-board/posts/${postId}`)).status, 404);
    const leftovers = runD1Sql(
      server.persistDir,
      `SELECT (SELECT COUNT(*) FROM clan_board_comments WHERE post_id = '${postId}') + (SELECT COUNT(*) FROM post_view_marks WHERE post_id = '${postId}') AS n`
    );
    assert.equal(leftovers[0].n, 0);
  });
});

describe('Cron', () => {
  it('만료된 세션·시도 제한·보안 문자 기록을 지운다', async () => {
    runD1Sql(
      server.persistDir,
      `INSERT INTO user_sessions (id, user_id, expires_at)
         SELECT '33333333-3333-4333-8333-333333333333', id, '2000-01-01T00:00:00.000Z' FROM users WHERE role = 'admin';
       INSERT INTO rate_limits (key, window_start, count) VALUES ('login:old', 1, 1);
       INSERT INTO signup_tokens (token_hash, kind, answer_hash, expires_at) VALUES ('old', 'pass', NULL, 1);`
    );
    const res = await fetch(`${server.base}/__scheduled?cron=5+15+*+*+*`);
    assert.match(await res.text(), /Ran scheduled event/);
    assert.equal(res.status, 200);
    // scheduled는 waitUntil로 끝나므로 반영될 때까지 잠시 기다린다.
    let remaining = -1;
    for (let i = 0; i < 20 && remaining !== 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
      remaining = runD1Sql(
        server.persistDir,
        `SELECT (SELECT COUNT(*) FROM user_sessions WHERE id = '33333333-3333-4333-8333-333333333333')
              + (SELECT COUNT(*) FROM rate_limits WHERE key = 'login:old')
              + (SELECT COUNT(*) FROM signup_tokens WHERE token_hash = 'old') AS n`
      )[0].n;
    }
    assert.equal(remaining, 0, server.readLogs().slice(-3000));
  });
});

describe('배포 환경: reCAPTCHA 없이 보안 문자만으로 가입 (wrangler.jsonc 기본 설정)', () => {
  let prod;

  before(async () => {
    // ALLOW_SIGNUP_WITHOUT_RECAPTCHA는 wrangler.jsonc vars의 값(true)을 그대로 쓴다.
    prod = await startServer({ vars: { ENVIRONMENT: 'production' } });
  });

  after(async () => {
    await prod?.stop();
  });

  it('보안 문자를 통과하면 reCAPTCHA 없이 가입·로그인된다', async () => {
    const client = new Client(prod.base);
    assert.deepEqual((await client.get('/api/config')).data, { ok: true, recaptchaSiteKey: null, signupAvailable: true });
    assert.equal((await client.get('/api/signup/captcha')).status, 200);
    const [challenge] = seedCaptchaChallenges(prod.persistDir, 1);
    const res = await client.register(challenge, { username: 'prodsignup', nickname: '배포가입' });
    assert.equal(res.status, 201, res.text);
    assert.equal((await client.login('prodsignup', 'password123')).nickname, '배포가입');
  });
});

describe('배포 환경: 가입 허용 설정을 끈 경우', () => {
  let prod;

  before(async () => {
    prod = await startServer({ vars: { ENVIRONMENT: 'production', ALLOW_SIGNUP_WITHOUT_RECAPTCHA: 'false' } });
  });

  after(async () => {
    await prod?.stop();
  });

  it('reCAPTCHA 설정 없이는 회원가입을 닫는다', async () => {
    const client = new Client(prod.base);
    assert.equal((await client.get('/api/config')).data.signupAvailable, false);
    const captcha = await client.get('/api/signup/captcha');
    assert.equal(captcha.status, 503);
    assert.match(captcha.data.error, /reCAPTCHA/);
    assert.equal((await client.post('/api/register', {})).status, 503);
    // 로그인은 그대로 된다.
    assert.equal((await client.login()).role, 'admin');
  });
});
