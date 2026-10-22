/**
 * 원본 폴더의 이미지를 public/characters/ 로 복사하고,
 * public/data/characters.json 메타(캐릭터명·id·MIME·정적 URL)를 생성합니다.
 * 서버 배포 시 DB 없이 통째로 포함할 수 있습니다.
 *
 * DATABASE_URL 불필요.
 * 선택: CHARACTERS_IMAGE_DIR (기본: <홈>/Documents/프리코네 캐릭터 데이터베이스)
 *
 * npm run build:characters
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { publicImageUrl } = require('../lib/charactersLibrary');
const { resolveCharacterSourceDir, mimeFromExt, listCharacterImageFilesOrExit } = require('./lib/characterSource');

const ROOT = path.join(__dirname, '..');
const CHAR_DIR = resolveCharacterSourceDir();

const OUT_DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT_MANIFEST = path.join(OUT_DATA_DIR, 'characters.json');
const OUT_CHARS = path.join(ROOT, 'public', 'characters');

/** 이름+저장 파일명으로 안정적인 UUID 형식 id (재빌드 시 동일) */
function stableCharacterId(name, storageFile) {
  const hash = crypto.createHash('sha256').update(`${name}\0${storageFile}`, 'utf8').digest();
  const buf = Buffer.from(hash.subarray(0, 16));
  buf[6] = (buf[6] & 0x0f) | 0x50;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = buf.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * 기존 manifest 의 id 를 이름 기준으로 이어 쓴다. 파일 확장자가 바뀌는 등으로 해시가 달라져도
 * 보유 캐릭터·미래시에 저장된 id 가 끊기지 않게 하기 위함.
 */
function loadExistingIdsByName() {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_MANIFEST, 'utf8'));
    return new Map((prev.characters || []).map((c) => [c.name, c.id]));
  } catch {
    return new Map();
  }
}

/** 크기와 내용이 같으면 복사를 건너뛴다(재빌드 시 불필요한 쓰기·git 변경 방지) */
function copyIfChanged(src, dest) {
  if (fs.existsSync(dest)) {
    const a = fs.statSync(src);
    const b = fs.statSync(dest);
    if (a.size === b.size && fs.readFileSync(src).equals(fs.readFileSync(dest))) return false;
  }
  fs.copyFileSync(src, dest);
  return true;
}

function main() {
  const files = listCharacterImageFilesOrExit(CHAR_DIR);

  fs.mkdirSync(OUT_DATA_DIR, { recursive: true });
  fs.mkdirSync(OUT_CHARS, { recursive: true });

  const generatedAt = new Date().toISOString();
  const existingIds = loadExistingIdsByName();
  const characters = [];
  const usedIds = new Set();
  let copied = 0;

  for (const file of files) {
    const ext = path.extname(file);
    const name = path.basename(file, ext);
    if (copyIfChanged(path.join(CHAR_DIR, file), path.join(OUT_CHARS, file))) copied += 1;
    // 같은 이름이 확장자만 달리 두 개 있으면 두 번째는 새 id 를 받는다.
    let id = existingIds.get(name);
    if (!id || usedIds.has(id)) id = stableCharacterId(name, file);
    usedIds.add(id);
    characters.push({
      id,
      name,
      file,
      imageMime: mimeFromExt(ext),
      imageUrl: publicImageUrl(file),
      updatedAt: generatedAt,
    });
  }

  const sourceNames = new Set(files);
  const orphans = fs.readdirSync(OUT_CHARS).filter((f) => !sourceNames.has(f));

  const manifest = {
    version: 1,
    generatedAt,
    // 공개 파일이므로 PC 절대 경로(사용자 이름 포함)는 남기지 않는다.
    sourceDir: path.basename(CHAR_DIR),
    characters,
  };

  fs.writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('작성:', path.relative(ROOT, OUT_MANIFEST));
  console.log(`캐릭터 ${characters.length}명 (새로 복사 ${copied}개) →`, path.relative(ROOT, OUT_CHARS));
  if (orphans.length > 0) {
    console.warn(`원본에 없는 이미지 ${orphans.length}개가 public/characters 에 남아 있습니다(직접 확인 후 삭제):`);
    for (const f of orphans) console.warn('  -', f);
  }
}

main();
