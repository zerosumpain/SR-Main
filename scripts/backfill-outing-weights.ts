// Re-weight the capture ledger for per-outing scoring (OUTING_ALPHA).
//
//   DATABASE_URL=postgresql://... npx tsx scripts/backfill-outing-weights.ts [--apply]
//
// Dry run unless `--apply` is passed. Prints the board before and after either
// way, because the point of the change is which of those two tables is fairer.
//
// WHY THIS EXISTS RATHER THAN A REBUILD
//
// `rebuildGeoTerritory()` cannot do it. Two independent reasons:
//
//   1. The new weights are LOWER than the old ones — a claim is now divided by
//      the size of the outing that made it — and `writeEvents` resolves a
//      conflict by keeping the HIGHER weight. A replay would therefore leave
//      every existing row exactly as it is.
//   2. `pruneTrail` hard-deletes `daydream_trail` at 90 days, so most of the
//      history a replay would need is gone. `geo_capture_events` is the system
//      of record and cannot be regenerated. Truncating it would destroy the
//      household's territory permanently.
//
// So the weights are recomputed in place, from the two things the ledger still
// knows: each row's `kind`, and how many rows its outing produced.
//
// IDEMPOTENT. The new weight is derived from `kind` and the outing size, never
// from the current weight, so running it twice is the same as running it once.
// That also makes it reversible: set alpha to 0 and re-run to restore the flat
// weights exactly.

import { Pool } from 'pg';
import { KIND_WEIGHT, OUTING_ALPHA } from '../src/lib/geo/ownership';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 4 });

/** `case kind when 'loop' then 3 ... end`, built from the one source of truth. */
const kindCase = `case e.kind ${Object.entries(KIND_WEIGHT)
  .map(([kind, w]) => `when '${kind}' then ${w}`)
  .join(' ')} else 1 end`;

/** Who holds what, resolved the same way resolveOwnership does: argmax of the
 *  decayed score. The replay in the app exists for `owner_since`; the owner as
 *  at now is this. */
const BOARD = `
  with scored as (
    select tile_x, tile_y, subject,
           sum(weight * exp(-extract(epoch from (now() - captured_at)) / 86400.0 / 43.3)) sc
    from geo_capture_events group by 1, 2, 3
  ), best as (
    select distinct on (tile_x, tile_y) tile_x, tile_y, subject
    from scored order by tile_x, tile_y, sc desc, subject
  ), con as (
    select tile_x, tile_y from geo_capture_events
    group by 1, 2 having count(distinct subject) > 1
  )
  select b.subject,
         count(*) as cells,
         count(*) filter (where c.tile_x is not null) as contested
  from best b left join con c using (tile_x, tile_y)
  group by 1 order by 2 desc`;

async function board(label: string) {
  const { rows } = await pool.query(BOARD);
  console.log(`\n${label}`);
  console.log('  subject      cells   contested');
  for (const r of rows) {
    console.log(
      `  ${String(r.subject).padEnd(10)} ${String(r.cells).padStart(7)} ${String(r.contested).padStart(11)}`,
    );
  }
}

async function main() {
  const { rows: before } = await pool.query(
    `select count(*)::int as rows,
            count(distinct (subject, source_ref))::int as outings,
            round(avg(weight)::numeric, 4) as avg_weight
     from geo_capture_events`,
  );
  console.log(
    `ledger: ${before[0].rows} events across ${before[0].outings} outings, mean weight ${before[0].avg_weight}`,
  );
  console.log(`alpha: ${OUTING_ALPHA}${APPLY ? '' : '   (DRY RUN — pass --apply to write)'}`);

  await board('BEFORE');

  const update = `
    update geo_capture_events e
       set weight = ${kindCase}::float / power(o.n, ${OUTING_ALPHA})
      from (select subject, source_ref, count(*)::float n
              from geo_capture_events group by 1, 2) o
     where o.subject = e.subject
       and o.source_ref = e.source_ref
       and e.weight is distinct from ${kindCase}::float / power(o.n, ${OUTING_ALPHA})`;

  if (!APPLY) {
    // Same predicate, counted rather than applied.
    const { rows } = await pool.query(`
      select count(*)::int as n
        from geo_capture_events e
        join (select subject, source_ref, count(*)::float n
                from geo_capture_events group by 1, 2) o
          on o.subject = e.subject and o.source_ref = e.source_ref
       where e.weight is distinct from ${kindCase}::float / power(o.n, ${OUTING_ALPHA})`);
    console.log(`\nwould rewrite ${rows[0].n} of ${before[0].rows} weights`);
    console.log('AFTER is not shown on a dry run — it is the same query over unchanged rows.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const res = await client.query(update);
    await client.query('commit');
    console.log(`\nrewrote ${res.rowCount} weights`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  await board('AFTER');
  console.log(
    '\ngeo_tile_state is now STALE — it is materialised from these weights.\n' +
      'Force the territory heartbeat to recompute it:\n' +
      "  update heartbeat_actions set next_run_at = now() where name = 'geo-territory';",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
