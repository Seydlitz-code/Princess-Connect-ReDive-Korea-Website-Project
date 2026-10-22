/** 캐릭터 목록·이미지 API (기존 server.js 이식): /api/characters, /api/characters/:id/image */
import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { CHARACTER_LIST, findCharacter } from '../lib/characters.ts';
import { jsonError } from '../lib/http.ts';
import { isUuid } from '../lib/ids.ts';

const app = new Hono<AppEnv>();

/** 캐릭터 이미지 브라우저 캐시: 1일 (기존과 같음) */
const IMAGE_CACHE_CONTROL = 'public, max-age=86400';

app.get('/', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    ok: true,
    source: 'library',
    characters: CHARACTER_LIST.map((entry) => ({
      id: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt,
      imageUrl: entry.imageUrl
    }))
  });
});

/** 예전 주소 호환: 정적 파일(public/characters/)을 그대로 돌려준다. 새 화면은 imageUrl로 정적 파일을 바로 읽는다. */
app.get('/:id/image', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return jsonError(c, 400, '잘못된 캐릭터 ID입니다.');
  const entry = findCharacter(id);
  if (!entry) return jsonError(c, 404, '캐릭터 이미지를 찾을 수 없습니다.');
  const asset = await c.env.ASSETS.fetch(new URL(entry.imageUrl, c.req.url));
  if (!asset.ok) return jsonError(c, 404, '캐릭터 이미지를 찾을 수 없습니다.');
  const headers = new Headers(asset.headers);
  headers.set('Content-Type', entry.imageMime);
  headers.set('Cache-Control', IMAGE_CACHE_CONTROL);
  return new Response(asset.body, { status: 200, headers });
});

export default app;
