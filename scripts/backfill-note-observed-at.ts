// Backfill `intel_notes.observed_at` — when each note's subject matter actually
// happened, as opposed to when the sweep wrote the row.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/backfill-note-observed-at.ts [--apply]
//
// Runs as a dry run unless `--apply` is passed.
//
// New notes get this at ingest (gmail-ingest passes the thread's `internalDate`
// through to auto-extract). This is only for rows written before that existed.
// Two sources, best first:
//
//   1. THE EDGES THE NOTE PRODUCED. `intel_relationships.last_seen_at` was
//      already being written from the thread's observed time, so where a note
//      produced edges the true date is recoverable exactly.
//
//   2. THE GMAIL THREAD ID. Gmail ids encode their creation time in the upper
//      bits — `BigInt('0x' + id) >> 20n` is the epoch in ms. That covered the
//      737 email notes which produced no edges and so have no other record of
//      when they arrived. Validated against the 301 notes where the answer is
//      known from (1): every decode landed inside the mailbox's real 12-week
//      window, with a median difference of ~2 days because the id dates the
//      START of a thread while the edges date its most recent message.
//
//      That approximation is fine for what reads this — a 42-day half-life
//      moves by about 3% over two days — but it is why the decode lives in a
//      one-off script and not in the ingest path. If Gmail ever changes its id
//      format, nothing in production notices.
//
// Notes from every other source keep a null `observed_at`, which readers treat
// as "same as created_at". That is correct for them: a deep dive or an uploaded
// file genuinely is observed when it is created.
import { Pool } from 'pg';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('set DATABASE_URL');
const pool = new Pool({ connectionString: url, max: 4 });

/** Epoch ms encoded in a Gmail message/thread id, or null if it is not one. */
function decodeGmailId(id: string): number | null {
  if (!/^[0-9a-f]{12,20}$/i.test(id)) return null;
  try {
    const ms = Number(BigInt('0x' + id) >> 20n);
    // Sanity-gate the decode rather than trusting it: anything outside a
    // plausible window means the id was not what we assumed.
    const lo = Date.UTC(2004, 0, 1);
    const hi = Date.now() + 86_400_000;
    return ms > lo && ms < hi ? ms : null;
  } catch {
    return null;
  }
}

const { rows } = await pool.query(`
  SELECT n.id, n.source, n.created_at, n.metadata->>'gmailThreadId' AS thread_id,
         (SELECT MAX(r.last_seen_at) FROM intel_relationships r
          WHERE r.source_note_id = n.id AND r.suppressed IS NOT TRUE) AS from_edges
  FROM intel_notes n
  WHERE n.observed_at IS NULL
`);

let fromEdges = 0;
let fromThreadId = 0;
let skipped = 0;
const updates: Array<{ id: string; at: Date }> = [];

for (const r of rows as Array<Record<string, unknown>>) {
  const id = String(r.id);
  if (r.from_edges) {
    updates.push({ id, at: new Date(String(r.from_edges)) });
    fromEdges++;
    continue;
  }
  const tid = r.thread_id ? String(r.thread_id) : '';
  const decoded = tid ? decodeGmailId(tid) : null;
  if (decoded) {
    updates.push({ id, at: new Date(decoded) });
    fromThreadId++;
    continue;
  }
  skipped++;
}

console.log(`notes with no observed_at : ${rows.length}`);
console.log(`  recoverable from edges  : ${fromEdges}`);
console.log(`  decoded from thread id  : ${fromThreadId}`);
console.log(`  left null (created_at)  : ${skipped}`);

if (updates.length) {
  const days = new Set(updates.map((u) => u.at.toISOString().slice(0, 10)));
  const sorted = updates.map((u) => u.at.getTime()).sort((a, b) => a - b);
  console.log(
    `  resolved span           : ${new Date(sorted[0]).toISOString().slice(0, 10)} -> ` +
      `${new Date(sorted[sorted.length - 1]).toISOString().slice(0, 10)} (${days.size} distinct days)`,
  );
}

if (!APPLY) {
  console.log('\ndry run — pass --apply to write');
  await pool.end();
} else {
  // One statement, not one per row: 1,000+ round trips for a backfill is a
  // needlessly long window in which a deploy could interrupt it half-done.
  const ids = updates.map((u) => u.id);
  const ats = updates.map((u) => u.at.toISOString());
  await pool.query(
    `UPDATE intel_notes AS n SET observed_at = v.at::timestamptz
     FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS at) v
     WHERE n.id = v.id`,
    [ids, ats],
  );
  console.log(`\napplied to ${updates.length} notes`);
  await pool.end();
}
