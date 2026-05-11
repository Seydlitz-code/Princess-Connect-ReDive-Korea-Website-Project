'use strict';

/**
 * Postgres 연결 문자열·Pool 옵션 (server.js 및 일회성 스크립트 공통).
 */

function tTrim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function isUsableValue(v) {
  const s = tTrim(v);
  if (!s) return false;
  // Railway reference syntax이 그대로 남아 있으면 런타임 치환 실패 상태입니다.
  return !/^\$\{\{.+\}\}$/.test(s);
}

function detectPostgresUrlFromAnyEnv() {
  const scored = [];
  for (const [key, raw] of Object.entries(process.env)) {
    const v = tTrim(raw);
    if (!/^postgres(ql)?:\/\//i.test(v)) continue;
    let score = 0;
    const ku = key.toUpperCase();
    if (/(^|_)PASSWORD(_|$)/i.test(key) || /^NPM_/i.test(key)) continue;
    if (!/(DATABASE|POSTGRES|PG_|SQL|SUPABASE|NEON|COCKROACH|RLWY)/i.test(key)) continue;
    if (ku.includes('PRIVATE')) score += 120;
    if (ku.includes('DATABASE_URL') || ku === 'DATABASE_URL') score += 80;
    if (ku.includes('POSTGRES')) score += 40;
    if (ku.endsWith('_URL')) score += 20;
    scored.push({ key, value: v, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score > 0) {
    console.log(`PostgreSQL URL: 미지정 변수 대신 「${best.key}」값을 사용합니다.`);
    return best.value;
  }
  return '';
}

function resolvePostgresConnectionString() {
  // Railway에서는 같은 프로젝트 내부 통신용 DATABASE_PRIVATE_URL이 가장 안정적입니다.
  const fromUrl =
    (isUsableValue(process.env.DATABASE_PRIVATE_URL) && tTrim(process.env.DATABASE_PRIVATE_URL)) ||
    (isUsableValue(process.env.DATABASE_URL) && tTrim(process.env.DATABASE_URL)) ||
    (isUsableValue(process.env.POSTGRES_URL) && tTrim(process.env.POSTGRES_URL)) ||
    (isUsableValue(process.env.POSTGRES_PRISMA_URL) && tTrim(process.env.POSTGRES_PRISMA_URL)) ||
    (isUsableValue(process.env.DATABASE_PUBLIC_URL) && tTrim(process.env.DATABASE_PUBLIC_URL)) ||
    (isUsableValue(process.env.RAILWAY_DATABASE_URL) && tTrim(process.env.RAILWAY_DATABASE_URL));
  if (fromUrl) return fromUrl;

  const host = tTrim(
    process.env.PGHOST || process.env.POSTGRES_HOSTNAME || process.env.POSTGRES_HOST
  );
  const port = tTrim(process.env.PGPORT || process.env.POSTGRES_PORT) || '5432';
  const user = tTrim(process.env.PGUSER || process.env.POSTGRES_USER);
  const password =
    process.env.PGPASSWORD != null
      ? String(process.env.PGPASSWORD)
      : process.env.POSTGRES_PASSWORD != null
        ? String(process.env.POSTGRES_PASSWORD)
        : '';
  const database = tTrim(
    process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE
  );
  if (host && user && database) {
    const sslMode = tTrim(process.env.PGSSLMODE);
    const internalRailway = /\.railway\.internal$/i.test(host);
    const useSsl = sslMode === 'require' && !internalRailway;
    const query = useSsl ? '?sslmode=require' : '';

    const u = encodeURIComponent(user);
    const p = encodeURIComponent(password);
    const db = encodeURIComponent(database);
    return `postgresql://${u}:${p}@${host}:${port}/${db}${query}`;
  }

  return detectPostgresUrlFromAnyEnv();
}

function createPoolConfig() {
  const connectionString = resolvePostgresConnectionString();
  if (!connectionString) return null;
  const cfg = {
    connectionString,
    connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS) || 10_000,
  };
  try {
    const normalized = connectionString.replace(/^postgres:\/\//i, 'postgresql://');
    const u = new URL(normalized);
    if (u.searchParams.get('sslmode') === 'require') {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch {
    /* Pool may still accept string */
  }
  return cfg;
}

function getDbEnvDiagnostics() {
  const keysToCheck = [
    'DATABASE_PRIVATE_URL',
    'DATABASE_URL',
    'DATABASE_PUBLIC_URL',
    'POSTGRES_URL',
    'POSTGRES_PRISMA_URL',
    'RAILWAY_DATABASE_URL',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGDATABASE',
    'PGPASSWORD',
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_USER',
    'POSTGRES_DB',
    'POSTGRES_DATABASE',
    'POSTGRES_PASSWORD',
  ];
  const dbEnvHints = {};
  for (const k of keysToCheck) {
    dbEnvHints[k] = isUsableValue(process.env[k]);
  }
  const postgresUriKeys = Object.keys(process.env)
    .filter((key) => {
      const v = tTrim(process.env[key]);
      if (!/^postgres(ql)?:\/\//i.test(v)) return false;
      return /DATABASE|POSTGRES|PG_|SQL|SUPABASE|NEON|RLWY/i.test(key);
    })
    .sort();
  return {
    dbEnvHints,
    postgresUriKeyCount: postgresUriKeys.length,
    postgresUriKeySample: postgresUriKeys.slice(0, 15),
  };
}

module.exports = {
  createPoolConfig,
  resolvePostgresConnectionString,
  getDbEnvDiagnostics,
  tTrim,
};
