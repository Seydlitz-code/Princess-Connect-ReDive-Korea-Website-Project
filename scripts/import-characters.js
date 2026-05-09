/**
 * 폴더 내 이미지 파일을 파일명(확장자 제외)=캐릭터명 과 함께 DB에 저장합니다.
 *
 * DATABASE_URL 필요 (PostgreSQL).
 * 선택: CHARACTERS_IMAGE_DIR — 원본 폴더 (기본: 사용자 공유 문서 폴더 기준 예시 경로)
 *
 * 실행: DATABASE_URL="..." npm run import:characters
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_CHAR_DIR =
  process.platform === 'win32'
    ? 'C:\\Users\\dongh\\Documents\\프리코네 캐릭터 데이터베이스'
    : path.join(process.env.HOME || '', 'Documents', '프리코네 캐릭터 데이터베이스');

const CHAR_DIR = process.env.CHARACTERS_IMAGE_DIR
  ? path.resolve(process.env.CHARACTERS_IMAGE_DIR)
  : DEFAULT_CHAR_DIR;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function createPoolConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const cfg = { connectionString };
  try {
    const u = new URL(connectionString);
    if (u.searchParams.get('sslmode') === 'require') {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch {
    /* ignore */
  }
  return cfg;
}

function mimeFromExt(ext) {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

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
    console.error('DATABASE_URL 환경 변수를 설정해 주세요.');
    process.exit(1);
  }
  if (!fs.existsSync(CHAR_DIR) || !fs.statSync(CHAR_DIR).isDirectory()) {
    console.error('폴더가 없습니다:', CHAR_DIR);
    console.error('CHARACTERS_IMAGE_DIR 로 올바른 경로를 지정할 수 있습니다.');
    process.exit(1);
  }

  const entries = fs.readdirSync(CHAR_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ko'));

  if (files.length === 0) {
    console.error('이미지 파일이 없습니다:', CHAR_DIR);
    process.exit(1);
  }

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
        const abs = path.join(CHAR_DIR, file);
        let buf;
        try {
          buf = fs.readFileSync(abs);
        } catch (readErr) {
          console.warn('SKIP read:', file, readErr.message);
          failed += 1;
          continue;
        }
        const mime = mimeFromExt(ext);
        try {
          await client.query(
            `INSERT INTO characters (name, image_mime, image_data)
             VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET
               image_mime = EXCLUDED.image_mime,
               image_data = EXCLUDED.image_data,
               updated_at = NOW()`,
            [name, mime, buf]
          );
          imported += 1;
          if (imported % 50 === 0) {
            console.log('...', imported, '건 반영');
          }
        } catch (err) {
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
