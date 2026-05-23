// V4 default scenarios — 10 DfE data sources, all starting 1 Jan 2020,
// merging into the spine between Apr 2025 and Apr 2031. Each source carries
// its own *distinct* schema (the central scenario-planning premise: these
// datasets share nothing structurally — the convergence is the hard work).

import type { StrandConfig, OutputConfig, Scenario, ScenarioStore } from './types';
import { newId } from './storage';

const T0 = '2020-01-01';

const COL = {
  attendance:    '#c0392b',
  schoolCensus:  '#e67e22',
  phonics:       '#f1c40f',
  ks2:           '#d35400',
  ks4:           '#8e44ad',
  alevel:        '#9b59b6',
  hesa:          '#2980b9',
  apprentice:    '#16a085',
  adultSkills:   '#27ae60',
  laCare:        '#34495e',
};

export const BASELINE_STRANDS: StrandConfig[] = [
  {
    id: 'attendance', name: 'Pupil attendance',
    colour: COL.attendance, startDate: T0, mergeDate: '2025-04-01',
    mergeInto: 'spine', users: 820, cadence: 'daily', visible: true,
    outputs: ['out-perf-tables', 'out-pupil-premium', 'out-regional-dashboard'],
    schema: ['pupilUPN', 'urn', 'sessionDate', 'amPmCode', 'attendanceCode', 'minutesLate'],
  },
  {
    id: 'school-census', name: 'School Census',
    colour: COL.schoolCensus, startDate: T0, mergeDate: '2025-10-01',
    mergeInto: 'spine', users: 620, cadence: 'termly', visible: true,
    outputs: ['out-perf-tables', 'out-pupil-premium', 'out-statistical-release', 'out-regional-dashboard'],
    schema: ['urn', 'collectionTerm', 'pupilUPN', 'fsmEligible', 'eal', 'sen', 'ethnicityCode', 'postcode'],
  },
  {
    id: 'phonics', name: 'Phonics screening (Y1)',
    colour: COL.phonics, startDate: T0, mergeDate: '2026-04-01',
    mergeInto: 'spine', users: 160, cadence: 'annual', visible: true,
    outputs: ['out-statistical-release'],
    schema: ['pupilUPN', 'yearGroup', 'screeningDate', 'score', 'metStandard', 'retake'],
  },
  {
    id: 'ks2', name: 'KS2 SATs (Y6)',
    colour: COL.ks2, startDate: T0, mergeDate: '2026-10-01',
    mergeInto: 'spine', users: 340, cadence: 'annual', visible: true,
    outputs: ['out-perf-tables', 'out-statistical-release', 'out-regional-dashboard'],
    schema: ['pupilUPN', 'urn', 'testYear', 'readingScaled', 'mathsScaled', 'gpsScaled', 'writingTA'],
  },
  {
    id: 'ks4', name: 'KS4 / GCSE results',
    colour: COL.ks4, startDate: T0, mergeDate: '2027-04-01',
    mergeInto: 'spine', users: 470, cadence: 'annual', visible: true,
    outputs: ['out-perf-tables', 'out-ebacc', 'out-statistical-release', 'out-regional-dashboard'],
    schema: ['pupilUPN', 'urn', 'subjectCode', 'tier', 'grade', 'p8Slot', 'a8Score', 'ebaccElig'],
  },
  {
    id: 'alevels', name: 'A-Level / T-Level results',
    colour: COL.alevel, startDate: T0, mergeDate: '2027-10-01',
    mergeInto: 'spine', users: 290, cadence: 'annual', visible: true,
    outputs: ['out-perf-tables', 'out-ebacc', 'out-skills-funding', 'out-statistical-release'],
    schema: ['learnerRef', 'providerUKPRN', 'subjectCode', 'qualType', 'grade', 'completionDate'],
  },
  {
    id: 'hesa', name: 'HESA student record',
    colour: COL.hesa, startDate: T0, mergeDate: '2028-04-01',
    mergeInto: 'spine', users: 360, cadence: 'annual', visible: true,
    outputs: ['out-statistical-release', 'out-skills-funding'],
    schema: ['hesaId', 'providerCode', 'courseCode', 'level', 'mode', 'fundingSource', 'domicile', 'continuation'],
  },
  {
    id: 'apprenticeships', name: 'Apprenticeships data',
    colour: COL.apprentice, startDate: T0, mergeDate: '2029-04-01',
    mergeInto: 'spine', users: 230, cadence: 'termly', visible: true,
    outputs: ['out-skills-funding', 'out-statistical-release', 'out-regional-dashboard'],
    schema: ['learnerRef', 'employerEdrs', 'standardCode', 'level', 'startDate', 'plannedEndDate', 'priceCap'],
  },
  {
    id: 'adult-skills', name: 'Adult learning records',
    colour: COL.adultSkills, startDate: T0, mergeDate: '2030-04-01',
    mergeInto: 'spine', users: 140, cadence: 'adhoc', visible: true,
    outputs: ['out-skills-funding', 'out-statistical-release'],
    schema: ['learnerRef', 'providerUKPRN', 'learningAimRef', 'fundingModel', 'startDate', 'outcome'],
  },
  {
    id: 'la-csc', name: 'LA children’s social care',
    colour: COL.laCare, startDate: T0, mergeDate: '2031-04-01',
    mergeInto: 'spine', users: 410, cadence: 'biannual', visible: true,
    outputs: ['out-safeguarding', 'out-statistical-release'],
    schema: ['cinReference', 'laCode', 'category', 'referralDate', 'planStartDate', 'reviewDate', 'closureReason'],
  },
];

export const BASELINE_OUTPUTS: OutputConfig[] = [
  { id: 'out-perf-tables',         name: 'School performance tables',   colour: '#c0392b', side: 'above', visible: true },
  { id: 'out-pupil-premium',       name: 'Pupil Premium funding',       colour: '#e67e22', side: 'below', visible: true },
  { id: 'out-ebacc',               name: 'EBacc analysis',              colour: '#8e44ad', side: 'above', visible: true },
  { id: 'out-skills-funding',      name: 'Skills funding allocations',  colour: '#16a085', side: 'below', visible: true },
  { id: 'out-safeguarding',        name: 'Safeguarding casework',       colour: '#34495e', side: 'below', visible: true },
  { id: 'out-statistical-release', name: 'Statistical First Release',   colour: '#2980b9', side: 'above', visible: true },
  { id: 'out-regional-dashboard',  name: 'Regional outcomes dashboard', colour: '#27ae60', side: 'below', visible: true },
];

/** Builder: produce a fresh Scenario from a name/description/strands/outputs. */
export function buildScenario(name: string, description: string | undefined, strands: StrandConfig[], outputs: OutputConfig[]): Scenario {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name,
    description,
    strands: deepClone(strands),
    outputs: deepClone(outputs),
    createdAt: now,
    updatedAt: now,
  };
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Default store — one baseline scenario plus a "delayed merge" variant so
 *  users can immediately see scenario-comparison value. */
export function defaultStore(): ScenarioStore {
  const baseline = buildScenario(
    'Baseline',
    'As-is plan: attendance lands April 2025, full convergence by 2031.',
    BASELINE_STRANDS,
    BASELINE_OUTPUTS,
  );

  // "Accelerated" — everything merges two years earlier than baseline.
  const accelStrands = BASELINE_STRANDS.map((s) => ({
    ...s,
    mergeDate: shiftIso(s.mergeDate, -730),
  }));
  const accelerated = buildScenario(
    'Accelerated',
    'What if convergence finishes by 2029? Every merge brought forward 24 months.',
    accelStrands,
    BASELINE_OUTPUTS,
  );

  // "Schools-only" — drop FE/HE/adult sources entirely.
  const schoolsOnlyStrands = BASELINE_STRANDS.filter((s) => !['alevels', 'hesa', 'apprenticeships', 'adult-skills'].includes(s.id));
  const schoolsOnlyOutputs = BASELINE_OUTPUTS.filter((o) => o.id !== 'out-skills-funding');
  // Repoint any outputs that lost their only source.
  for (const s of schoolsOnlyStrands) {
    if (s.outputs) s.outputs = s.outputs.filter((oid) => schoolsOnlyOutputs.some((o) => o.id === oid));
  }
  const schoolsOnly = buildScenario(
    'Schools-only',
    'Scope reduced to school-age data (4-16). FE, HE, apprenticeships and adult skills removed.',
    schoolsOnlyStrands,
    schoolsOnlyOutputs,
  );

  return {
    activeId: baseline.id,
    scenarios: [baseline, accelerated, schoolsOnly],
  };
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Legacy exports kept for older imports that still reach in.
export const DEFAULT_CONFIG = BASELINE_STRANDS;
export const DEFAULT_OUTPUTS = BASELINE_OUTPUTS;

/** Add-source templates — pre-filled for the user. */
export const STRAND_TEMPLATES: Array<{
  label: string;
  description: string;
  pattern: Omit<StrandConfig, 'id' | 'name' | 'colour'>;
}> = [
  {
    label: 'Daily transactional',
    description: 'High-volume, daily-cadence source like attendance or telemetry.',
    pattern: {
      startDate: T0, mergeDate: '2027-01-01', mergeInto: 'spine',
      users: 600, cadence: 'daily', visible: true,
      schema: ['recordId', 'subjectId', 'eventDate', 'eventCode', 'value'],
    },
  },
  {
    label: 'Termly snapshot',
    description: 'A census-style snapshot collected three times a year.',
    pattern: {
      startDate: T0, mergeDate: '2027-01-01', mergeInto: 'spine',
      users: 320, cadence: 'termly', visible: true,
      schema: ['recordId', 'subjectId', 'term', 'snapshotDate', 'fields…'],
    },
  },
  {
    label: 'Annual assessment',
    description: 'Once-a-year results dataset (e.g. an exam outcome).',
    pattern: {
      startDate: T0, mergeDate: '2027-01-01', mergeInto: 'spine',
      users: 280, cadence: 'annual', visible: true,
      schema: ['candidateRef', 'subject', 'tier', 'grade', 'awardDate'],
    },
  },
  {
    label: 'Ad-hoc / event-driven',
    description: 'Irregular but ongoing — referrals, incidents, registrations.',
    pattern: {
      startDate: T0, mergeDate: '2027-01-01', mergeInto: 'spine',
      users: 180, cadence: 'adhoc', visible: true,
      schema: ['caseRef', 'subjectId', 'eventDate', 'category', 'outcome'],
    },
  },
];
