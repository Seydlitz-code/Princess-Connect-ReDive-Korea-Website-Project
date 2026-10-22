/**
 * 미래시 데이터 읽기·저장 (기존 server.js의 runFutureSightMaintenanceJob·updateFutureSightLocked 이식).
 * 기존에는 PostgreSQL 행 잠금(FOR UPDATE)으로 관리자 저장과 자동 정리가 서로 덮어쓰지 않게 했다.
 * D1에는 행 잠금이 없어, 자동 정리는 읽은 뒤 updated_at이 그대로일 때만 쓴다(낙관적 잠금).
 * 그 사이 관리자가 저장했으면 정리를 버리고 새 값을 다시 읽는다.
 */
import {
  applyFutureSightMonthMaintenance,
  CATEGORY_KEYS,
  defaultFutureSightState,
  normalizeFutureSightState,
  type FutureSightEntry,
  type FutureSightState
} from './futureSight.ts';
import { findCharacter, toCharacterMeta } from './characters.ts';
import { NOW_SQL } from './time.ts';

type StoredRow = { data: string; updated_at: string };

/** 낙관적 잠금 재시도 횟수: 3회 (관리자 저장과 겹치는 일은 드물어 한두 번이면 끝난다) */
const MAINTENANCE_ATTEMPTS = 3;

function parseStored(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function readStored(db: D1Database): Promise<StoredRow | null> {
  return db.prepare('SELECT data, updated_at FROM site_future_sight WHERE id = 1').first<StoredRow>();
}

/**
 * 월이 바뀌었으면 정리 결과를 저장하고 현재 상태를 돌려준다. 바뀐 게 없으면 쓰기 없이 읽기만 한다.
 */
export async function runFutureSightMaintenance(
  db: D1Database,
  now = new Date()
): Promise<{ state: FutureSightState; changed: boolean; updatedAt: string | null }> {
  for (let attempt = 0; attempt < MAINTENANCE_ATTEMPTS; attempt++) {
    const row = await readStored(db);
    const maintained = applyFutureSightMonthMaintenance(row ? parseStored(row.data) : defaultFutureSightState(now), now);
    if (row && !maintained.changed) return { ...maintained, updatedAt: row.updated_at };
    const json = JSON.stringify(maintained.state);
    const written = row
      ? await db
          .prepare(`UPDATE site_future_sight SET data = ?, updated_at = ${NOW_SQL} WHERE id = 1 AND updated_at = ? RETURNING updated_at`)
          .bind(json, row.updated_at)
          .first<{ updated_at: string }>()
      : await db
          .prepare(`INSERT INTO site_future_sight (id, data, updated_at) VALUES (1, ?, ${NOW_SQL}) ON CONFLICT (id) DO NOTHING RETURNING updated_at`)
          .bind(json)
          .first<{ updated_at: string }>();
    if (written) return { state: maintained.state, changed: true, updatedAt: written.updated_at };
  }
  // 계속 겹치면 정리는 다음 요청·Cron에 맡기고 지금 값을 그대로 보여 준다.
  const row = await readStored(db);
  return {
    state: normalizeFutureSightState(row ? parseStored(row.data) : null, now),
    changed: false,
    updatedAt: row?.updated_at ?? null
  };
}

/** 관리자 저장: 정리를 마친 상태를 그대로 덮어쓴다. */
export async function saveFutureSight(db: D1Database, state: FutureSightState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_future_sight (id, data, updated_at) VALUES (1, ?, ${NOW_SQL})
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .bind(JSON.stringify(state))
    .run();
}

/** 저장된 상태에 캐릭터 이름·이미지 주소를 붙인다. 목록에 없는 캐릭터는 뺀다. */
export function hydrateFutureSightState(state: FutureSightState) {
  const normalized = normalizeFutureSightState(state);
  const hydrateEntries = (items: FutureSightEntry[]) =>
    items.flatMap((item) => {
      const entry = findCharacter(item.characterId);
      return entry ? [{ ...item, ...toCharacterMeta(entry) }] : [];
    });
  return {
    version: normalized.version,
    months: normalized.months.map((month) => ({
      ...month,
      categories: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, hydrateEntries(month.categories[key])]))
    }))
  };
}
