// plan.ts — the Plan tab's pure engine: a measures library grounded in real the department
// collections and statistics, plus suggesters that seed the roadmap from the
// commitments' statutory deadlines and the risk register from coverage gaps and
// workbench tensions. Everything editable by the writer; nothing invented at runtime.

import { MUST_ANSWER, DOCUMENTS_BY_ID } from '../commitments';
import type { Tension } from '../types';
import type { CoverageResult } from './coverage';
import type { Milestone, Risk } from './authorState.svelte';

export interface MeasureDef {
  id: string;
  name: string;
  kind: 'strategy-health' | 'estate' | 'outcome';
  source: string;
  note: string;
}

/** Measures an education data strategy could hold itself to — grouped by what they measure. */
export const MEASURE_LIBRARY: MeasureDef[] = [
  // strategy-health: measures OF the strategy itself
  { id: 'dma-score', name: 'Data Maturity Assessment score', kind: 'strategy-health', source: 'DMA for Government self-assessment', note: 'The government-standard maturity baseline — rerun annually, publish the trajectory.' },
  { id: 'quality-slas', name: 'Critical datasets meeting quality SLAs', kind: 'strategy-health', source: 'Internal data-quality dashboard (Government Data Quality Framework)', note: 'Share of the named critical datasets meeting their accuracy/completeness/timeliness SLA.' },
  { id: 'time-to-dsa', name: 'Time from request to signed data-sharing agreement', kind: 'strategy-health', source: 'Internal information-governance pipeline', note: 'The single best proxy for whether governance enables or blocks.' },
  { id: 'collection-burden', name: 'Data-collection burden hours on schools', kind: 'strategy-health', source: 'The department data-burden assessments', note: 'The sector feels the strategy here first — count hours, publish the trend.' },
  { id: 'api-adoption', name: 'Services consuming the department APIs', kind: 'strategy-health', source: 'The department API platform telemetry', note: 'Adoption of API-first access over bespoke extracts.' },
  { id: 'catalogue-coverage', name: 'Data assets catalogued with named owners', kind: 'strategy-health', source: 'Departmental data catalogue', note: 'Ownership and findability made countable.' },
  { id: 'atrs-entries', name: 'Algorithmic tools with published ATRS records', kind: 'strategy-health', source: 'Algorithmic Transparency Recording Standard register', note: 'The transparency bar for every algorithmic tool touching children\'s data.' },
  { id: 'identifier-match-rate', name: 'Cross-dataset identifier match rate', kind: 'strategy-health', source: 'Matching service telemetry', note: 'Whether the identifier layer actually joins records first time.' },
  { id: 'research-access-time', name: 'Time from research request to safe data access', kind: 'strategy-health', source: 'ONS SRS / IDS request pipeline', note: 'The research-ecosystem promise, measured.' },
  { id: 'duplicate-collections', name: 'Collections consolidated or retired', kind: 'strategy-health', source: 'Collections register', note: 'Collect once, use many times — proven by retirement, not assertion.' },
  { id: 'data-profession-fill', name: 'Data profession posts filled', kind: 'strategy-health', source: 'Workforce planning data', note: 'Capability on paper vs seats actually filled.' },
  { id: 'staff-literacy', name: 'Staff completing data-literacy training', kind: 'strategy-health', source: 'Internal L&D records', note: 'The culture shift, counted.' },
  // estate: measures of the data estate the strategy runs on
  { id: 'attendance-feed-coverage', name: 'Schools on the daily attendance feed', kind: 'estate', source: 'The department attendance data (statutory since Sept 2024)', note: 'The model for API-first collection — keep coverage near-universal.' },
  { id: 'ees-usage', name: 'Explore Education Statistics API usage', kind: 'estate', source: 'EES platform telemetry', note: 'Open-data reuse in practice.' },
  { id: 'gias-accuracy', name: 'GIAS record accuracy rate', kind: 'estate', source: 'Get Information about Schools', note: 'The register everything else joins to.' },
  { id: 'cnis-register-flow', name: 'LAs returning children-not-in-school data', kind: 'estate', source: 'CWSA 2026 registers (when commenced)', note: 'A brand-new statutory flow — track onboarding from day one.' },
  { id: 'sui-rollout', name: 'Records carrying the consistent identifier', kind: 'estate', source: 'Single unique identifier programme', note: 'The spine\'s reach across the estate.' },
  { id: 'school-profiles-live', name: 'Schools with a live digital profile', kind: 'estate', source: 'The department school profiles service', note: 'The accountability surface promised by the Schools White Paper.' },
  // outcome: the sector outcomes better data is meant to serve
  { id: 'attendance-rate', name: 'Pupil attendance rate', kind: 'outcome', source: 'EES: pupil attendance in schools', note: 'The White Paper\'s 94% ambition — data-enabled, not data-delivered.' },
  { id: 'eyfsp-gld', name: 'Good level of development at age 5', kind: 'outcome', source: 'EES: early years foundation stage profile', note: 'The Plan for Change school-readiness milestone (75% by 2028).' },
  { id: 'ks2-rwm', name: 'KS2 reading, writing & maths combined', kind: 'outcome', source: 'EES: key stage 2 attainment', note: 'Core attainment series.' },
  { id: 'attainment8', name: 'Attainment 8 / Progress 8', kind: 'outcome', source: 'EES: key stage 4 performance', note: 'Secondary attainment; measure changing from 2029 GCSEs.' },
  { id: 'ehcp-timeliness', name: 'EHC plans issued within 20 weeks', kind: 'outcome', source: 'EES: SEN2 census', note: 'The SEND system\'s most-watched data point.' },
  { id: 'neet-rate', name: '16-18 NEET rate', kind: 'outcome', source: 'EES: NEET statistics / participation', note: 'The youth-guarantee target population.' },
  { id: 'cin-rereferral', name: 'Children in need re-referral rate', kind: 'outcome', source: 'EES: children in need census', note: 'Multi-agency sharing should show up here.' },
  { id: 'persistent-absence', name: 'Persistent absence rate', kind: 'outcome', source: 'EES: pupil absence in schools', note: 'Where daily attendance data earns its keep.' },
  { id: 'teacher-vacancies', name: 'Teacher vacancy rate', kind: 'outcome', source: 'EES: school workforce census', note: 'Workforce planning depends on this estate.' },
  { id: 'fsm-takeup', name: 'FSM eligibility & take-up', kind: 'outcome', source: 'EES: schools, pupils and their characteristics', note: 'Auto-enrolment and the UC expansion make this a data-quality story.' },
  { id: 'apprenticeship-achievement', name: 'Apprenticeship achievement rate', kind: 'outcome', source: 'EES: apprenticeships and traineeships', note: 'Skills England\'s evidence base.' },
  { id: 'care-leaver-destinations', name: 'Care leavers in education, employment or training', kind: 'outcome', source: 'EES: children looked after by LAs', note: 'The corporate-parenting measure joined data can improve.' },
  { id: 'leo-earnings', name: 'Graduate earnings (LEO)', kind: 'outcome', source: 'EES: LEO graduate outcomes', note: 'The flagship linked-data product — protect and extend it.' },
];

export const MEASURE_BY_ID: Record<string, MeasureDef> = Object.fromEntries(MEASURE_LIBRARY.map((m) => [m.id, m]));

/** '2026-09' → '2026-Q3'; clamps rubbish to null. */
export function dateToQuarter(ym: string | undefined): string | null {
  if (!ym) return null;
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const q = Math.min(4, Math.max(1, Math.ceil(parseInt(m[2], 10) / 3)));
  return `${m[1]}-Q${q}`;
}

/** Seed roadmap milestones from the commitments' own deadlines (earliest first). */
export function suggestMilestones(existing: Milestone[]): Omit<Milestone, 'id'>[] {
  const have = new Set(existing.map((m) => m.commitmentId).filter(Boolean));
  return MUST_ANSWER.filter((c) => c.timeframeDate && !have.has(c.id))
    .sort((a, b) => (a.timeframeDate! < b.timeframeDate! ? -1 : 1))
    .slice(0, 12)
    .map((c) => ({
      title: `Ready for: ${c.title} (${DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId})`,
      quarter: dateToQuarter(c.timeframeDate) ?? '2027-Q1',
      owner: '',
      commitmentId: c.id,
      sectionId: 'delivery-roadmap',
    }));
}

/** Seed the risk register from statutory coverage gaps + the workbench's live tensions. */
export function suggestRisks(coverage: CoverageResult, tensions: Tension[], existing: Risk[]): Omit<Risk, 'id'>[] {
  const have = new Set(existing.map((r) => r.title));
  const out: Omit<Risk, 'id'>[] = [];
  for (const g of coverage.statutoryGaps.slice(0, 6)) {
    const c = MUST_ANSWER.find((m) => m.id === g.id);
    if (!c) continue;
    const title = `Statutory obligation unplanned: ${c.title}`;
    if (have.has(title)) continue;
    out.push({
      title,
      likelihood: 4,
      impact: 5,
      mitigation: `Name an owner and a delivery route for “${c.title}” (${c.timeframe ?? 'no date yet'}) in the roadmap; reflect it in the ${c.capabilityIds.join(' + ')} sections.`,
      sectionId: 'delivery-roadmap',
    });
  }
  for (const t of tensions.slice(0, 5)) {
    const title = `Strategy tension: ${t.title}`;
    if (have.has(title)) continue;
    out.push({
      title,
      likelihood: t.severity === 'high' ? 4 : t.severity === 'medium' ? 3 : 2,
      impact: t.severity === 'high' ? 4 : 3,
      mitigation: t.resolution,
    });
  }
  return out.slice(0, 10);
}

/** The quarters the roadmap grid shows. */
export function quarterRange(milestones: Milestone[]): string[] {
  const base: string[] = [];
  for (let y = 2026; y <= 2029; y++) for (let q = 1; q <= 4; q++) base.push(`${y}-Q${q}`);
  const extra = milestones.map((m) => m.quarter).filter((q) => /^\d{4}-Q[1-4]$/.test(q) && !base.includes(q));
  return [...new Set([...base, ...extra])].sort().filter((q) => q >= '2026-Q3');
}
