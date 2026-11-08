// Test kit for the county layer (WP3). Builds small counties of hand-built
// fixture towns (A36: no real room is ever used), puts them on links, and
// runs Regional Days against a STUB economy, so a test controls every
// number the settlement reads (intents, vacancies, surpluses) and nothing
// else moves people or money. The real economy is only used by the one
// catch-up-order test that needs it.

import { gridTickAt, countyMonth, nextRegionalDayAt } from '../../src/lib/games/hometowns/engine/clock';
import { regionalDay } from '../../src/lib/games/hometowns/engine/county';
import { emptyBooks, neutralFlows, population } from '../../src/lib/games/hometowns/engine/core';
import { paramsFor } from '../../src/lib/games/hometowns/engine/params';
import { snapshotOf } from '../../src/lib/games/hometowns/engine/snapshot';
import { withSteps } from '../../src/lib/games/hometowns/engine/steps';
import * as S from '../../src/lib/games/hometowns/engine/stubs';
import { linkMinutes } from '../../src/lib/games/hometowns/engine/region-state';
import type { CountyState, Link, RegionalContext, RegionalDayReport, StepTable } from '../../src/lib/games/hometowns/engine/types';
import { fixture, type FixtureKind } from './fixture';

/** Every town-level step replaced by its neutral stub; the Regional Day's steps are the real ones. */
export const STUB_ECONOMY: StepTable = withSteps({
  develop: S.stubDevelop,
  'M1b supply': S.stubSupply,
  'M2 utilities': S.stubUtilities,
  'M3 fields': S.stubFields,
  'M4 transport': S.stubTransport,
  'M5 labour': S.stubLabour,
  'M6 tourism': S.stubTourism,
  'M7a households': S.stubHouseholds,
  'M7b spending': S.stubSpending,
  'M7c tax receipts': S.stubTaxReceipts,
  'M8 firms': S.stubFirms,
  'M9 demography': S.stubDemography,
  'M10 stars': S.stubStars,
  'M10b happiness': S.stubHappiness,
  'M11 migration': S.stubMigration,
  'M12 housing': S.stubHousing,
  'M13 finance': S.stubFinance,
  'M14 records': S.stubRecords,
  'M14b develop memo': S.stubDevelopMemo,
});

/** Ring sites for n towns: 0, 1, 3, 4, 2, 5 (so some pairs are neighbours and some meet via Kingsport). */
const SITES = [0, 1, 3, 4, 2, 5];

/**
 * A county of `n` copies of a fixture town on different sites, all on the
 * grid, out of their grace, with seats 's0' … and youngestOrder s0 first.
 */
export function multiCounty(n: number, kind: FixtureKind = 'hamlet', opts: { rivalry?: 'friendly' | 'spirited' } = {}): { c: CountyState; now: number } {
  const f = fixture(kind);
  const c = f.county;
  const base = JSON.stringify(c.towns[f.town]);
  c.towns = [];
  for (const s of c.sites) s.owner = null;
  c.ledger = [];
  c.flows = { towns: [] };
  c.bulletin = [];
  c.council.votes = [];
  c.awards.dry = [];
  c.settings.youngestOrder = [];
  if (opts.rivalry) c.settings.rivalry = opts.rivalry;
  for (let i = 0; i < n; i++) {
    const t = JSON.parse(base) as CountyState['towns'][number];
    const site = SITES[i];
    t.seat = `s${i}`;
    t.ownerId = `owner-${i}`;
    t.name = `Town${i}`;
    t.site = site;
    t.grace = null;
    c.sites[site].owner = t.seat;
    c.towns.push(t);
    c.flows.towns.push(neutralFlows());
    c.bulletin.push([]);
    c.council.votes.push(null);
    c.awards.dry.push(0);
    c.settings.youngestOrder.push(t.seat);
    c.settings.perSeat[t.seat] = { profile: 'adult', pushes: false, pranks: true, answerOnly: false, assist: 'none' };
  }
  c.ledger = new Array<number>(n * n * 10).fill(0);
  c.snapshot = snapshotOf(c, c.lastRegionalDayAt, countyMonth(c.gridTick));
  c.snapshot.dayIndex = c.dayIndex - 1;
  return { c, now: f.now };
}

/** An open link between two towns (as if built and opened at an earlier Regional Day). */
export function openLink(c: CountyState, a: number, b: number, kind: Link['kind'] = 'road'): Link {
  const l: Link = { id: `L.${kind}.${a}.${b}`, kind, a, b, state: 'open', proposedDay: 0, openedDay: 0, closeDay: null, paid: [0, 0], minutes: linkMinutes(c, kind, a, b) };
  c.links.push(l);
  return l;
}

/** Links every pair. */
export function linkAll(c: CountyState): void {
  for (let a = 0; a < c.towns.length; a++) for (let b = a + 1; b < c.towns.length; b++) openLink(c, a, b);
}

/** The context of the county's next Regional Day (for calling one step directly). */
export function nextContext(c: CountyState): RegionalContext {
  const p = paramsFor(c.paramsVersion);
  const at = nextRegionalDayAt(c, p.clock.devRegionalTicks);
  const report: RegionalDayReport = { dayIndex: c.dayIndex, at, ran: true, sprintsRun: 0, countyWeek: false, steps: [] };
  return { params: p, dayIndex: c.dayIndex, at, month: countyMonth(gridTickAt(c, at)), countyWeek: false, report };
}

/** Runs the next Regional Day (catch-up included) against the stub economy. */
export function runDay(c: CountyState, steps: StepTable = STUB_ECONOMY): RegionalDayReport {
  return regionalDay(c, c.dayIndex, { steps });
}

/** Sets a town's people so that it has `pop` persons, spread like the fixture's mix. */
export function totalPeople(c: CountyState): number {
  let s = 0;
  for (const t of c.towns) s += population(t);
  return s;
}

/** Restarts a town's books at its current reserves and people (after a test edits them directly). */
export function rebook(c: CountyState): void {
  for (const t of c.towns) t.books = emptyBooks(t.money.reserves, population(t));
}
