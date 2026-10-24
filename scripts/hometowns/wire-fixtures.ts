// Wire fixtures for the iPhone app (spec §10.13, WP4 → WP7): whole and delta
// frames as a phone receives them, built from the golden fixture towns
// (scripts/hometowns/fixture.ts) after a day of real catch-up, so every
// record is filled. Bot- and hand-built only (A36): no production room, no
// family name. XCTest decodes every file; regenerate after an engine or wire
// change:
//
//   npx tsx scripts/hometowns/wire-fixtures.ts [outDir]      (default fixtures/hometowns)
//
// Files: lobby.json (a county waiting to start), founding.json (seated, no
// town yet), hamlet.json, town.json, metropolis.json (whole frames),
// metropolis-delta.json (the frame after a budget move, cut against
// metropolis.json), visiting.json (the hamlet's mayor visiting a neighbour),
// and copy-hash.json: the FNV-1a 64 of engine/copy/en-GB.json's bytes, which
// the app's tests compare with the copy file it bundles, so a bundled copy
// that has fallen behind the site's fails a test instead of showing a child
// a raw key.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, type FixtureKind } from './fixture';
import { catchUp, fnv64, type CountyState } from '../../src/lib/games/hometowns/engine/index';
import { createRoom, moves, start, type Room } from '../../src/lib/games/hometowns/hometowns';
import { toWire } from '../../src/lib/games/hometowns/wire';

const DAY = 86_400_000;
const HOST = { id: 'p_fixture_host', name: 'Mayor' };

/** A running room around a fixture county after a day of play, its town seated s1 and its mayor a parent. */
function playedRoom(kind: FixtureKind): { room: Room; now: number } {
  const f = fixture(kind);
  const c: CountyState = f.county;
  const t = c.towns[f.town];
  for (const s of c.sites) if (s.owner === t.seat) s.owner = 's1';
  t.seat = 's1';
  t.ownerId = 's1';
  c.settings.youngestOrder = ['s1'];
  c.settings.perSeat = { s1: { profile: 'adult', pushes: true, pranks: true, answerOnly: false, assist: 'none' } };
  c.parents = ['s1'];
  const now = f.now + DAY;
  c.lastHelloAt = now;
  catchUp(c, now, 1e9);
  const room = createRoom({ id: `g_fixture${kind.slice(0, 3)}`, host: HOST, invite: [], difficulty: 'easy', options: { county: { seed: c.seed } }, now: c.epoch });
  room.phase = 'running';
  room.county = c;
  room.daySeen = c.dayIndex;
  room.players[0].seat = 's1';
  return { room, now };
}

const json = (x: unknown) => JSON.stringify(x, null, 1) + '\n';

export function wireFixtures(): Record<string, unknown> {
  // The fixtures' terrain is pinned by seed, which the adapter honours only
  // with the dev clock on (readSetup): this script is the local stack's.
  process.env.HOMETOWNS_DEV_CLOCK = '1';
  const out: Record<string, unknown> = {};
  const lobby = createRoom({ id: 'g_fixturelob', host: HOST, invite: [{ id: 'p_fixture_child', name: 'Young mayor' }], difficulty: 'easy', options: { county: { name: 'Kingsport County', seed: 1 } }, now: 1_792_497_600_000 });
  out.lobby = toWire(lobby, HOST.id, 1_792_497_600_000);
  start(lobby, HOST.id, 1_792_497_660_000);
  out.founding = toWire(lobby, HOST.id, 1_792_497_660_000);
  for (const kind of ['hamlet', 'town', 'metropolis'] as const) {
    const { room, now } = playedRoom(kind);
    const whole = JSON.parse(JSON.stringify(toWire(room, HOST.id, now)));
    out[kind] = whole;
    if (kind === 'metropolis') {
      moves.budget(room, HOST.id, { action: 'budget', moveId: 'fixture-budget', taxes: { town: 900 } }, now + 1000);
      out['metropolis-delta'] = toWire(room, HOST.id, now + 1000, whole.rev);
    }
    if (kind === 'hamlet') {
      // A second, public-only town to visit.
      const other = JSON.parse(JSON.stringify(room.county.towns[0]));
      other.seat = 's2';
      other.ownerId = 's2';
      other.name = 'Oakridge';
      other.site = 1;
      room.county.sites[1].owner = 's2';
      room.county.towns.push(other);
      room.players.push({ id: 'p_fixture_other', name: 'Neighbour', status: 'joined', seat: 's2' });
      room.county.settings.perSeat.s2 = { profile: 'kid', pushes: false, pranks: true, answerOnly: false, assist: 'none' };
      moves.visit(room, HOST.id, { action: 'visit', seat: 's2' }, now + 1000);
      out.visiting = toWire(room, HOST.id, now + 1000);
    }
  }
  const copy = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/games/hometowns/engine/copy/en-GB.json'), 'utf8');
  out['copy-hash'] = { file: 'src/lib/games/hometowns/engine/copy/en-GB.json', fnv64: fnv64(copy) };
  return out;
}

function main(): void {
  const dir = process.argv[2] ?? 'fixtures/hometowns';
  mkdirSync(dir, { recursive: true });
  for (const [name, frame] of Object.entries(wireFixtures())) writeFileSync(join(dir, `${name}.json`), json(frame));
  console.log(`[wire-fixtures] wrote ${dir}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
