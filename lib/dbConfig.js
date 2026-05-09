'use strict';

/**
 * Postgres 연결 문자열·Pool 옵션 (server.js 및 일회성 스크립트 공통).
 */

function tTrim(v) {
  return typeof v === 'string' ? v.trim() : '';
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
  const fromUrl =
    tTrim(process.env.DATABASE_URL) ||
    tTrim(process.env.DATABASE_PRIVATE_URL) ||
    tTrim(process.env.POSTGRES_URL) ||
    tTrim(process.env.POSTGRES_PRISMA_URL) ||
    tTrim(process.env.DATABASE_PUBLIC_URL) ||
    tTrim(process.env.RAILWAY_DATABASE_URL);
  if (fromUrl) return fromUrl;

  const host = tTrim(
    process.env.PGHOST || process.env.POSTGRES_HOSTNAME || process.env.POSTGRES_HOST
  );
  const port = tTrim(process.env.PGPORT || process.env.POSTGRES_PORT) || '5432';
  const user = tTrim(process.env.PGUSER || process.env.POSTGRES_USER);
  const password = process.env.PGPASSWORD != null ? String(process.env.PGPASSWORD) : '';
  const database = tTrim(
    process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE
  );
  if (host && user && database) {
    const sslMode = tTrim(process.env.PGSSLMODE);
    const useSsl =
      sslMode === 'require' ||
      (sslMode !== 'disable' && host !== 'localhost' && host !== '127.0.0.1');
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
  const cfg = { connectionString };
  try {
    const normalized = connectionString.replace(/^postgres:\/\//i, 'postgresql://');
    const u = new URL(normalized);
    const host = u.hostname || '';
    const railwayHost =
      host.includes('railway') || /\.rlwy\.net$/i.test(host) || /\.railway\.app$/i.test(host);
    if (
      u.searchParams.get('sslmode') === 'require' ||
      (railwayHost && u.searchParams.get('sslmode') !== 'disable')
    ) {
      cfg.ssl = { rejectUnauthorized: false };
    }
  } catch {
    /* Pool may still accept string */
  }
  return cfg;
}

module.exports = { createPoolConfig, resolvePostgresConnectionString, tTrim };
