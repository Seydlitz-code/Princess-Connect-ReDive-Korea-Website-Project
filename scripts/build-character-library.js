/**
 * 원본 폴더의 이미지를 public/characters/ 로 복사하고,
 * public/data/characters.json 메타(캐릭터명·id·MIME·정적 URL)를 생성합니다.
 * 서버 배포 시 DB 없이 통째로 포함할 수 있습니다.
 *
 * DATABASE_URL 불필요.
 * 선택: CHARACTERS_IMAGE_DIR (기본 Windows: 문서의 "프리코네 캐릭터 데이터베이스")
 *
 * npm run build:characters
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { publicImageUrl } = require('../lib/charactersLibrary');

const ROOT = path.join(__dirname, '..');

const DEFAULT_CHAR_DIR =
  process.platform === 'win32'
    ? 'C:\\Users\\dongh\\Documents\\프리코네 캐릭터 데이터베이스'
    : path.join(process.env.HOME || '', 'Documents', '프리코네 캐릭터 데이터베이스');

const CHAR_DIR = process.env.CHARACTERS_IMAGE_DIR
  ? path.resolve(process.env.CHARACTERS_IMAGE_DIR)
  : DEFAULT_CHAR_DIR;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const OUT_DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT_MANIFEST = path.join(OUT_DATA_DIR, 'characters.json');
const OUT_CHARS = path.join(ROOT, 'public', 'characters');

function mimeFromExt(ext) {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

/** 이름+저장 파일명으로 안정적인 UUID 형식 id (재빌드 시 동일) */
function stableCharacterId(name, storageFile) {
  const hash = crypto.createHash('sha256').update(`${name}\0${storageFile}`, 'utf8').digest();
  const buf = Buffer.from(hash.subarray(0, 16));
  buf[6] = (buf[6] & 0x0f) | 0x50;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function main() {
  if (!fs.existsSync(CHAR_DIR) || !fs.statSync(CHAR_DIR).isDirectory()) {
    console.error('폴더가 없습니다:', CHAR_DIR);
    console.error('CHARACTERS_IMAGE_DIR 로 경로를 지정하세요.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DATA_DIR, { recursive: true });
  fs.mkdirSync(OUT_CHARS, { recursive: true });

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

  const generatedAt = new Date().toISOString();
  const characters = [];
  const usedNames = new Set();

  for (const file of files) {
    const ext = path.extname(file);
    const name = path.basename(file, ext);
    const src = path.join(CHAR_DIR, file);
    let storageFile = file;
    if (usedNames.has(storageFile)) {
      console.warn('중복 파일명 스킵:', file);
      continue;
    }
    usedNames.add(storageFile);

    const dest = path.join(OUT_CHARS, storageFile);
    fs.copyFileSync(src, dest);

    const imageMime = mimeFromExt(ext);
    const id = stableCharacterId(name, storageFile);
    characters.push({
      id,
      name,
      file: storageFile,
      imageMime,
      imageUrl: publicImageUrl(storageFile),
      updatedAt: generatedAt,
    });
  }

  const manifest = {
    version: 1,
    generatedAt,
    sourceDir: CHAR_DIR,
    characters,
  };

  fs.writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('작성:', path.relative(ROOT, OUT_MANIFEST));
  console.log('복사:', characters.length, '개 →', path.relative(ROOT, OUT_CHARS));
}

main();
