/** id 형식 검사 */

/** UUID (버전 1~5). 캐릭터 id(UUID v5)와 Worker가 만드는 id(UUID v4)를 모두 받는다. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
