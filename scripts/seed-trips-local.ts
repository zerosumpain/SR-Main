// Seed the Rome test trip (D3) into a LOCAL database and solve version 1.
//
//   DATABASE_URL=postgresql://…/trips_local OWNER_EMAIL=preview@example.test \
//     npx tsx scripts/seed-trips-local.ts [--replace]
//
// LOCAL ONLY: refuses any DATABASE_URL whose database name does not end in
// `_local`, so it cannot be pointed at production by accident. The trip comes
// from the solver's fixture (`src/lib/trips/solver/fixtures/rome.ts`): real
// places at real coordinates, ILLUSTRATIVE hours, lead times and booked slots.
// Fixture ids become UUIDs (the tables' keys); the plan is solved with the
// fixture's distance × factor matrix and stored as version 1, source 'seed'.
// `--replace` deletes an earlier seeded Rome trip for the same owner first.

import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Booking, Stay, TravelMatrix, Wish } from '../src/lib/trips/model';
import { estimateMatrix, solveTrip } from '../src/lib/trips/solver/index';
import { ROME_BOOKINGS, ROME_STAY, ROME_TRIP, ROME_WISHES } from '../src/lib/trips/solver/fixtures/rome';

const url = process.env.DATABASE_URL ?? '';
const owner = (process.env.OWNER_EMAIL ?? 'preview@example.test').trim().toLowerCase();
const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!/_local$/.test(dbName)) {
  console.error(`seed-trips-local: refusing DATABASE_URL database "${dbName}" — only *_local databases.`);
  process.exit(2);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

async function main() {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (process.argv.includes('--replace')) {
      const old = await client.query(`select id from trip where owner_email = $1 and title = $2`, [owner, ROME_TRIP.title]);
      for (const { id } of old.rows) {
        for (const t of ['trip_event', 'trip_plan', 'trip_booking', 'trip_wish', 'trip_stay']) await client.query(`delete from ${t} where trip_id = $1`, [id]);
        await client.query(`delete from trip where id = $1`, [id]);
      }
    }

    const tripId = randomUUID();
    const ids = new Map<string, string>();
    const idOf = (fixtureId: string) => {
      if (!ids.has(fixtureId)) ids.set(fixtureId, randomUUID());
      return ids.get(fixtureId)!;
    };

    const trip = { ...ROME_TRIP, id: tripId, ownerEmail: owner, status: 'planned' as const };
    const stays: Stay[] = [{ ...ROME_STAY, id: idOf(ROME_STAY.id) }];
    const wishes: Wish[] = ROME_WISHES.map((w, i) => ({
      ...w,
      id: idOf(w.id),
      sortHint: (i + 1) * 10,
      note: 'Rome test trip (D3): hours, lead times and slots are illustrative.',
    }));
    const bookings: Booking[] = ROME_BOOKINGS.map((b) => ({ ...b, id: idOf(b.id), wishId: b.wishId ? idOf(b.wishId) : null }));

    await client.query(
      `insert into trip (id, owner_email, title, destination, time_zone, start_date, end_date, pace, modes, status, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tripId, owner, trip.title, trip.destination, trip.timeZone, trip.startDate, trip.endDate, trip.pace, JSON.stringify(trip.modes), trip.status, 'Seeded test trip (D3).'],
    );
    for (const s of stays) {
      await client.query(
        `insert into trip_stay (id, trip_id, name, address, lat, lng, from_date, to_date, check_in_min, check_out_min)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [s.id, tripId, s.name, s.address, s.location.lat, s.location.lng, s.fromDate, s.toDate, s.checkInMin, s.checkOutMin],
      );
    }
    for (const w of wishes) {
      await client.query(
        `insert into trip_wish (id, trip_id, title, place, priority, duration_sec, part_of_day, fixed_date, fixed_start_min, locked, suggested, skipped, facts, note, sort_hint)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [w.id, tripId, w.title, JSON.stringify(w.place), w.priority, w.durationSec, w.partOfDay, w.fixedDate, w.fixedStartMin, w.locked, w.suggested, w.skipped, JSON.stringify(w.facts), w.note, w.sortHint],
      );
    }
    for (const b of bookings) {
      await client.query(
        `insert into trip_booking (id, trip_id, wish_id, title, date, start_min, end_min, reference, url, document_id, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [b.id, tripId, b.wishId, b.title, b.date, b.startMin, b.endMin, b.reference, b.url, b.documentId, b.status],
      );
    }

    const points = [
      ...stays.map((s) => ({ id: `stay:${s.id}`, location: s.location })),
      ...wishes.filter((w) => w.place).map((w) => ({ id: w.id, location: w.place!.location })),
    ];
    const matrix: TravelMatrix = estimateMatrix(points, trip.modes);
    const input = {
      trip: { id: trip.id, timeZone: trip.timeZone, startDate: trip.startDate, endDate: trip.endDate, pace: trip.pace, modes: trip.modes },
      stays,
      wishes,
      bookings,
      matrix,
    };
    const plan = solveTrip(input);
    const inputHash = createHash('sha256').update(canonical(input)).digest('hex');
    await client.query(
      `insert into trip_plan (trip_id, version, source, input_hash, plan, matrix, changes) values ($1, 1, 'seed', $2, $3, $4, $5)`,
      [tripId, inputHash, JSON.stringify(plan), JSON.stringify(matrix), JSON.stringify(['First plan (seeded; travel times estimated from distance).'])],
    );
    await client.query('commit');
    const planned = plan.days.reduce((n, d) => n + d.stops.filter((s) => s.kind === 'wish').length, 0);
    console.log(`seeded trip ${tripId} for ${owner}: ${wishes.length} wishes, ${planned} planned over ${plan.days.length} days, ${plan.dropped.length} dropped`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
