/** 보유 캐릭터 입력 검사·저장 쿼리 (기존 server.js의 normalizeCharacterIds·insertOwnedCharacters 이식) */
import type { Context } from 'hono';
import type { AppEnv } from '../types.ts';
import { hasCharacter } from './characters.ts';
import { jsonError } from './http.ts';
import { isUuid } from './ids.ts';

/** 한 번에 저장할 수 있는 보유 캐릭터 수: 500명 (기존과 같음, 전체 캐릭터 수보다 넉넉함) */
const MAX_OWNED_CHARACTERS_PER_REGISTER = 500;

/** UUID 형식만 남기고 중복을 뺀다. */
export function normalizeCharacterIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const id = String(raw || '').trim();
    if (!isUuid(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_OWNED_CHARACTERS_PER_REGISTER) break;
  }
  return out;
}

/** 목록에 없는 캐릭터가 있으면 보낼 400 응답, 모두 있으면 null */
export function validateCharacterIds(c: Context<AppEnv>, characterIds: string[]): Response | null {
  if (characterIds.every(hasCharacter)) return null;
  return jsonError(c, 400, '목록에 없는 캐릭터가 포함되어 있습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
}

/**
 * 보유 캐릭터를 통째로 바꾸는 쿼리들. db.batch에 넣어 한 트랜잭션으로 실행한다.
 * 쿼리당 바인딩 값 100개 상한을 피하려고 id 목록은 JSON 문자열 하나로 넘겨 json_each로 펼친다.
 */
export function replaceOwnedCharactersStatements(
  db: D1Database,
  userId: string,
  characterIds: string[],
  { isNewUser = false } = {}
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (!isNewUser) statements.push(db.prepare('DELETE FROM user_owned_characters WHERE user_id = ?').bind(userId));
  if (characterIds.length > 0) {
    statements.push(
      db
        .prepare('INSERT OR IGNORE INTO user_owned_characters (user_id, character_id) SELECT ?, value FROM json_each(?)')
        .bind(userId, JSON.stringify(characterIds))
    );
  }
  return statements;
}
