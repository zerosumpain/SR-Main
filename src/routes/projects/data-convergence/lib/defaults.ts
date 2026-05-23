// V3 scene — 10 Department for Education data sources, all starting on
// 1st Jan 2020, none merging into the spine until 2025 (attendance first),
// then staggered through the next five years.
//
// Volumes are deliberately spread so the visual width differences read at a
// glance.

import type { StrandConfig, OutputConfig } from './types';

// Shared start date — every source kicks off on this day.
const T0 = '2020-01-01';

// Warm + saturated palette, semi-organic.
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

export const DEFAULT_CONFIG: StrandConfig[] = [
  // 1. Attendance — first to merge.
  {
    id: 'attendance',
    name: 'Pupil attendance',
    colour: COL.attendance,
    startDate: T0,
    mergeDate: '2025-04-01',
    mergeInto: 'spine',
    users: 820,
    cadence: 'daily',
    outputs: ['out-perf-tables', 'out-pupil-premium', 'out-regional-dashboard'],
  },
  // 2. School Census.
  {
    id: 'school-census',
    name: 'School Census',
    colour: COL.schoolCensus,
    startDate: T0,
    mergeDate: '2025-10-01',
    mergeInto: 'spine',
    users: 620,
    cadence: 'termly',
    outputs: ['out-perf-tables', 'out-pupil-premium', 'out-statistical-release', 'out-regional-dashboard'],
  },
  // 3. Phonics screening.
  {
    id: 'phonics',
    name: 'Phonics screening (Y1)',
    colour: COL.phonics,
    startDate: T0,
    mergeDate: '2026-04-01',
    mergeInto: 'spine',
    users: 160,
    cadence: 'annual',
    outputs: ['out-statistical-release'],
  },
  // 4. KS2 SATs.
  {
    id: 'ks2',
    name: 'KS2 SATs (Y6)',
    colour: COL.ks2,
    startDate: T0,
    mergeDate: '2026-10-01',
    mergeInto: 'spine',
    users: 340,
    cadence: 'annual',
    outputs: ['out-perf-tables', 'out-statistical-release', 'out-regional-dashboard'],
  },
  // 5. KS4 / GCSE results.
  {
    id: 'ks4',
    name: 'KS4 / GCSE results',
    colour: COL.ks4,
    startDate: T0,
    mergeDate: '2027-04-01',
    mergeInto: 'spine',
    users: 470,
    cadence: 'annual',
    outputs: ['out-perf-tables', 'out-ebacc', 'out-statistical-release', 'out-regional-dashboard'],
  },
  // 6. A-Level / T-Level.
  {
    id: 'alevels',
    name: 'A-Level / T-Level results',
    colour: COL.alevel,
    startDate: T0,
    mergeDate: '2027-10-01',
    mergeInto: 'spine',
    users: 290,
    cadence: 'annual',
    outputs: ['out-perf-tables', 'out-ebacc', 'out-skills-funding', 'out-statistical-release'],
  },
  // 7. HESA student record.
  {
    id: 'hesa',
    name: 'HESA student record',
    colour: COL.hesa,
    startDate: T0,
    mergeDate: '2028-04-01',
    mergeInto: 'spine',
    users: 360,
    cadence: 'annual',
    outputs: ['out-statistical-release', 'out-skills-funding'],
  },
  // 8. Apprenticeships.
  {
    id: 'apprenticeships',
    name: 'Apprenticeships data',
    colour: COL.apprentice,
    startDate: T0,
    mergeDate: '2029-04-01',
    mergeInto: 'spine',
    users: 230,
    cadence: 'termly',
    outputs: ['out-skills-funding', 'out-statistical-release', 'out-regional-dashboard'],
  },
  // 9. Adult Skills records.
  {
    id: 'adult-skills',
    name: 'Adult learning records',
    colour: COL.adultSkills,
    startDate: T0,
    mergeDate: '2030-04-01',
    mergeInto: 'spine',
    users: 140,
    cadence: 'adhoc',
    outputs: ['out-skills-funding', 'out-statistical-release'],
  },
  // 10. LA Children's Social Care — last to merge.
  {
    id: 'la-csc',
    name: 'LA children’s social care',
    colour: COL.laCare,
    startDate: T0,
    mergeDate: '2031-04-01',
    mergeInto: 'spine',
    users: 410,
    cadence: 'biannual',
    outputs: ['out-safeguarding', 'out-statistical-release'],
  },
];

// Collections / data products. Each runs ANNUALLY: every year from 2020
// onwards an instance appears at that year's x, connected to the source
// strand at the same point in time.
export const DEFAULT_OUTPUTS: OutputConfig[] = [
  {
    id: 'out-perf-tables',
    name: 'School performance tables',
    colour: '#c0392b',
    side: 'above',
  },
  {
    id: 'out-pupil-premium',
    name: 'Pupil Premium funding',
    colour: '#e67e22',
    side: 'below',
  },
  {
    id: 'out-ebacc',
    name: 'EBacc analysis',
    colour: '#8e44ad',
    side: 'above',
  },
  {
    id: 'out-skills-funding',
    name: 'Skills funding allocations',
    colour: '#16a085',
    side: 'below',
  },
  {
    id: 'out-safeguarding',
    name: 'Safeguarding casework',
    colour: '#34495e',
    side: 'below',
  },
  {
    id: 'out-statistical-release',
    name: 'Statistical First Release',
    colour: '#2980b9',
    side: 'above',
  },
  {
    id: 'out-regional-dashboard',
    name: 'Regional outcomes dashboard',
    colour: '#27ae60',
    side: 'below',
  },
];
