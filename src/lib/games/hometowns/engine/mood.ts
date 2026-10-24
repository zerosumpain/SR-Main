// Mood and the month's records (WP2d, spec §5.15 and M14): happiness per
// cohort, the town's Mood and Approval, Town Talk, the wants bubbles, the
// advisor cards, the tier checklist, the history sample and the money Why.
//
// Happiness follows U_happy (WP2b's M10: the residents' own utility with
// actual stars, the Tax weight at least 0.6 and the overcrowding,
// overqualification and irritation penalties) with τ 3 months. Approval
// follows Mood, the next tier's checklist and, directly, a homes tax above
// 10% (A13): in a town whose land has run out, people stay whatever the tax,
// so this is where a high tax has to be felt (gate G2b).
//
// Town Talk is the deterministic opinion poll: each star below 55 is talked
// about by every cohort that cares about it, in proportion to how far below
// it is and how many people are in the cohort; traffic and tax are talked
// about too. The top four are shown as percentages that sum to exactly 100.

import { selectAdvisors, type AdvisorFacts } from './advisors';
import { TIER_DEFS } from './content';
import { population } from './core';
import { neutral } from './derived';
import { civicMemo, debtService, meanHomesTax, monthsOfSpending } from './finance';
import { clamp, smooth } from './fx';
import { largestRemainder } from './num';
import { utilityTerms } from './needs';
import { pushHistoryMonth } from './records';
import { cohortsOf, facesOf } from './snapshot';
import { checkFacts, judgeChecklist } from './tiers';
import {
  COHORTS,
  COHORT_COUNT,
  COHORT_S,
  LEDGER_LINES,
  METER_INDUSTRY,
  METER_LEISURE,
  METER_OFFICES,
  METER_SHOPS,
  METER_FARMS,
  STARS,
  STAR_TOWN,
  starTier,
  type MonthContext,
  type MoodSlot,
  type TownState,
} from './types';

const star = (k: (typeof STARS)[number]) => STARS.indexOf(k);
const tierOf = (k: number) => (k === COHORT_S ? 0 : Math.floor(k / 3));

/** The face (0 grumpy … 4 beaming) a mood shows (§5.15). */
export function moodFace(mood: number, faces: readonly number[]): number {
  let f = 0;
  for (const at of faces) if (mood >= at) f++;
  return f;
}

/** Star f as cohort k feels it: Jobs, Homes and Tax per wealth tier, the rest town-wide. */
function felt(stars: readonly number[], f: number, k: number): number {
  const h = tierOf(k);
  if (f === star('jobs')) return stars[starTier(0, h)];
  if (f === star('homes')) return stars[starTier(1, h)];
  if (f === star('tax')) return stars[starTier(2, h)];
  return stars[f];
}

/**
 * Town Talk severities in persons, by key (the 11 stars, then 'traffic'):
 * Σ_k N_k · w[k,f] · max(0, 55 − I_f)/55, plus Traffic (congestion × N) and
 * the tax term ((HomesTax − 8%) in points × N × 0.1, added to 'tax').
 */
export function talkSeverities(t: TownState, m: MonthContext, stars: readonly number[]): { keys: string[]; sev: number[] } {
  const cv = m.params.civic;
  const w = m.params.migration.weights;
  const n = cohortsOf(t);
  const N = population(t);
  const keys = [...STARS, 'traffic'];
  const sev = new Array<number>(keys.length).fill(0);
  for (let f = 0; f < STAR_TOWN; f++)
    for (let k = 0; k < COHORT_COUNT; k++) {
      const gap = cv.talkAt - felt(stars, f, k);
      if (gap > 0 && n[k] > 0) sev[f] += (n[k] * Math.abs(w[k][f]) * gap) / cv.talkAt;
    }
  const tv = m.derived.travel ?? neutral.travel();
  sev[STAR_TOWN] = Math.max(0, tv.congestion) * N;
  const [free, per] = cv.talkTax;
  sev[star('tax')] += (Math.max(0, meanHomesTax(t) - free) / 100) * N * per;
  return { keys, sev };
}

/** The top items (largest first, ties by key order) as [key, percent], percents summing to 100. */
export function townTalk(keys: readonly string[], sev: readonly number[], top: number): [string, number][] {
  const order = keys.map((_, i) => i).filter((i) => sev[i] > 0);
  order.sort((a, b) => sev[b] - sev[a] || a - b);
  const pick = order.slice(0, top);
  if (pick.length === 0) return [];
  const pct = largestRemainder(100, pick.map((i) => sev[i]));
  return pick.map((i, j) => [keys[i], pct[j]]);
}

/**
 * STEP M10b (WP2d): happiness per cohort, τ 3 months towards 50 + 14·U_happy.
 * §5.3 puts happiness in M10 with the stars, so M11's movers and stayers read
 * this month's happiness; the Why splits the target into its star terms.
 */
export function stepHappiness(t: TownState, m: MonthContext): void {
  const p = m.params;
  const sp = p.stars;
  const stars = m.derived.stars;
  if (!stars) return;
  const needs = m.derived.needs ?? neutral.needs();
  const n = cohortsOf(t);
  for (let k = 0; k < COHORT_COUNT; k++) {
    const target = clamp(50 + sp.happyGain * stars.uHappy[k], 0, 100);
    t.happy[k] = clamp(smooth(t.happy[k], target, sp.happyTau), 0, 100);
    const q = `happy.${COHORTS[k]}`;
    m.why.set(q, t.happy[k]);
    if (n[k] <= 0) continue;
    const terms = utilityTerms(k, stars.actual, needs.cohort[k], t.taxes.homes[0] ?? 0, m, p.finance.taxHappyWeightMin);
    for (let f = 0; f < STAR_TOWN; f++) m.why.add(`happy.${STARS[f]}`, sp.happyGain * terms[f], q);
    m.why.add('happy.needs', sp.happyGain * terms[STAR_TOWN], q);
  }
}

/** STEP M14 (WP2d): Mood, Approval, the checklist, Town Talk, wants, advisors, history and the money Why → derived.mood. */
export function stepRecords(t: TownState, m: MonthContext): void {
  const p = m.params;
  const sp = p.stars;
  const cv = p.civic;
  const memo = civicMemo(t);
  const d = m.derived;
  const stars = d.stars;
  const needs = d.needs ?? neutral.needs();
  const n = cohortsOf(t);
  const N = population(t);

  let mood = 0;
  if (N > 0) {
    for (let k = 0; k < COHORT_COUNT; k++) mood += n[k] * t.happy[k];
    mood /= N;
  } else {
    for (let k = 0; k < COHORT_COUNT; k++) mood += t.happy[k];
    mood /= COHORT_COUNT;
  }
  memo.mood = mood;

  // Approval (τ 6, A13): Mood, the next tier's checklist (not counting approval itself) and the direct tax term.
  const facts = checkFacts(t, m);
  const pre = judgeChecklist(t, facts);
  const aMood = cv.approvalMood * mood;
  const aCheck = cv.approvalChecklist * (100 - cv.approvalPerUnmet * pre.unmetOthers);
  const aTax = -cv.approvalTaxSlope * (Math.max(0, meanHomesTax(t) - cv.approvalTaxFree) / 100);
  t.approval = clamp(smooth(t.approval, clamp(aMood + aCheck + aTax, 0, 100), sp.approvalTau), 0, 100);
  m.why.set('approval', t.approval);
  m.why.add('approval.mood', aMood);
  m.why.add('approval.checklist', aCheck);
  m.why.add('approval.tax', aTax);
  facts.approval = t.approval;
  const check = judgeChecklist(t, facts);
  memo.check = { tier: check.tier, met: check.met, items: check.items };

  // Town Talk.
  const actual = stars ? stars.actual : t.perceived;
  const talk = talkSeverities(t, m, actual);
  memo.talk = townTalk(talk.keys, talk.sev, cv.talkTop);

  // Wants bubbles: severity × group size, at most three.
  const u = d.utilities ?? neutral.utilities();
  const cand: { key: string; severity: number }[] = [];
  const want = (key: string, meter: number) => {
    if (meter > p.meters.wantAt) cand.push({ key, severity: ((meter - p.meters.wantAt) / (100 - p.meters.wantAt)) * N });
  };
  want('homes', Math.max(t.meters[0], t.meters[1], t.meters[2]));
  want('shops', t.meters[METER_SHOPS]);
  want('factories', t.meters[METER_INDUSTRY]);
  want('offices', t.meters[METER_OFFICES]);
  want('hotels', t.meters[METER_LEISURE]);
  const talkTop = talk.keys.map((_, i) => i).filter((i) => talk.sev[i] > 0).sort((a, b) => talk.sev[b] - talk.sev[a] || a - b);
  for (const i of talkTop.slice(0, cv.talkTop)) cand.push({ key: `talk.${talk.keys[i]}`, severity: talk.sev[i] });
  for (let h = 0; h < 3; h++) {
    const persons = t.people[h] + t.people[3 + h] + t.people[6 + h] + t.people[9 + h];
    if ((needs.unmet[h] ?? 0) > 0 && persons > 0) cand.push({ key: `needs.${h}`, severity: (1 - (needs.tier[h] ?? 1)) * persons });
  }
  if (u.poweredShare < 1) cand.push({ key: 'power', severity: (1 - u.poweredShare) * N });
  if (u.wateredShare < 1) cand.push({ key: 'water', severity: (1 - u.wateredShare) * N });
  const ranked = cand.map((c, i) => ({ c, i })).filter((x) => x.c.severity > 0 && Number.isFinite(x.c.severity));
  ranked.sort((a, b) => b.c.severity - a.c.severity || a.i - b.i);
  memo.wants = ranked.slice(0, cv.wantsMax).map((x) => x.c);

  // Advisor cards.
  memo.advisors = selectAdvisors(advisorFacts(t, m, mood, check), t.tier, 3);

  const slot: MoodSlot = { mood, faces: facesOf(t), townTalk: memo.talk.map(([k, v]) => [k, v]), wants: memo.wants.map((w) => ({ ...w })), advisors: [...memo.advisors] };
  d.mood = slot;

  // The money Why: every ledger line this month is a term of revenue or spending.
  let revenue = 0;
  let spending = 0;
  LEDGER_LINES.forEach((l, i) => {
    const v = t.books.lines[i];
    if (v === 0) return;
    m.why.add(`money.${l}`, v);
    if (v > 0) revenue += v;
    else spending += v;
  });
  m.why.set('revenue', revenue);
  m.why.set('spending', spending);

  // The month's history sample.
  const lab = d.labour ?? neutral.labour();
  const tour = d.tourism ?? neutral.tourism();
  const goods = d.goods ?? neutral.goods();
  pushHistoryMonth(t, {
    pop: N,
    reserves: t.money.reserves,
    revenue: memo.revenue,
    spending: memo.spending,
    mood,
    approval: t.approval,
    jobs: (lab.jobSlots[0] ?? 0) + (lab.jobSlots[1] ?? 0) + (lab.jobSlots[2] ?? 0),
    unemployed: (lab.unemployed[0] ?? 0) + (lab.unemployed[1] ?? 0) + (lab.unemployed[2] ?? 0),
    visitors: tour.stays + tour.dayTrips,
    goodsNet: (goods.production[0] ?? 0) - (goods.localUse[0] ?? 0),
    meterHomes: Math.max(t.meters[0], t.meters[1], t.meters[2]),
    meterShops: t.meters[METER_SHOPS],
    meterIndustry: t.meters[METER_INDUSTRY],
    safety: d.fields ? d.fields.safety : 0,
  });
}

/** The facts the advisor rules test (advisors.ts). */
function advisorFacts(t: TownState, m: MonthContext, mood: number, check: { met: number; items: number }): AdvisorFacts {
  const d = m.derived;
  const memo = civicMemo(t);
  const stars = d.stars ? d.stars.actual : t.perceived;
  const lab = d.labour ?? neutral.labour();
  const u = d.utilities ?? neutral.utilities();
  const c = d.coverage;
  const tour = d.tourism ?? neutral.tourism();
  const tv = d.travel ?? neutral.travel();
  const needs = d.needs ?? neutral.needs();
  const hs = d.housing ?? neutral.housing();
  const N = Math.max(1, population(t));
  const workforce = Math.max(1, lab.workforce[0] + lab.workforce[1] + lab.workforce[2]);
  const missing = check.items - popcount(check.met);
  const tier = Math.min(4, t.tier + 1);
  const beds = tour.beds * m.params.tourism.staysPerBed;
  return {
    monthsReserve: monthsOfSpending(t),
    netShare: (memo.revenue - memo.spending) / Math.max(1, memo.spending),
    helper: t.money.helper ? 1 : 0,
    dsr: debtService(t) / Math.max(1, memo.revenue),
    rating: t.money.rating,
    loanRoom: t.tier >= 2 && !t.money.loan && memo.revenue > 0 ? 1 : 0,
    homesTax: meanHomesTax(t) / 100,
    businessTax: t.taxes.business / 100,
    unemployment: (lab.unemployed[0] + lab.unemployed[1] + lab.unemployed[2]) / workforce,
    homesMeter: Math.max(t.meters[0], t.meters[1], t.meters[2]),
    squeezedShare: hs.squeezed / N,
    unmetNeeds: Math.max(needs.unmet[0] ?? 0, needs.unmet[1] ?? 0, needs.unmet[2] ?? 0),
    starJobs: stars[star('jobs')],
    starHomes: stars[star('homes')],
    starSchools: stars[star('schools')],
    starHealth: stars[star('health')],
    starSafety: stars[star('safety')],
    starTax: stars[star('tax')],
    primarySeats: c && c.pupils.primary > 0 ? c.seats.primary / c.pupils.primary : 1,
    secondarySeats: c && c.pupils.secondary > 0 ? c.seats.secondary / c.pupils.secondary : 1,
    approval: t.approval,
    mood,
    starFun: stars[star('fun')],
    starCulture: stars[star('culture')],
    starNature: stars[star('nature')],
    starBuzz: stars[star('buzz')],
    visitorRatio: tour.visitorRatio,
    bedShortfall: Math.max(0, (t.marketMemo?.bedDemand ?? 0) - beds),
    satisfaction: tour.stays + tour.dayTrips > 0 ? tour.satisfaction : 100,
    leisureMeter: t.meters[METER_LEISURE],
    shopsMeter: t.meters[METER_SHOPS],
    industryMeter: t.meters[METER_INDUSTRY],
    officesMeter: t.meters[METER_OFFICES],
    farmsMeter: t.meters[METER_FARMS],
    unpowered: 1 - u.poweredShare,
    dry: 1 - u.wateredShare,
    cutShare: u.cutTiles / Math.max(1, d.development ? d.development.built.reduce((a, b) => a + b, 0) : 0),
    congestion: tv.congestion,
    pollution: d.fields ? d.fields.pollutionPop : 0,
    starAround: stars[star('around')],
    checklistLeft: t.tier >= 4 ? 0 : missing,
    // "Almost there" (§9.7): the people are nearly in place and only a few checklist items stand in the
    // way. With one item only, a town short of two (often fire and police cover) had no card at all,
    // so a child following the cards never saw what its next tier needed.
    checklistNear: t.tier < 4 && missing >= 1 && missing <= 3 && population(t) >= 0.8 * TIER_DEFS[tier].population ? 1 : 0,
    struggling: memo.struggling ? 1 : 0,
    pop: N,
  } satisfies AdvisorFacts;
}

function popcount(x: number): number {
  let n = 0;
  for (let v = x; v; v &= v - 1) n++;
  return n;
}
