// Worked examples. Each preset is a complete brief + schema a DfE team might
// start from. They double as the tool's self-demonstration on first load.

import type { Brief, Field } from './types';
import { FIELD_TEMPLATES } from './fieldLibrary';

// Pull a library template by machine name as a field (id assigned on load).
function f(name: string, over: Partial<Field> = {}): Field {
  const t = FIELD_TEMPLATES.find((x) => x.name === name);
  if (!t) return { id: '', name, title: name, type: 'string', description: '', required: false, pii: false, specialCategory: false, ...over };
  const { domains, why, ...rest } = t;
  return { id: '', ...rest, ...over };
}
// A bespoke field not in the library.
function custom(field: Omit<Field, 'id'>): Field {
  return { id: '', ...field };
}

export interface Preset {
  id: string;
  label: string;
  domainLabel: string;
  summary: string;
  build: () => { brief: Brief; fields: Field[] };
}

export const PRESETS: Preset[] = [
  {
    id: 'early-help',
    label: 'Early Help (children\'s services)',
    domainLabel: "Children's social care",
    summary:
      'A multi-agency early-help dataset to spot children needing support before statutory thresholds — the hardest interoperability problem, and the clearest case for an NHS-Number spine.',
    build: () => ({
      brief: {
        name: 'Early Help Episode Standard',
        purpose:
          'A consistent record of early-help episodes so a child\'s support can be seen across schools, health and the local authority, and so the system can identify need earlier.',
        domain: 'childrens-social-care',
        providers: [
          { id: '', label: 'Local authority early-help teams', sector: 'local-authorities', ownership: 'public', existingStandards: ['cin-census'], systemsHeld: 'Liquidlogic / Mosaic / Eclipse', burdenSensitivity: 'high' },
          { id: '', label: 'Schools', sector: 'schools', ownership: 'public', existingStandards: ['school-census'], systemsHeld: 'SIMS / Arbor MIS', burdenSensitivity: 'high' },
          { id: '', label: 'Health visiting & GP', sector: 'nhs-health', ownership: 'public', existingStandards: ['prsb-healthy-child', 'cp-is'], systemsHeld: 'NHS child-health systems', burdenSensitivity: 'medium' },
          { id: '', label: 'Voluntary-sector family support', sector: 'voluntary-sector', ownership: 'voluntary', existingStandards: ['open-referral-uk'], systemsHeld: 'Various / spreadsheets', burdenSensitivity: 'high' },
        ],
        consumers: [
          { id: '', label: 'MASH / front door', sector: 'local-authorities', use: 'Build a fuller picture at the point of triage' },
          { id: '', label: 'DfE analysts', sector: 'central-gov', use: 'Understand early-help demand and outcomes nationally' },
          { id: '', label: 'Researchers (SRS)', sector: 'central-gov', use: 'Evaluate what works, on de-identified linked data' },
        ],
        processingPurposes: ['Operational case-working', 'Safeguarding', 'Statistical analysis', 'Service planning'],
        containsPersonalData: true,
        containsSpecialCategory: true,
        aboutChildren: true,
        geographicCoverage: 'England — local authority',
        legalBasis: 'UK GDPR Art.6(1)(e) public task; Art.9(2)(g) substantial public interest (safeguarding); DPIA completed',
        interopGoal: 'high',
        notes: 'DPIA required. Anchor on NHS Number subject to a legal gateway under the Children\'s Wellbeing and Schools Act.',
      },
      fields: [
        f('record_id', { required: true }),
        f('nhs_number', { required: true, title: 'NHS Number (child)' }),
        f('upn'),
        f('date_of_birth', { required: true }),
        f('sex'),
        f('ethnicity'),
        f('la_code', { required: true }),
        f('referral_date', { required: true }),
        custom({ name: 'episode_status', title: 'Episode status', type: 'enum', description: 'Status of the early-help episode (open, stepped-up, stepped-down, closed).', required: true, pii: true, specialCategory: false, codelist: 'To be defined — propose alignment with CIN status', sourceStandard: 'cin-census' }),
        f('factors_at_assessment'),
        custom({ name: 'lead_agency', title: 'Lead agency', type: 'enum', description: 'The agency holding lead responsibility for the episode.', required: false, pii: false, specialCategory: false, codelist: 'Agency type codelist' }),
        f('snapshot_date', { required: true }),
      ],
    }),
  },
  {
    id: 'attendance-feed',
    label: 'Daily attendance feed',
    domainLabel: 'Education',
    summary:
      'A near-real-time pupil attendance standard fed automatically from school MIS — the low-burden, automated-collection model that reduces the statutory-return ask.',
    build: () => ({
      brief: {
        name: 'Daily Pupil Attendance Feed',
        purpose: 'A standard for sharing session-level attendance daily, fed automatically from school management information systems.',
        domain: 'education',
        providers: [
          { id: '', label: 'Schools', sector: 'schools', ownership: 'public', existingStandards: ['school-census', 'cbds'], systemsHeld: 'SIMS / Arbor / Bromcom MIS', burdenSensitivity: 'high' },
          { id: '', label: 'MIS aggregators', sector: 'private-providers', ownership: 'private', existingStandards: [], systemsHeld: 'Wonde / Groupcall', burdenSensitivity: 'low' },
        ],
        consumers: [
          { id: '', label: 'DfE attendance dashboards', sector: 'central-gov', use: 'Monitor attendance in near-real-time' },
          { id: '', label: 'Local authorities', sector: 'local-authorities', use: 'Target attendance support' },
        ],
        processingPurposes: ['Operational monitoring', 'Statistical analysis', 'Real-time dashboards'],
        containsPersonalData: true,
        containsSpecialCategory: false,
        aboutChildren: true,
        geographicCoverage: 'England — national',
        legalBasis: 'UK GDPR Art.6(1)(c) legal obligation / (e) public task',
        interopGoal: 'high',
        notes: 'Automated MIS feed via approved aggregators — collect once, reuse the existing extract.',
      },
      fields: [
        f('record_id', { required: true }),
        f('upn', { required: true }),
        f('urn', { required: true }),
        f('snapshot_date', { required: true, title: 'Session date' }),
        f('attendance_mark', { required: true }),
        custom({ name: 'session', title: 'Session', type: 'enum', description: 'AM or PM session.', required: true, pii: false, specialCategory: false, codelist: 'AM | PM' }),
      ],
    }),
  },
  {
    id: 'send-tracking',
    label: 'SEND / EHC plan tracking',
    domainLabel: 'Education + health + care',
    summary:
      'A cross-service standard for EHC plans, where education, health and care all hold a piece — the textbook crosswalk problem.',
    build: () => ({
      brief: {
        name: 'EHC Plan Interoperability Standard',
        purpose: 'A shared standard for Education, Health and Care plan data so the three services can see a consistent, joined-up record for a child with SEND.',
        domain: 'education',
        providers: [
          { id: '', label: 'Local authority SEND teams', sector: 'local-authorities', ownership: 'public', existingStandards: ['sen2'], systemsHeld: 'EHC case-management systems', burdenSensitivity: 'high' },
          { id: '', label: 'Schools', sector: 'schools', ownership: 'public', existingStandards: ['school-census'], systemsHeld: 'MIS', burdenSensitivity: 'medium' },
          { id: '', label: 'Health (therapies, CAMHS)', sector: 'nhs-health', ownership: 'public', existingStandards: ['fhir-uk-core'], systemsHeld: 'NHS systems', burdenSensitivity: 'medium' },
        ],
        consumers: [
          { id: '', label: 'DfE SEND analysts', sector: 'central-gov', use: 'Monitor EHC plan timeliness and outcomes' },
          { id: '', label: 'Families', sector: 'voluntary', use: 'A consistent, portable record of the plan' },
        ],
        processingPurposes: ['Operational case-working', 'Statistical analysis', 'Accountability'],
        containsPersonalData: true,
        containsSpecialCategory: true,
        aboutChildren: true,
        geographicCoverage: 'England — local authority',
        legalBasis: 'UK GDPR Art.6(1)(e); Art.9(2)(g); DPIA required',
        interopGoal: 'high',
        notes: 'Crosswalk to SEN2 and FHIR UK Core; needs a shared identifier across education and health.',
      },
      fields: [
        f('record_id', { required: true }),
        f('upn', { required: true }),
        f('nhs_number', { title: 'NHS Number' }),
        f('la_code', { required: true }),
        f('date_of_birth', { required: true }),
        f('sen_provision', { required: true }),
        custom({ name: 'plan_status', title: 'EHC plan status', type: 'enum', description: 'Stage of the EHC plan (assessment, issued, ceased).', required: true, pii: true, specialCategory: true, codelist: 'SEN2-aligned status codes', sourceStandard: 'sen2' }),
        custom({ name: 'plan_issued_date', title: 'Plan issued date', type: 'date', description: 'Date the EHC plan was issued.', required: false, pii: true, specialCategory: false, format: 'ISO 8601', sourceStandard: 'iso-8601' }),
      ],
    }),
  },
  {
    id: 'services-directory',
    label: 'Community services directory',
    domainLabel: 'Local government',
    summary: 'A local services directory using Open Referral UK — the adoption-first, open-standard reuse case across public and voluntary providers.',
    build: () => ({
      brief: {
        name: 'Local Support Services Directory',
        purpose: 'A standard for publishing the support services available to families in an area, so referrers and residents can find them.',
        domain: 'local-gov',
        providers: [
          { id: '', label: 'Local authority', sector: 'local-authorities', ownership: 'public', existingStandards: ['esd-lgsl'], systemsHeld: 'Directory / CMS', burdenSensitivity: 'medium' },
          { id: '', label: 'Voluntary & community organisations', sector: 'voluntary-sector', ownership: 'voluntary', existingStandards: ['open-referral-uk'], systemsHeld: 'Various', burdenSensitivity: 'high' },
        ],
        consumers: [
          { id: '', label: 'Public / residents', sector: 'voluntary', use: 'Find local support' },
          { id: '', label: 'Social prescribers', sector: 'nhs-health', use: 'Refer into community support' },
        ],
        processingPurposes: ['Service discovery', 'Referral', 'Public information'],
        containsPersonalData: false,
        containsSpecialCategory: false,
        aboutChildren: false,
        geographicCoverage: 'Local authority',
        legalBasis: 'No personal data — open data under OGL',
        interopGoal: 'high',
        notes: 'Reuse Open Referral UK (HSDS) rather than a bespoke schema; publish open.',
      },
      fields: [
        f('record_id', { required: true, title: 'Service id' }),
        f('service_code', { required: true }),
        f('uprn', { title: 'Location UPRN' }),
        custom({ name: 'service_name', title: 'Service name', type: 'string', description: 'Public name of the service.', required: true, pii: false, specialCategory: false, sourceStandard: 'open-referral-uk' }),
        custom({ name: 'organisation', title: 'Organisation', type: 'string', description: 'Organisation providing the service.', required: true, pii: false, specialCategory: false, sourceStandard: 'open-referral-uk' }),
        custom({ name: 'eligibility', title: 'Eligibility', type: 'string', description: 'Who the service is for.', required: false, pii: false, specialCategory: false, sourceStandard: 'open-referral-uk' }),
      ],
    }),
  },
];

export const DEFAULT_PRESET = 'early-help';
