'use strict';

/**
 * 캐릭터 원본 이미지 폴더 공통 처리(build-character-library에서 사용).
 * 원본 폴더: CHARACTERS_IMAGE_DIR, 없으면 <홈>/Documents/프리코네 캐릭터 데이터베이스
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_FOLDER_NAME = '프리코네 캐릭터 데이터베이스';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function resolveCharacterSourceDir() {
  if (process.env.CHARACTERS_IMAGE_DIR) return path.resolve(process.env.CHARACTERS_IMAGE_DIR);
  return path.join(os.homedir(), 'Documents', DEFAULT_FOLDER_NAME);
}

function mimeFromExt(ext) {
  const e = String(ext).toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

/** 폴더 안 이미지 파일명(한국어 정렬). 폴더가 없거나 비었으면 안내 후 종료한다. */
function listCharacterImageFilesOrExit(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error('폴더가 없습니다:', dir);
    console.error('CHARACTERS_IMAGE_DIR 로 원본 이미지 폴더 경로를 지정하세요.');
    process.exit(1);
  }
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
  if (files.length === 0) {
    console.error('이미지 파일이 없습니다:', dir);
    process.exit(1);
  }
  return files;
}

module.exports = {
  resolveCharacterSourceDir,
  mimeFromExt,
  listCharacterImageFilesOrExit,
};
