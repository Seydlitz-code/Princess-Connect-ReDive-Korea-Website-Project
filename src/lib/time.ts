/** 시각 저장 형식 */

/** SQL 안에서 현재 시각을 ISO 8601 UTC 문자열(밀리초 포함)로. new Date().toISOString()과 같은 모양이다. */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
