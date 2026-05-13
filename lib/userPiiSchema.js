'use strict';

const pii = require('./userPiiCrypto');

async function ensureUserPiiSchema(client) {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username_blind TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_blind TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username_cipher TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_cipher TEXT`);

  await client.query(`ALTER TABLE users ALTER COLUMN username DROP NOT NULL`);
  await client.query(`ALTER TABLE users ALTER COLUMN nickname DROP NOT NULL`);

  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key`);
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_nickname_key`);

  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_username_blind_uidx ON users (username_blind) WHERE username_blind IS NOT NULL AND username_blind <> ''`
  );
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_blind_uidx ON users (nickname_blind) WHERE nickname_blind IS NOT NULL AND nickname_blind <> ''`
  );

  if (!pii.isPiiEncryptionReady()) return;

  const legacy = await client.query(`
    SELECT id, username, nickname
    FROM users
    WHERE (username_blind IS NULL OR username_blind = '')
      AND username IS NOT NULL
      AND username <> ''
  `);

  for (const row of legacy.rows) {
    const u = String(row.username);
    const n = String(row.nickname || '');
    const ub = pii.usernameBlindIndex(u);
    const nb = pii.nicknameBlindIndex(n);
    const uc = pii.encryptUtf8(pii.normalizeUsername(u));
    const nc = pii.encryptUtf8(n.trim());
    await client.query(
      `UPDATE users
       SET username_blind = $1,
           nickname_blind = $2,
           username_cipher = $3,
           nickname_cipher = $4,
           username = NULL,
           nickname = NULL
       WHERE id = $5::uuid`,
      [ub, nb, uc, nc, row.id]
    );
  }
}

module.exports = { ensureUserPiiSchema };
