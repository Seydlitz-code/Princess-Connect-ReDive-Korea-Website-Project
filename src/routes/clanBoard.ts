/**
 * 게시판 API (기존 server.js 이식, 경로·응답 형식 그대로): /api/clan-board/posts/...
 * 클랜전 게시판(clan)과 자유 게시판(free)을 함께 다룬다.
 */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types.ts';
import { codepointLength, getClientIp, jsonError, readJsonBody, readPositiveInt, readString, type JsonObject } from '../lib/http.ts';
import { bytesToHex, encodeUtf8 } from '../lib/encoding.ts';
import { isUuid } from '../lib/ids.ts';
import { decryptOrEmpty, type PiiCrypto } from '../lib/pii.ts';
import { hasMeaningfulContent, MAX_POST_HTML_LENGTH, preparePostHtml } from '../lib/postSanitizer.ts';
import { loadSessionUser, requireSessionUser } from '../lib/session.ts';
import { NOW_SQL } from '../lib/time.ts';
import { requirePii } from '../lib/users.ts';

const app = new Hono<AppEnv>();

const BOARDS = ['clan', 'free'];
const VALID_CATEGORIES = ['none', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5'];
const VALID_SUB_BOARDS = ['clan-semi', 'clan-fullauto'];
/** 제목 최대 길이: 50자 */
const TITLE_MAX = 50;
/** 댓글 최대 길이: 2000자 */
const COMMENT_MAX = 2000;
/** 검색어 최대 길이: 100자 */
const SEARCH_MAX = 100;
/** 글 목록 한 페이지 최대: 40개 */
const POSTS_PAGE_MAX = 40;
/** 댓글 한 페이지: 기본 20개, 최대 50개 */
const COMMENTS_PAGE_DEFAULT = 20;
const COMMENTS_PAGE_MAX = 50;
/**
 * 게시물 본문 최대 크기: 1,900,000바이트(UTF-8).
 * D1은 값 하나·행 하나를 2,000,000바이트까지 저장하므로, 검색용 평문·제목이 들어갈 자리를 남긴다.
 */
const MAX_POST_CONTENT_BYTES = 1_900_000;
/** 같은 사람이 같은 글을 다시 열어도 조회수를 올리지 않는 시간: 6시간 (기존과 같음) */
export const VIEW_DEDUPE_TTL_MS = 6 * 60 * 60 * 1000;

const POST_NOT_FOUND = '게시물을 찾을 수 없습니다.';
const CONTENT_TOO_LARGE = '본문 용량이 너무 큽니다. 이미지·동영상 크기를 줄여 주세요.';

/** 게시물 구분(클랜전 게시판 전용) — index.html의 선택지와 같다. */
const CLASSIFIERS = {
  year: /^(before\d{4}|\d{4})$/,
  month: /^(1[0-2]|[1-9])$/,
  stage: /^[1-4]$/,
  named: /^[1-5]$/
} as const;
type ClassifierKey = keyof typeof CLASSIFIERS;
const CLASSIFIER_KEYS = Object.keys(CLASSIFIERS) as ClassifierKey[];

type Classification = { year: string | null; month: string | null; stage: string | null; named: string | null; category: string };

/** 게시물 id가 UUID가 아니면 DB 조회 없이 404 (기존 app.param('postId')) */
app.use('/posts/:postId/*', async (c, next) => {
  if (!isUuid(c.req.param('postId'))) return jsonError(c, 404, POST_NOT_FOUND);
  return next();
});
app.use('/posts/:postId', async (c, next) => {
  if (!isUuid(c.req.param('postId'))) return jsonError(c, 404, POST_NOT_FOUND);
  return next();
});

/** 클랜전 글은 연도·월·단계·네임드 필수(네임드 → category phaseN), 자유 게시판은 구분 없음 */
function parseClassification(body: JsonObject, board: string): { values: Classification } | { error: string } {
  if (board !== 'clan') return { values: { year: null, month: null, stage: null, named: null, category: 'none' } };
  const values: Record<ClassifierKey, string> = { year: '', month: '', stage: '', named: '' };
  for (const key of CLASSIFIER_KEYS) {
    const value = readString(body, key).trim();
    if (!CLASSIFIERS[key].test(value)) return { error: '게시물 구분(연도·월·단계·네임드)을 모두 선택해 주세요.' };
    values[key] = value;
  }
  return { values: { ...values, category: `phase${values.named}` } };
}

/** 제목·본문 공통 검증 + 본문 정제 */
function preparePostContent(body: JsonObject): { title: string; content: string; contentText: string } | { error: string } {
  const title = readString(body, 'title').trim();
  const rawContent = readString(body, 'content');
  if (!title) return { error: '제목을 입력해 주세요.' };
  if (codepointLength(title) > TITLE_MAX) return { error: `게시물 제목은 ${TITLE_MAX}자 이내로만 작성 가능합니다.` };
  if (rawContent.length > MAX_POST_HTML_LENGTH) return { error: CONTENT_TOO_LARGE };
  const { content, contentText } = preparePostHtml(rawContent);
  if (!hasMeaningfulContent(content, contentText)) return { error: '내용을 입력해 주세요.' };
  if (encodeUtf8(content).length > MAX_POST_CONTENT_BYTES) return { error: CONTENT_TOO_LARGE };
  return { title, content, contentText };
}

function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (m) => `\\${m}`);
}

type PostListRow = {
  id: string;
  title: string;
  category: string;
  year: string | null;
  month: string | null;
  stage: string | null;
  named: string | null;
  view_count: number;
  is_pinned: number;
  created_at: string;
  nickname_cipher: string;
  comment_count: number;
  like_count: number;
};

async function mapPostListRow(pii: PiiCrypto, row: PostListRow) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    year: row.year,
    month: row.month,
    stage: row.stage,
    named: row.named,
    view_count: row.view_count,
    like_count: Number(row.like_count) || 0,
    comment_count: Number(row.comment_count) || 0,
    is_pinned: row.is_pinned === 1,
    created_at: row.created_at,
    author: { nickname: await decryptOrEmpty(pii, row.nickname_cipher) }
  };
}

/** 목록 쿼리 열. 본문(content)은 수 MB가 될 수 있어 목록에서는 읽지 않는다. */
const LIST_COLUMNS = `
  p.id, p.title, p.category, p.year, p.month, p.stage, p.named,
  p.view_count, p.is_pinned, p.created_at, u.nickname_cipher,
  (SELECT COUNT(*) FROM clan_board_comments c WHERE c.post_id = p.id) AS comment_count,
  (SELECT COUNT(*) FROM clan_board_likes l WHERE l.post_id = p.id) AS like_count`;

app.get('/posts', async (c) => {
  const pii = await requirePii(c);
  const page = readPositiveInt(c.req.query('page'), 1);
  const limit = Math.min(POSTS_PAGE_MAX, readPositiveInt(c.req.query('limit'), POSTS_PAGE_MAX));
  const board = String(c.req.query('board') || 'clan').trim();
  if (!BOARDS.includes(board)) return jsonError(c, 400, '올바른 게시판이 아닙니다.');
  const category = String(c.req.query('category') || '').trim();
  const subBoard = String(c.req.query('sub_board') || '').trim();
  const search = String(c.req.query('search') || '').trim().slice(0, SEARCH_MAX);

  // 조건 조각은 코드 안의 상수이고, 값은 모두 ? 자리에 바인딩한다.
  const conditions = ['p.board = ?'];
  const params: string[] = [board];
  if (VALID_CATEGORIES.includes(category)) {
    conditions.push('p.category = ?');
    params.push(category);
  }
  if (VALID_SUB_BOARDS.includes(subBoard)) {
    conditions.push('p.sub_board = ?');
    params.push(subBoard);
  }
  for (const key of ['year', 'month', 'stage'] as const) {
    const value = String(c.req.query(key) || '').trim();
    if (CLASSIFIERS[key].test(value)) {
      conditions.push(`p.${key} = ?`);
      params.push(value);
    }
  }
  const named = String(c.req.query('named') || '').trim();
  if (CLASSIFIERS.named.test(named)) {
    conditions.push('p.category = ?');
    params.push(`phase${named}`);
  }
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    conditions.push("(p.title LIKE ? ESCAPE '\\' OR p.content_text LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const db = c.env.DB;

  const [pinnedRes, totalRes] = await db.batch([
    page === 1
      ? db
          .prepare(
            `SELECT ${LIST_COLUMNS} FROM clan_board_posts p JOIN users u ON p.author_id = u.id
             ${where} AND p.is_pinned = 1 ORDER BY p.created_at DESC`
          )
          .bind(...params)
      : db.prepare('SELECT 1 WHERE 0'),
    db.prepare(`SELECT COUNT(*) AS total FROM clan_board_posts p ${where} AND p.is_pinned = 0`).bind(...params)
  ]);
  const total = Number((totalRes.results[0] as { total: number }).total);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const { results } = await db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM clan_board_posts p JOIN users u ON p.author_id = u.id
       ${where} AND p.is_pinned = 0 ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, (safePage - 1) * limit)
    .all<PostListRow>();

  const pinned = await Promise.all((pinnedRes.results as PostListRow[]).map((row) => mapPostListRow(pii, row)));
  const posts = await Promise.all(results.map((row) => mapPostListRow(pii, row)));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, posts: [...pinned, ...posts], pinned, pagination: { page: safePage, limit, total, totalPages } });
});

type PostDetailRow = {
  id: string;
  title: string;
  content: string;
  category: string;
  year: string | null;
  month: string | null;
  stage: string | null;
  named: string | null;
  board: string;
  sub_board: string;
  view_count: number;
  created_at: string;
  updated_at: string | null;
  author_id: string;
  nickname_cipher: string;
  like_count: number;
  comment_count: number;
  liked: number;
};

app.get('/posts/:postId', async (c) => {
  const pii = await requirePii(c);
  const postId = c.req.param('postId');
  const sessionUser = await loadSessionUser(c);
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.content, p.category, p.year, p.month, p.stage, p.named,
            p.board, p.sub_board, p.view_count, p.created_at, p.updated_at, p.author_id,
            u.nickname_cipher,
            (SELECT COUNT(*) FROM clan_board_likes l WHERE l.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM clan_board_comments c WHERE c.post_id = p.id) AS comment_count,
            EXISTS (SELECT 1 FROM clan_board_likes l WHERE l.post_id = p.id AND l.user_id = ?2) AS liked
       FROM clan_board_posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ?1`
  )
    .bind(postId, sessionUser ? sessionUser.id : null)
    .first<PostDetailRow>();
  if (!row) return jsonError(c, 404, POST_NOT_FOUND);
  const isAuthor = Boolean(sessionUser && row.author_id === sessionUser.id);
  const isAdmin = sessionUser?.role === 'admin';

  c.header('Cache-Control', 'private, no-store');
  return c.json({
    ok: true,
    post: {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category,
      year: row.year,
      month: row.month,
      stage: row.stage,
      named: row.named,
      board: row.board,
      sub_board: row.sub_board,
      view_count: row.view_count,
      like_count: Number(row.like_count) || 0,
      comment_count: Number(row.comment_count) || 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author: { nickname: await decryptOrEmpty(pii, row.nickname_cipher) },
      liked: row.liked === 1,
      can_edit: isAuthor,
      can_delete: isAuthor || isAdmin
    }
  });
});

/** 조회수용 방문자 키. 비회원 IP는 원문 대신 SESSION_SECRET으로 만든 HMAC으로 저장한다. */
async function buildViewerKey(c: Context<AppEnv>): Promise<string> {
  const sessionUser = await loadSessionUser(c);
  if (sessionUser) return `u:${sessionUser.id}`;
  const secret = encodeUtf8(`view:${c.env.SESSION_SECRET || ''}`);
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeUtf8(getClientIp(c))));
  // 앞 16바이트(128비트)만 써도 방문자끼리 겹치지 않는다.
  return `ip:${bytesToHex(mac.subarray(0, 16))}`;
}

app.patch('/posts/:postId/view', async (c) => {
  const postId = c.req.param('postId');
  const db = c.env.DB;
  const current = await db.prepare('SELECT view_count FROM clan_board_posts WHERE id = ?').bind(postId).first<{ view_count: number }>();
  if (!current) return jsonError(c, 404, POST_NOT_FOUND);
  const now = Date.now();
  // 기록이 없거나 6시간이 지났을 때만 시각을 바꾼다. 바뀐 행이 있으면 이번 조회를 센다.
  const mark = await db
    .prepare(
      `INSERT INTO post_view_marks (viewer_key, post_id, viewed_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (viewer_key, post_id) DO UPDATE SET viewed_at = excluded.viewed_at
       WHERE post_view_marks.viewed_at <= ?4`
    )
    .bind(await buildViewerKey(c), postId, now, now - VIEW_DEDUPE_TTL_MS)
    .run();
  if (mark.meta.changes === 0) return c.json({ ok: true, view_count: current.view_count, counted: false });
  const updated = await db
    .prepare('UPDATE clan_board_posts SET view_count = view_count + 1 WHERE id = ? RETURNING view_count')
    .bind(postId)
    .first<{ view_count: number }>();
  if (!updated) return jsonError(c, 404, POST_NOT_FOUND);
  return c.json({ ok: true, view_count: updated.view_count, counted: true });
});

app.post('/posts/:postId/likes', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const postId = c.req.param('postId');
  const db = c.env.DB;
  const post = await db.prepare('SELECT 1 AS found FROM clan_board_posts WHERE id = ?').bind(postId).first();
  if (!post) return jsonError(c, 404, POST_NOT_FOUND);

  // 삭제를 먼저 시도하고, 지운 게 없으면 추가한다(동시 클릭에도 PK 충돌 없이 토글).
  const removed = await db.prepare('DELETE FROM clan_board_likes WHERE user_id = ? AND post_id = ?').bind(sessionUser.id, postId).run();
  const isLiked = removed.meta.changes === 0;
  const countStatement = db.prepare('SELECT COUNT(*) AS count FROM clan_board_likes WHERE post_id = ?').bind(postId);
  let likeCount: number;
  if (isLiked) {
    const [, countRes] = await db.batch([
      db.prepare('INSERT OR IGNORE INTO clan_board_likes (user_id, post_id) VALUES (?, ?)').bind(sessionUser.id, postId),
      countStatement
    ]);
    likeCount = Number((countRes.results[0] as { count: number }).count);
  } else {
    likeCount = Number((await countStatement.first<{ count: number }>())?.count ?? 0);
  }
  return c.json({ ok: true, liked: isLiked, like_count: likeCount });
});

app.get('/posts/:postId/comments', async (c) => {
  const pii = await requirePii(c);
  const postId = c.req.param('postId');
  const page = readPositiveInt(c.req.query('page'), 1);
  const limit = Math.min(COMMENTS_PAGE_MAX, readPositiveInt(c.req.query('limit'), COMMENTS_PAGE_DEFAULT));
  const db = c.env.DB;
  const totalRow = await db
    .prepare('SELECT COUNT(*) AS total FROM clan_board_comments WHERE post_id = ?')
    .bind(postId)
    .first<{ total: number }>();
  const total = Number(totalRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const { results } = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, u.nickname_cipher, u.profile_image
         FROM clan_board_comments c JOIN users u ON c.author_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC
        LIMIT ? OFFSET ?`
    )
    .bind(postId, limit, (safePage - 1) * limit)
    .all<{ id: string; content: string; created_at: string; nickname_cipher: string; profile_image: string | null }>();
  const comments = await Promise.all(
    results.map(async (row) => ({
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      author: { nickname: await decryptOrEmpty(pii, row.nickname_cipher), profileImage: row.profile_image || null }
    }))
  );
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, comments, pagination: { page: safePage, limit, total, totalPages } });
});

app.post('/posts', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const body = await readJsonBody(c);
  const board = (readString(body, 'board') || 'clan').trim();
  if (!BOARDS.includes(board)) return jsonError(c, 400, '올바른 게시판을 선택해 주세요.');
  let subBoard = 'none';
  if (board === 'clan') {
    subBoard = (readString(body, 'sub_board') || 'clan-fullauto').trim();
    if (!VALID_SUB_BOARDS.includes(subBoard)) return jsonError(c, 400, '올바른 게시판을 선택해 주세요.');
  }
  const classification = parseClassification(body, board);
  if ('error' in classification) return jsonError(c, 400, classification.error);
  const prepared = preparePostContent(body);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const v = classification.values;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO clan_board_posts
       (id, author_id, title, content, content_text, category, sub_board, board, year, month, stage, named, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW_SQL})`
  )
    .bind(id, sessionUser.id, prepared.title, prepared.content, prepared.contentText, v.category, subBoard, board, v.year, v.month, v.stage, v.named)
    .run();
  return c.json({ ok: true, id }, 201);
});

app.patch('/posts/:postId', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const postId = c.req.param('postId');
  const post = await c.env.DB.prepare('SELECT author_id, board FROM clan_board_posts WHERE id = ?')
    .bind(postId)
    .first<{ author_id: string; board: string }>();
  if (!post) return jsonError(c, 404, POST_NOT_FOUND);
  if (post.author_id !== sessionUser.id) return jsonError(c, 403, '게시물을 수정할 권한이 없습니다.');

  const body = await readJsonBody(c);
  const classification = parseClassification(body, post.board);
  if ('error' in classification) return jsonError(c, 400, classification.error);
  const prepared = preparePostContent(body);
  if ('error' in prepared) return jsonError(c, 400, prepared.error);
  const v = classification.values;
  const updated = await c.env.DB.prepare(
    `UPDATE clan_board_posts
        SET title = ?, content = ?, content_text = ?, category = ?, year = ?, month = ?, stage = ?, named = ?, updated_at = ${NOW_SQL}
      WHERE id = ?
      RETURNING id, updated_at`
  )
    .bind(prepared.title, prepared.content, prepared.contentText, v.category, v.year, v.month, v.stage, v.named, postId)
    .first<{ id: string; updated_at: string }>();
  if (!updated) return jsonError(c, 404, POST_NOT_FOUND);
  return c.json({ ok: true, id: updated.id, updated_at: updated.updated_at });
});

app.delete('/posts/:postId', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const postId = c.req.param('postId');
  const post = await c.env.DB.prepare('SELECT author_id FROM clan_board_posts WHERE id = ?').bind(postId).first<{ author_id: string }>();
  if (!post) return jsonError(c, 404, POST_NOT_FOUND);
  if (post.author_id !== sessionUser.id && sessionUser.role !== 'admin') {
    return jsonError(c, 403, '게시물을 삭제할 권한이 없습니다.');
  }
  // 댓글·추천·조회 기록은 외래 키(ON DELETE CASCADE)로 함께 지워진다.
  await c.env.DB.prepare('DELETE FROM clan_board_posts WHERE id = ?').bind(postId).run();
  return c.json({ ok: true });
});

app.post('/posts/:postId/comments', async (c) => {
  const sessionUser = await requireSessionUser(c);
  if (sessionUser instanceof Response) return sessionUser;
  const postId = c.req.param('postId');
  const body = await readJsonBody(c);
  const content = readString(body, 'content').trim();
  if (!content) return jsonError(c, 400, '댓글 내용을 입력해 주세요.');
  if (codepointLength(content) > COMMENT_MAX) return jsonError(c, 400, `댓글은 ${COMMENT_MAX}자 이내로 작성해 주세요.`);

  // 게시물이 있을 때만 들어간다(없으면 행 0개).
  const row = await c.env.DB.prepare(
    `INSERT INTO clan_board_comments (id, post_id, author_id, content, created_at)
     SELECT ?, p.id, ?, ?, ${NOW_SQL} FROM clan_board_posts p WHERE p.id = ?
     RETURNING id, created_at`
  )
    .bind(crypto.randomUUID(), sessionUser.id, content, postId)
    .first<{ id: string; created_at: string }>();
  if (!row) return jsonError(c, 404, POST_NOT_FOUND);
  return c.json({ ok: true, comment: { id: row.id, content, created_at: row.created_at } }, 201);
});

export default app;
