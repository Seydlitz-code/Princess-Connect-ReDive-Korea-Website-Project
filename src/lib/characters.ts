/**
 * 캐릭터 정적 라이브러리 (기존 lib/charactersLibrary.js 이식).
 * public/data/characters.json을 Worker 코드에 함께 묶어 읽는다. 이미지 파일(public/characters/)은 정적 파일로 나간다.
 * 기존의 DB(BYTEA) 예비 경로는 쓰지 않아 없앴다. 목록을 바꾸려면 `npm run build:characters` 후 다시 배포한다.
 */
import manifest from '../../public/data/characters.json';

export type CharacterEntry = { id: string; name: string; imageMime: string; updatedAt: string; imageUrl: string };
export type CharacterMeta = { id: string; name: string; imageUrl: string };

type ManifestCharacter = {
  id?: unknown;
  name?: unknown;
  file?: unknown;
  imageMime?: unknown;
  imageUrl?: unknown;
  updatedAt?: unknown;
};

function isSafeFileName(file: unknown): file is string {
  return typeof file === 'string' && file !== '' && !file.includes('..') && !/[\\/]/.test(file);
}

function buildLibrary(): CharacterEntry[] {
  const generatedAt = typeof manifest.generatedAt === 'string' ? manifest.generatedAt : '';
  const list: CharacterEntry[] = [];
  for (const raw of manifest.characters as ManifestCharacter[]) {
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !isSafeFileName(raw.file)) continue;
    list.push({
      id: raw.id,
      name: raw.name,
      imageMime: typeof raw.imageMime === 'string' && raw.imageMime ? raw.imageMime : 'application/octet-stream',
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : generatedAt,
      imageUrl:
        typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : `/characters/${encodeURIComponent(raw.file)}`
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return list;
}

/** 한국어 이름순 목록 (배포 단위로 바뀌지 않는 상수라 모듈 전역에 둔다) */
export const CHARACTER_LIST: readonly CharacterEntry[] = buildLibrary();
const CHARACTERS_BY_ID = new Map(CHARACTER_LIST.map((entry) => [entry.id, entry]));

export function findCharacter(id: string): CharacterEntry | undefined {
  return CHARACTERS_BY_ID.get(id);
}

export function hasCharacter(id: string): boolean {
  return CHARACTERS_BY_ID.has(id);
}

export function toCharacterMeta(entry: CharacterEntry): CharacterMeta {
  return { id: entry.id, name: entry.name, imageUrl: entry.imageUrl };
}
