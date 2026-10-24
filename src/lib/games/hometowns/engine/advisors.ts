// The advisors' rule bank (WP2d, spec §9.7): data only. Bramble the badger
// (the Deputy: roads, utilities, growth, Helper Mode), Penny the magpie
// (money), Mo the hedgehog (people) and Zia the otter (fun, culture, nature,
// visitors). Each rule names one town fact, a threshold and a span: its
// severity is how far past the threshold the fact is, as a share of the span
// (0–1). M14 ranks the firing rules by priority × severity (ties by bank
// order) and keeps the top few ids; the page applies the per-session limits
// (3 cards, nothing repeated within 24 hours, novelty). The words live in
// copy (WP8): each rule has `advisor.<id>.kid` and `advisor.<id>.adult`.
//
// Problems are phrased as wants ("Families would love…"), never as fear, so
// the bank has no rule for anything a child cannot act on.

/** The facts a rule can test (computed in mood.ts from the month's blackboard). */
export const ADVISOR_FACTS = [
  // money (Penny)
  'monthsReserve', 'netShare', 'helper', 'dsr', 'rating', 'loanRoom', 'homesTax', 'businessTax',
  // people (Mo)
  'unemployment', 'homesMeter', 'squeezedShare', 'unmetNeeds', 'starJobs', 'starHomes', 'starSchools', 'starHealth', 'starSafety', 'starTax',
  'primarySeats', 'secondarySeats', 'approval', 'mood',
  // place (Zia)
  'starFun', 'starCulture', 'starNature', 'starBuzz', 'visitorRatio', 'bedShortfall', 'satisfaction', 'leisureMeter',
  // growth and services (Bramble)
  'shopsMeter', 'industryMeter', 'officesMeter', 'farmsMeter', 'unpowered', 'dry', 'cutShare', 'congestion', 'pollution', 'starAround',
  'checklistLeft', 'checklistNear', 'struggling', 'pop',
] as const;
export type AdvisorFact = (typeof ADVISOR_FACTS)[number];
export type AdvisorFacts = Record<AdvisorFact, number>;

export type Advisor = 'bramble' | 'penny' | 'mo' | 'zia';

export interface AdvisorRule {
  id: string;
  advisor: Advisor;
  fact: AdvisorFact;
  /** Fires when the fact is above this (or below `below`); severity grows over `span`. */
  above?: number;
  below?: number;
  span: number;
  /** 1 (nice to know) … 5 (do this first). */
  priority: number;
  /** Hours before the same card may show again (§9.7: nothing repeats within 24 hours). */
  cooldownHours: number;
  /** Lowest town tier the advice makes sense at. */
  minTier: number;
  /** The deep link its one button opens: a ghost plan, a sheet or a lens. */
  action: string;
}

const r = (id: string, advisor: Advisor, fact: AdvisorFact, test: { above?: number; below?: number }, span: number, priority: number, action: string, minTier = 0): AdvisorRule => ({
  id, advisor, fact, ...test, span, priority, cooldownHours: 24, minTier, action,
});

export const ADVISOR_RULES: readonly AdvisorRule[] = [
  // Penny: money, taxes, trade, rating.
  r('penny.reservesLow', 'penny', 'monthsReserve', { below: 1 }, 1, 5, 'sheet:budget'),
  r('penny.deficit', 'penny', 'netShare', { below: -0.05 }, 0.3, 4, 'sheet:budget'),
  r('penny.helper', 'penny', 'helper', { above: 0.5 }, 0.5, 5, 'sheet:helper'),
  r('penny.debtHeavy', 'penny', 'dsr', { above: 0.18 }, 0.1, 4, 'sheet:borrowing', 2),
  r('penny.ratingLow', 'penny', 'rating', { above: 3.5 }, 1.5, 3, 'sheet:borrowing', 3),
  r('penny.loanForBuilding', 'penny', 'loanRoom', { above: 0.5 }, 0.5, 1, 'sheet:borrowing', 2),
  r('penny.surplus', 'penny', 'monthsReserve', { above: 6 }, 6, 2, 'build:menu'),
  r('penny.taxHigh', 'penny', 'homesTax', { above: 12 }, 6, 3, 'sheet:budget'),
  r('penny.businessTaxHigh', 'penny', 'businessTax', { above: 7 }, 5, 2, 'sheet:budget', 1),
  r('penny.factoriesPay', 'penny', 'industryMeter', { above: 50 }, 50, 2, 'zone:industry'),
  // Mo: homes, jobs, schools, health, safety, migration.
  r('mo.jobsWanted', 'mo', 'unemployment', { above: 0.08 }, 0.15, 4, 'zone:shops'),
  r('mo.homesWanted', 'mo', 'homesMeter', { above: 35 }, 65, 4, 'zone:homes'),
  r('mo.squeezed', 'mo', 'squeezedShare', { above: 0.03 }, 0.1, 4, 'zone:homes'),
  r('mo.needs', 'mo', 'unmetNeeds', { above: 1.5 }, 4, 3, 'sheet:wants'),
  r('mo.schools', 'mo', 'starSchools', { below: 45 }, 40, 4, 'build:school'),
  r('mo.primarySeats', 'mo', 'primarySeats', { below: 0.8 }, 0.5, 4, 'build:primarySchool', 2),
  r('mo.secondarySeats', 'mo', 'secondarySeats', { below: 0.75 }, 0.5, 3, 'build:secondarySchool', 2),
  r('mo.health', 'mo', 'starHealth', { below: 45 }, 40, 3, 'build:health', 1),
  r('mo.safety', 'mo', 'starSafety', { below: 50 }, 40, 3, 'build:police', 1),
  r('mo.homesStar', 'mo', 'starHomes', { below: 40 }, 40, 3, 'lens:homes'),
  r('mo.jobsStar', 'mo', 'starJobs', { below: 40 }, 40, 3, 'lens:jobs'),
  r('mo.taxStar', 'mo', 'starTax', { below: 35 }, 35, 2, 'sheet:budget'),
  r('mo.unhappy', 'mo', 'mood', { below: 45 }, 30, 4, 'sheet:talk'),
  r('mo.approval', 'mo', 'approval', { below: 50 }, 30, 3, 'sheet:talk', 1),
  // Zia: fun, culture, nature, visitors.
  r('zia.fun', 'zia', 'starFun', { below: 45 }, 40, 3, 'build:park'),
  r('zia.culture', 'zia', 'starCulture', { below: 30 }, 30, 2, 'build:culture', 1),
  r('zia.nature', 'zia', 'starNature', { below: 45 }, 40, 2, 'build:park'),
  r('zia.buzz', 'zia', 'starBuzz', { below: 35 }, 35, 1, 'build:attraction', 2),
  r('zia.hotels', 'zia', 'bedShortfall', { above: 50 }, 500, 3, 'zone:leisure', 2),
  r('zia.crowded', 'zia', 'visitorRatio', { above: 0.5 }, 0.4, 3, 'build:attraction', 2),
  r('zia.visitorsUnhappy', 'zia', 'satisfaction', { below: 50 }, 30, 2, 'build:attraction', 2),
  r('zia.leisure', 'zia', 'leisureMeter', { above: 40 }, 60, 2, 'zone:leisure', 2),
  // Bramble: roads, utilities, growth, the checklist.
  r('bramble.power', 'bramble', 'unpowered', { above: 0.05 }, 0.4, 5, 'build:power'),
  r('bramble.water', 'bramble', 'dry', { above: 0.05 }, 0.4, 5, 'build:water'),
  r('bramble.brownout', 'bramble', 'cutShare', { above: 0.01 }, 0.2, 4, 'build:power'),
  r('bramble.shops', 'bramble', 'shopsMeter', { above: 35 }, 65, 3, 'zone:shops'),
  r('bramble.offices', 'bramble', 'officesMeter', { above: 35 }, 65, 2, 'zone:offices', 2),
  r('bramble.farms', 'bramble', 'farmsMeter', { above: 35 }, 65, 2, 'zone:farms'),
  r('bramble.traffic', 'bramble', 'congestion', { above: 0.15 }, 0.35, 3, 'build:avenue', 2),
  r('bramble.commutes', 'bramble', 'starAround', { below: 45 }, 40, 2, 'lens:traffic', 1),
  r('bramble.pollution', 'bramble', 'pollution', { above: 40 }, 40, 3, 'lens:pollution'),
  r('bramble.almostThere', 'bramble', 'checklistNear', { above: 0.5 }, 0.5, 4, 'sheet:growth'),
  r('bramble.checklist', 'bramble', 'checklistLeft', { above: 2.5 }, 4, 1, 'sheet:growth'),
  r('bramble.struggling', 'bramble', 'struggling', { above: 0.5 }, 0.5, 4, 'sheet:recover'),
];

/** A rule's severity for these facts, 0 when it does not fire. */
export function ruleSeverity(rule: AdvisorRule, f: AdvisorFacts, tier: number): number {
  if (tier < rule.minTier) return 0;
  const v = f[rule.fact];
  if (!Number.isFinite(v)) return 0;
  let x = 0;
  if (rule.above !== undefined && v > rule.above) x = (v - rule.above) / rule.span;
  else if (rule.below !== undefined && v < rule.below) x = (rule.below - v) / rule.span;
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** The firing rules' ids, ranked by priority × severity (ties by bank order), at most `n`. */
export function selectAdvisors(f: AdvisorFacts, tier: number, n: number): string[] {
  const scored: [number, number][] = [];
  ADVISOR_RULES.forEach((rule, i) => {
    const s = ruleSeverity(rule, f, tier);
    if (s > 0) scored.push([rule.priority * s, i]);
  });
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return scored.slice(0, n).map(([, i]) => ADVISOR_RULES[i].id);
}

/** Copy keys every rule needs (WP8's checklist). */
export function advisorCopyKeys(): string[] {
  const out: string[] = [];
  for (const rule of ADVISOR_RULES) out.push(`advisor.${rule.id}.kid`, `advisor.${rule.id}.adult`);
  return out;
}
