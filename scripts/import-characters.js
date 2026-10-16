/**
 * 폴더 내 이미지 파일을 파일명(확장자 제외)=캐릭터명 과 함께 DB에 저장합니다.
 *
 * DATABASE_URL 또는 DATABASE_PRIVATE_URL 필요 (Railway/PostgreSQL).
 * 선택: CHARACTERS_IMAGE_DIR — 원본 폴더 (기본: <홈>/Documents/프리코네 캐릭터 데이터베이스)
 *
 * 실행: DATABASE_URL="..." npm run import:characters
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createPoolConfig } = require('../lib/dbConfig');
const { resolveCharacterSourceDir, mimeFromExt, listCharacterImageFilesOrExit } = require('./lib/characterSource');

const CHAR_DIR = resolveCharacterSourceDir();

async function ensureCharactersTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS characters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(512) NOT NULL UNIQUE,
      image_mime VARCHAR(128) NOT NULL,
      image_data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main() {
  const cfg = createPoolConfig();
  if (!cfg) {
    console.error('DATABASE_URL 또는 DATABASE_PRIVATE_URL 등 PostgreSQL 연결 환경 변수를 설정해 주세요.');
    process.exit(1);
  }
  const files = listCharacterImageFilesOrExit(CHAR_DIR);

  const pool = new Pool(cfg);
  const client = await pool.connect();
  let imported = 0;
  let failed = 0;

  try {
    await ensureCharactersTable(client);

    await client.query('BEGIN');
    try {
      for (const file of files) {
        const ext = path.extname(file);
        const name = path.basename(file, ext);
        let buf;
        try {
          buf = fs.readFileSync(path.join(CHAR_DIR, file));
        } catch (readErr) {
          console.warn('SKIP read:', file, readErr.message);
          failed += 1;
          continue;
        }
        // 한 행이 실패하면 트랜잭션 전체가 aborted 상태가 되므로 행마다 savepoint 로 되돌린다.
        await client.query('SAVEPOINT import_row');
        try {
          await client.query(
            `INSERT INTO characters (name, image_mime, image_data)
             VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET
               image_mime = EXCLUDED.image_mime,
               image_data = EXCLUDED.image_data,
               updated_at = NOW()`,
            [name, mimeFromExt(ext), buf]
          );
          await client.query('RELEASE SAVEPOINT import_row');
          imported += 1;
          if (imported % 50 === 0) {
            console.log('...', imported, '건 반영');
          }
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT import_row');
          console.warn('SKIP db:', file, err.message);
          failed += 1;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log('완료: 성공', imported, '건, 실패', failed, '건, 스캔', files.length, '개 파일');
  console.log('소스 폴더:', CHAR_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
