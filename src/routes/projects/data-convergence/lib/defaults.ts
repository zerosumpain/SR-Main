// Default scene — modelled on data the UK Department for Education collects
// across a learner's lifetime: school (0-16), further education (16-18),
// higher education (18-22), then adult skills and training. Plus reference
// data and bi-directional feeds with local authorities for children's social
// care.
//
// Dates are anchored relative to a notional learner born 2010 — so the
// timeline spans 2010 through 2080. The scene scales gracefully across the
// 6m / 1y / 10y / lifetime zoom presets.

import type { StrandConfig, OutputConfig } from './types';

// Colour palette — warm + saturated, semi-organic. The DfE world has lots of
// categories so we leave headroom for additional sources without clashing.
const COL = {
  schoolDaily:    '#c0392b',  // attendance
  schoolTermly:   '#e67e22',  // school census
  schoolKS:       '#d35400',  // key-stage assessments
  schoolPhonics:  '#f1c40f',  // phonics
  feALevel:       '#8e44ad',  // A-level results
  heHesa:         '#2980b9',  // HESA
  apprentice:     '#16a085',  // apprenticeships
  trainingAdult:  '#27ae60',  // adult skills
  laSafeguard:    '#34495e',  // children's social care
  refSchools:     '#7f8c8d',  // GIAS / Get Information about Schools reference
  refQualNet:     '#95a5a6',  // qualifications net (Ofqual reference)
};

export const DEFAULT_CONFIG: StrandConfig[] = [
  // -------------- SCHOOL: ages 4-16 (2014 - 2026) --------------
  {
    id: 'attendance',
    name: 'Pupil attendance (daily)',
    colour: COL.schoolDaily,
    startDate: '2014-09-01',
    mergeDate: '2026-07-20',
    mergeInto: 'spine',
    users: 320,
    cadence: 'daily',
    outputs: ['out-perf-tables', 'out-pupil-premium', 'out-regional-dashboard'],
  },
  {
    id: 'school-census',
    name: 'School Census (termly)',
    colour: COL.schoolTermly,
    startDate: '2014-09-01',
    mergeDate: '2026-07-20',
    mergeInto: 'spine',
    users: 280,
    cadence: 'termly',
    outputs: ['out-perf-tables', 'out-pupil-premium', 'out-statistical-release', 'out-regional-dashboard'],
  },
  {
    id: 'phonics',
    name: 'Phonics screening (Y1)',
    colour: COL.schoolPhonics,
    startDate: '2015-06-01',
    mergeDate: '2016-07-15',
    mergeInto: 'spine',
    users: 90,
    cadence: 'annual',
    outputs: ['out-statistical-release'],
  },
  {
    id: 'ks2',
    name: 'KS2 SATs (Y6)',
    colour: COL.schoolKS,
    startDate: '2021-05-10',
    mergeDate: '2021-07-20',
    mergeInto: 'spine',
    users: 130,
    cadence: 'annual',
    outputs: ['out-perf-tables', 'out-statistical-release', 'out-regional-dashboard'],
  },
  {
    id: 'ks4',
    name: 'KS4 / GCSE results',
    colour: COL.schoolKS,
    startDate: '2026-05-15',
    mergeDate: '2026-08-25',
    mergeInto: 'spine',
    users: 220,
    cadence: 'annual',
    outputs: ['out-perf-tables', 'out-ebacc', 'out-statistical-release', 'out-regional-dashboard'],
  },

  // -------------- FURTHER EDUCATION: ages 16-18 (2026 - 2028) --------------
  {
    id: 'alevels',
    name: 'A-Level / T-Level results',
    colour: COL.feALevel,
    startDate: '2026-09-01',
    mergeDate: '2028-08-25',
    mergeInto: 'spine',
    users: 180,
    cadence: 'annual',
    outputs: ['out-perf-tables', 'out-ebacc', 'out-skills-funding', 'out-statistical-release'],
  },
  {
    id: 'ilr-college',
    name: 'ILR — college learner records',
    colour: COL.apprentice,
    startDate: '2026-09-01',
    mergeDate: '2030-08-31',
    mergeInto: 'spine',
    users: 140,
    cadence: 'termly',
    outputs: ['out-skills-funding', 'out-regional-dashboard'],
  },

  // -------------- HIGHER EDUCATION: ages 18-22 (2028 - 2032) --------------
  {
    id: 'hesa',
    name: 'HESA student record',
    colour: COL.heHesa,
    startDate: '2028-09-01',
    mergeDate: '2032-07-15',
    mergeInto: 'spine',
    users: 160,
    cadence: 'annual',
    outputs: ['out-statistical-release', 'out-skills-funding'],
  },

  // -------------- ADULT SKILLS & TRAINING: ages 16+ (rolling) --------------
  {
    id: 'apprenticeships',
    name: 'Apprenticeships data',
    colour: COL.apprentice,
    startDate: '2026-10-01',
    mergeDate: '2040-10-01',
    mergeInto: 'spine',
    users: 110,
    cadence: 'termly',
    outputs: ['out-skills-funding', 'out-statistical-release', 'out-regional-dashboard'],
  },
  {
    id: 'adult-skills',
    name: 'Adult learning records',
    colour: COL.trainingAdult,
    startDate: '2028-01-01',
    mergeDate: '2080-12-31',
    mergeInto: 'spine',
    users: 90,
    cadence: 'adhoc',
    outputs: ['out-skills-funding', 'out-statistical-release'],
  },

  // -------------- LOCAL AUTHORITY: children's social care --------------
  {
    id: 'la-csc',
    name: 'LA children’s social care',
    colour: COL.laSafeguard,
    startDate: '2014-04-01',
    mergeDate: '2028-03-31',
    mergeInto: 'spine',
    users: 130,
    cadence: 'biannual',
    outputs: ['out-safeguarding', 'out-statistical-release'],
  },

  // -------------- REFERENCE DATA: continuous metadata feeds --------------
  {
    id: 'ref-gias',
    name: 'GIAS — schools reference data',
    colour: COL.refSchools,
    startDate: '2014-01-01',
    mergeDate: '2080-12-31',
    mergeInto: 'spine',
    users: 60,
    cadence: 'continuous',
    isReference: true,
    outputs: ['out-perf-tables', 'out-regional-dashboard'],
  },
  {
    id: 'ref-qual',
    name: 'Qualifications reference net',
    colour: COL.refQualNet,
    startDate: '2014-01-01',
    mergeDate: '2080-12-31',
    mergeInto: 'spine',
    users: 50,
    cadence: 'continuous',
    isReference: true,
    outputs: ['out-perf-tables', 'out-ebacc', 'out-skills-funding'],
  },
];

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
