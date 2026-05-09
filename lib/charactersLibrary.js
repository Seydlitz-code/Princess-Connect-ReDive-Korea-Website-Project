'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_SEGMENTS = ['data', 'characters.json'];

function safeStorageFile(filename) {
  if (typeof filename !== 'string' || !filename || filename.includes('..')) return false;
  return filename === path.basename(filename);
}

function publicImageUrl(storageFile) {
  return `/characters/${encodeURIComponent(storageFile)}`;
}

/**
 * public/data/characters.json + public/characters/* 가 있으면 메타와 맵을 반환합니다.
 * @param {string} projectRoot - __dirname (server cwd)
 */
function readCharacterLibrarySync(projectRoot) {
  const manifestPath = path.join(projectRoot, 'public', ...MANIFEST_SEGMENTS);
  if (!fs.existsSync(manifestPath)) return null;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.characters)) return null;

  const charsDir = path.join(projectRoot, 'public', 'characters');
  const byId = new Map();
  const list = [];

  for (const c of raw.characters) {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') continue;
    const file = c.file;
    if (typeof file !== 'string' || !safeStorageFile(file)) continue;
    const abs = path.join(charsDir, file);
    if (!fs.existsSync(abs)) continue;

    const imageMime =
      typeof c.imageMime === 'string' && c.imageMime.length > 0
        ? c.imageMime
        : 'application/octet-stream';
    const updatedAt =
      typeof c.updatedAt === 'string' && c.updatedAt.length > 0
        ? c.updatedAt
        : typeof raw.generatedAt === 'string'
          ? raw.generatedAt
          : new Date().toISOString();
    const imageUrl = typeof c.imageUrl === 'string' && c.imageUrl.length > 0 ? c.imageUrl : publicImageUrl(file);

    const entry = { id: c.id, name: c.name, file, imageMime, updatedAt, imageUrl, absPath: abs };
    byId.set(entry.id, entry);
    list.push(entry);
  }

  list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { manifest: raw, byId, list, charsDir };
}

module.exports = { readCharacterLibrarySync, publicImageUrl };
