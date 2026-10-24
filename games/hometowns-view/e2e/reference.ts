// Node's side of the browser checks, run with tsx (Playwright's own loader
// will not import the engine's params JSON without an import attribute, and
// the engine stays free of loader-specific syntax).
//
//   tsx e2e/reference.ts bot <seed> <site> <days>   → the bot town's hash
//   tsx e2e/reference.ts fixture <kind>             → {county, town, now} as JSON
//   tsx e2e/reference.ts wire                       → a whole frame of a fresh solo county (WP4's adapter)

import { fixture, type FixtureKind } from '../../../scripts/hometowns/fixture';
import * as HT from '../../../src/lib/games/hometowns/hometowns';
import { COUNTY_ROAD_X } from '../src/engine';
import { HarnessSession } from '../src/harness/session';

const [mode, ...args] = process.argv.slice(2);
if (mode === 'bot') {
  const [seed, site, days] = args.map(Number);
  const s = new HarnessSession({ seed, site });
  s.runDays(days);
  process.stdout.write(s.hash());
} else if (mode === 'fixture') {
  const f = fixture(args[0] as FixtureKind);
  process.stdout.write(JSON.stringify({ county: f.county, town: f.town, now: f.now }));
} else if (mode === 'wire') {
  const T0 = Date.now();
  const room = HT.createRoom({ id: 'e2e-1', host: { id: 'h', name: 'Mayor' }, invite: [], difficulty: 'easy', now: T0 });
  HT.start(room, 'h', T0);
  HT.moves.found(room, 'h', { site: 0, nameParts: ['Oak', 'vale'], avatar: 'otter', flag: 1 }, T0 + 1);
  HT.moves.build(room, 'h', { planId: 'e2e-seed', plan: [{ op: 'road', kind: 'lane', path: [COUNTY_ROAD_X, 46, COUNTY_ROAD_X - 5, 46] }] }, T0 + 2);
  process.stdout.write(JSON.stringify(HT.toWire(room, 'h', T0 + 3)));
} else {
  process.stderr.write('usage: reference.ts bot <seed> <site> <days> | fixture <kind>\n');
  process.exit(2);
}
