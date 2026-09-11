// Rebuild geo_tile_state for EVERY cell in the capture ledger.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/recompute-geo-tiles.ts [--apply]
//
// Dry run unless `--apply` is passed.
//
// THE GAP THIS FILLS
//
// The hourly ingest recomputes only the cells that run touched, which is right
// for an ingest and wrong for anything that changes how EXISTING rows score.
// After scripts/backfill-outing-weights.ts re-weights the ledger, every cell's
// owner may have changed while `geo_tile_state` — the materialised fast path
// the ALL-TIME view reads — still holds the old answer. Nothing else rebuilds
// the whole table: `rebuildGeoTerritory` resets the watermarks and re-ingests,
// which only touches cells whose SOURCE data still exists, and `pruneTrail`
// deleted most of that at 90 days.
//
// Left stale the page contradicts itself, because only half of it reads the
// table: the default 30-day view is resolved live from the ledger and correct,
// while "All time" reads geo_tile_state and shows pre-change ownership.
//
// WHY IT TALKS TO POSTGRES DIRECTLY
//
// `$lib/geo/service` cannot be imported outside vite — it reaches `$env`
// through `$lib/db` — so this uses `pg` like every other script here and
// imports only the PURE half. `resolveOwnership` and `ownerBefore` are the same
// functions `recomputeTiles` calls, so the rows written are identical; that is
// why `ownerBefore` lives in `ownership.ts` rather than next to its caller.
//
// Idempotent: the state is derived from the ledger, never from the row it
// overwrites.

import { Pool } from 'pg';
import { ownerBefore, resolveOwnership, type CaptureEvent, type CaptureKind } from '../src/lib/geo/ownership';
// The SAME key `resolveOwnership` builds its map with. Rolling a local
// `${x},${y}` here instead cost a full rebuild: every `byTile` lookup missed,
// so `ownerBefore` saw an empty event list and wrote `previous_owner` null on
// all 19,479 rows without erroring.
import { tileKeyOf } from '../src/lib/geo/tiles';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 4 });


async function main() {
  const now = new Date();
  const { rows } = await pool.query(
    `select subject, tile_x, tile_y, day, kind, weight, captured_at
       from geo_capture_events order by tile_x, tile_y`,
  );
  const events: CaptureEvent[] = rows.map((r) => ({
    subject: r.subject,
    tileX: r.tile_x,
    tileY: r.tile_y,
    day: r.day,
    kind: r.kind as CaptureKind,
    weight: Number(r.weight),
    capturedAt: new Date(r.captured_at),
  }));

  const byTile = new Map<string, CaptureEvent[]>();
  for (const e of events) {
    const k = tileKeyOf(e.tileX, e.tileY);
    const held = byTile.get(k);
    if (held) held.push(e);
    else byTile.set(k, [e]);
  }

  const owned = resolveOwnership(events, now);
  const { rows: state } = await pool.query('select count(*)::int as n from geo_tile_state');
  console.log(
    `ledger: ${events.length} events over ${byTile.size} cells; resolved ${owned.size} owned cells; geo_tile_state holds ${state[0].n} rows`,
  );

  const board = new Map<string, number>();
  for (const o of owned.values()) board.set(o.owner, (board.get(o.owner) ?? 0) + 1);
  console.log('resolved board:', [...board].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · '));

  if (!APPLY) {
    console.log('DRY RUN — pass --apply to rewrite geo_tile_state');
    return;
  }

  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('begin');
    for (const [k, o] of owned) {
      const prev = ownerBefore(byTile.get(k) ?? [], k, o.ownerSince, o.owner);
      await client.query(
        `insert into geo_tile_state
           (tile_x, tile_y, owner_subject, owner_score, owner_since, last_event_at,
            previous_owner, runner_up, runner_up_score, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (tile_x, tile_y) do update set
           owner_subject = excluded.owner_subject,
           owner_score = excluded.owner_score,
           owner_since = excluded.owner_since,
           last_event_at = excluded.last_event_at,
           previous_owner = excluded.previous_owner,
           runner_up = excluded.runner_up,
           runner_up_score = excluded.runner_up_score,
           updated_at = excluded.updated_at`,
        [o.tileX, o.tileY, o.owner, o.score, o.ownerSince, o.lastEventAt, prev, o.runnerUp, o.runnerUpScore, now],
      );
      written += 1;
      if (written % 2000 === 0) console.log(`  ${written}/${owned.size}`);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
  console.log(`wrote ${written} rows`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
