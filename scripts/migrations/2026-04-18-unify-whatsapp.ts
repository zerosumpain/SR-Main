// Run with: npx tsx scripts/migrations/2026-04-18-unify-whatsapp.ts
// Backfills whatsapp_conversations into jkai_conversations + orchestrator_chats.
// Idempotent: re-running skips phone numbers already migrated.

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://app:test@localhost:5433/strange_rambling',
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if whatsapp_conversations table exists
    const { rows: tableCheck } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'whatsapp_conversations'
      ) AS exists
    `);
    if (!tableCheck[0]?.exists) {
      console.log('[migrate] whatsapp_conversations table does not exist — nothing to migrate');
      await client.query('COMMIT');
      return;
    }

    const { rows: phones } = await client.query<{ phone_number: string; first_seen: string }>(`
      SELECT DISTINCT phone_number, MIN(created_at) AS first_seen
        FROM whatsapp_conversations
       GROUP BY phone_number
    `);

    console.log(`[migrate] Found ${phones.length} distinct phone numbers`);

    const DEFAULT_PROVIDER = 'zai';
    const DEFAULT_MODEL = 'glm-5';

    for (const p of phones) {
      const { rows: existing } = await client.query(
        `SELECT id FROM jkai_conversations WHERE whatsapp_phone_number=$1 AND source='whatsapp' LIMIT 1`,
        [p.phone_number],
      );
      let convId: string;
      if (existing[0]) {
        convId = existing[0].id;
        console.log(`[migrate] phone ${p.phone_number} already has conv ${convId}`);
      } else {
        const { rows } = await client.query(
          `INSERT INTO jkai_conversations (source, whatsapp_phone_number, model_provider, model_id, created_at, updated_at)
           VALUES ('whatsapp', $1, $2, $3, $4, $4) RETURNING id`,
          [p.phone_number, DEFAULT_PROVIDER, DEFAULT_MODEL, p.first_seen],
        );
        convId = rows[0].id;
        console.log(`[migrate] created conv ${convId} for ${p.phone_number}`);
      }

      const { rowCount } = await client.query(
        `INSERT INTO orchestrator_chats (conversation_id, role, content, metadata, created_at)
         SELECT $1, role, content, metadata, created_at
           FROM whatsapp_conversations
          WHERE phone_number=$2
            AND NOT EXISTS (
              SELECT 1 FROM orchestrator_chats oc
               WHERE oc.conversation_id=$1
                 AND oc.created_at=whatsapp_conversations.created_at
                 AND oc.role=whatsapp_conversations.role
            )`,
        [convId, p.phone_number],
      );
      console.log(`[migrate] inserted ${rowCount} messages for ${p.phone_number}`);
    }

    await client.query('COMMIT');
    console.log('[migrate] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
