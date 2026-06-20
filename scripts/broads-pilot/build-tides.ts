// build-tides.ts — write static/broads-pilot/tides.json: real predicted High/Low
// Water at GORLESTON (Gorleston-on-Sea / Great Yarmouth Bar), the standard port
// the whole Broads tidal regime references. Every Broads location is Gorleston +
// a fixed average offset (see TIDE_OFFSET_MIN in lib/seed-restrictions.ts), so a
// boat can read the local low-water (= maximum headroom) time at each bridge.
//
// SOURCE: Peel Ports "TIDE TABLES GREAT YARMOUTH 2026" — the official harbour-
// authority predictions ("Predicted times refer to High and Low Water at
// Gorleston", heights in m above Chart Datum), cross-checked vs UKHO ADMIRALTY
// EasyTide PortID 0142. Raw rows below are LOCAL clock time (BST, UTC+1 — in
// force 29 Mar–25 Oct 2026); we store the UTC instant so the client can render
// it in Europe/London for any date.
//
// To extend coverage, transcribe more rows from the Peel Ports PDF and re-run:
//   npx tsx scripts/broads-pilot/build-tides.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// [date, BST clock time, type, height m above CD]
const RAW: [string, string, 'low' | 'high', number][] = [
  ['2026-07-16', '05:01', 'low', 0.93], ['2026-07-16', '10:57', 'high', 2.81], ['2026-07-16', '17:38', 'low', 0.25], ['2026-07-16', '23:59', 'high', 2.69],
  ['2026-07-17', '05:47', 'low', 0.93], ['2026-07-17', '11:46', 'high', 2.87], ['2026-07-17', '18:23', 'low', 0.18],
  ['2026-07-18', '00:44', 'high', 2.66], ['2026-07-18', '06:30', 'low', 0.97], ['2026-07-18', '12:33', 'high', 2.89], ['2026-07-18', '19:07', 'low', 0.23],
  ['2026-07-19', '01:28', 'high', 2.58], ['2026-07-19', '07:11', 'low', 1.04], ['2026-07-19', '13:19', 'high', 2.86], ['2026-07-19', '19:51', 'low', 0.40],
  ['2026-07-20', '02:12', 'high', 2.47], ['2026-07-20', '07:52', 'low', 1.14], ['2026-07-20', '14:05', 'high', 2.78], ['2026-07-20', '20:37', 'low', 0.64],
  ['2026-07-21', '02:59', 'high', 2.36], ['2026-07-21', '08:35', 'low', 1.26], ['2026-07-21', '14:52', 'high', 2.66], ['2026-07-21', '21:25', 'low', 0.89],
  ['2026-07-22', '03:51', 'high', 2.28], ['2026-07-22', '09:21', 'low', 1.39], ['2026-07-22', '15:44', 'high', 2.53], ['2026-07-22', '22:19', 'low', 1.10],
  ['2026-07-23', '04:51', 'high', 2.26], ['2026-07-23', '10:22', 'low', 1.48], ['2026-07-23', '16:42', 'high', 2.40], ['2026-07-23', '23:22', 'low', 1.23],
  ['2026-07-24', '05:57', 'high', 2.29], ['2026-07-24', '11:49', 'low', 1.50], ['2026-07-24', '17:47', 'high', 2.31],
  ['2026-07-25', '00:24', 'low', 1.28], ['2026-07-25', '06:56', 'high', 2.36], ['2026-07-25', '13:24', 'low', 1.41], ['2026-07-25', '18:54', 'high', 2.26],
  ['2026-07-26', '01:17', 'low', 1.28], ['2026-07-26', '07:47', 'high', 2.43], ['2026-07-26', '14:30', 'low', 1.28], ['2026-07-26', '20:31', 'high', 2.24],
  // monthly spot-checks (validation + a wider planning anchor)
  ['2026-08-01', '05:12', 'low', 0.91], ['2026-08-01', '11:21', 'high', 2.77], ['2026-08-01', '18:03', 'low', 0.57], ['2026-08-02', '00:07', 'high', 2.44],
  ['2026-09-01', '06:05', 'low', 0.91], ['2026-09-01', '12:14', 'high', 2.86], ['2026-09-01', '18:45', 'low', 0.73], ['2026-09-02', '00:46', 'high', 2.54],
  ['2026-09-15', '06:13', 'low', 0.94], ['2026-09-15', '12:26', 'high', 2.88], ['2026-09-15', '18:49', 'low', 0.78], ['2026-09-16', '00:59', 'high', 2.55],
  ['2026-10-01', '06:20', 'low', 0.95], ['2026-10-01', '12:32', 'high', 2.77], ['2026-10-01', '18:46', 'low', 0.99], ['2026-10-02', '00:59', 'high', 2.61],
];

const events = RAW.map(([date, time, type, h]) => ({
  // BST is UTC+1 for every row in range → store the UTC instant.
  t: new Date(`${date}T${time}:00+01:00`).toISOString(),
  type,
  h,
})).sort((a, b) => a.t.localeCompare(b.t));

const out = {
  station: 'Gorleston-on-Sea (Great Yarmouth)',
  source: 'Peel Ports official Great Yarmouth tide tables 2026 (Admiralty EasyTide 0142 cross-checked)',
  datum: 'Heights in metres above Chart Datum',
  note: 'Predicted High/Low Water at Gorleston. Each Broads bridge applies a fixed average offset. Outside the dates here the planner projects approximate low waters from the nearest real one.',
  events,
};

const DIR = join(process.cwd(), 'static', 'broads-pilot');
writeFileSync(join(DIR, 'tides.json'), JSON.stringify(out));
console.log(`✓ tides.json: ${events.length} Gorleston events, ${events[0].t.slice(0, 10)} → ${events[events.length - 1].t.slice(0, 10)}`);
