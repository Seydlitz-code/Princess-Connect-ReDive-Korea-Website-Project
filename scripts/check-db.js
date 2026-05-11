/**
 * Railway/PostgreSQL 연결 상태 점검 스크립트.
 *
 * Railway 웹 서비스 Variables에 DATABASE_PRIVATE_URL 또는 DATABASE_URL 참조가 들어온 상태인지,
 * 그리고 실제로 pg Pool이 접속 가능한지 확인합니다.
 *
 * 실행:
 *   npm run db:check
 */

const { Pool } = require('pg');
const { createPoolConfig, getDbEnvDiagnostics } = require('../lib/dbConfig');

async function main() {
  const diag = getDbEnvDiagnostics();
  console.log('DB 환경 변수 감지:', JSON.stringify(diag, null, 2));

  const cfg = createPoolConfig();
  if (!cfg) {
    console.error(
      'PostgreSQL 접속 정보가 없습니다. Railway 웹 서비스 Variables에 DATABASE_PRIVATE_URL 또는 DATABASE_URL 참조를 추가하세요.'
    );
    process.exit(1);
  }

  const pool = new Pool(cfg);
  try {
    const r = await pool.query(
      `SELECT NOW() AS now,
              current_database() AS database,
              current_user AS "user",
              inet_server_addr() AS "serverAddress",
              inet_server_port() AS "serverPort"`
    );
    console.log('PostgreSQL 연결 성공:', r.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('PostgreSQL 연결 실패:', err && err.message ? err.message : err);
  process.exit(1);
});
