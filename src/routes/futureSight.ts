/** 미래시 API (기존 server.js 이식): GET /api/future-sight, PUT /api/admin/future-sight */
import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { hasCharacter } from '../lib/characters.ts';
import { applyFutureSightMonthMaintenance, CATEGORY_KEYS } from '../lib/futureSight.ts';
import { hydrateFutureSightState, runFutureSightMaintenance, saveFutureSight } from '../lib/futureSightStore.ts';
import { jsonError, readJsonBody } from '../lib/http.ts';
import { requireAdminUser } from '../lib/session.ts';

const app = new Hono<AppEnv>();

app.get('/future-sight', async (c) => {
  const maintained = await runFutureSightMaintenance(c.env.DB);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true, data: hydrateFutureSightState(maintained.state), updatedAt: maintained.updatedAt || null });
});

app.put('/admin/future-sight', async (c) => {
  const admin = await requireAdminUser(c);
  if (admin instanceof Response) return admin;
  const body = await readJsonBody(c);
  const state = applyFutureSightMonthMaintenance(body.data).state;
  const hasUnknownCharacter = state.months.some((month) =>
    CATEGORY_KEYS.some((key) => month.categories[key].some((entry) => !hasCharacter(entry.characterId)))
  );
  if (hasUnknownCharacter) {
    return jsonError(c, 400, '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  }
  await saveFutureSight(c.env.DB, state);
  return c.json({ ok: true, data: hydrateFutureSightState(state) });
});

export default app;
