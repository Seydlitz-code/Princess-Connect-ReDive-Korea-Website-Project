/**
 * 앱 조립: 미들웨어 순서, 라우트 연결, 오류 처리, Cron (기존 server.js의 Express 앱을 Hono로 옮김).
 * 정적 파일(public/)은 Workers static assets가 Worker를 거치지 않고 내보낸다. Worker는 /api/*만 처리한다
 * (wrangler.jsonc의 assets.run_worker_first).
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv, Env } from './types.ts';
import { runFutureSightMaintenance } from './lib/futureSightStore.ts';
import { ApiError, jsonError, MAX_JSON_BODY_BYTES } from './lib/http.ts';
import { BOARD_WRITE_RULE, LOGIN_RULE, RATE_LIMIT_RETENTION_MS, rateLimit, SIGNUP_RULE } from './lib/rateLimit.ts';
import { addSecurityHeaders, requireSameOrigin } from './lib/security.ts';
import { NOW_SQL } from './lib/time.ts';
import accountRoutes from './routes/account.ts';
import characterRoutes from './routes/characters.ts';
import clanBoardRoutes, { VIEW_DEDUPE_TTL_MS } from './routes/clanBoard.ts';
import futureSightRoutes from './routes/futureSight.ts';
import meRoutes from './routes/me.ts';

const app = new Hono<AppEnv>();

app.use('*', addSecurityHeaders);

// 본문은 읽기 전에 크기부터 막는다 (Content-Length가 없는 chunked 본문도 읽으면서 센다).
app.use(
  '/api/*',
  bodyLimit({
    maxSize: MAX_JSON_BODY_BYTES,
    onError: (c) => c.json({ ok: false, error: '요청 데이터가 너무 큽니다. 이미지·동영상 용량을 줄여 주세요.' }, 413)
  })
);
app.use('/api/*', requireSameOrigin);

/*
 * 로그인(무차별 대입 방지)과 가입 흐름(보안 문자·중복 확인·가입)은 한도를 따로 센다.
 * 가입 한 번에 보안 문자·중복 확인 2회·1단계·가입·로그인까지 여러 요청이 오가므로 한도를 넉넉히 둔다.
 */
app.use('/api/login', rateLimit(LOGIN_RULE));
app.use('/api/register', rateLimit(SIGNUP_RULE));
app.use('/api/signup/*', rateLimit(SIGNUP_RULE));
app.use('/api/users/check', rateLimit(SIGNUP_RULE));
// 게시판 쓰기(작성·수정·삭제·댓글·추천)만 따로 제한한다. 조회·조회수 증가는 세지 않는다.
app.use(
  '/api/clan-board/*',
  rateLimit(BOARD_WRITE_RULE, (method, path) => method === 'GET' || path.endsWith('/view'))
);

app.route('/api', accountRoutes);
app.route('/api/me', meRoutes);
app.route('/api/characters', characterRoutes);
app.route('/api', futureSightRoutes);
app.route('/api/clan-board', clanBoardRoutes);

app.all('/api/*', (c) => jsonError(c, 404, '알 수 없는 API입니다.'));

/**
 * 정적 파일이 없는 주소. 화면 이동(navigation)은 assets 설정(single-page-application)이 index.html을 주지만,
 * 그 밖의 GET도 기존 서버처럼 index.html로 돌려준다.
 */
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(new URL('/', c.req.url));
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, headers });
});

app.onError((err, c) => {
  if (err instanceof ApiError) return jsonError(c, err.status, err.message);
  console.error(err);
  return jsonError(c, 500, '서버 오류가 발생했습니다.');
});

/**
 * 매일 KST 00:05 (wrangler.jsonc triggers): 미래시 월별 정리(기존 서버의 일일 타이머)와 만료 기록 정리.
 * 만료된 세션·토큰은 조회할 때 이미 걸러지므로 하루 한 번 지워도 된다.
 */
async function runDailyMaintenance(env: Env): Promise<void> {
  const now = Date.now();
  const result = await runFutureSightMaintenance(env.DB);
  if (result.changed) console.log('[future-sight] 월별 정리: 지난 달 데이터를 정리했습니다.');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM user_sessions WHERE expires_at < ${NOW_SQL}`),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - RATE_LIMIT_RETENTION_MS),
    env.DB.prepare('DELETE FROM signup_tokens WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM post_view_marks WHERE viewed_at < ?').bind(now - VIEW_DEDUPE_TTL_MS)
  ]);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runDailyMaintenance(env));
  }
} satisfies ExportedHandler<Env>;
