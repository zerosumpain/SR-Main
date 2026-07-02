// orgs.ts — the organisation registry behind the commitments flow map.
// Rings give the radial layout its structure: DfE at the centre, its ALBs and
// agencies close in, the delivery system next, then the rest of government and
// the public/research edge. Angles are hand-placed so related organisations sit
// near each other (departments to the north, delivery to the south).

import type { Org } from './types';

export const ORGS: Org[] = [
  // ring 0 — the centre
  { id: 'dfe', name: 'Department for Education', short: 'DfE', group: 'dfe', ring: 0, angle: 0 },

  // ring 1 — DfE's arm's-length bodies and agencies
  { id: 'ofsted', name: 'Ofsted', short: 'Ofsted', group: 'alb', ring: 1, angle: 200 },
  { id: 'ofqual', name: 'Ofqual', short: 'Ofqual', group: 'alb', ring: 1, angle: 245 },
  { id: 'skills-england', name: 'Skills England', short: 'Skills Eng.', group: 'alb', ring: 1, angle: 290 },
  { id: 'ofs', name: 'Office for Students', short: 'OfS', group: 'alb', ring: 1, angle: 335 },
  { id: 'slc', name: 'Student Loans Company', short: 'SLC', group: 'alb', ring: 1, angle: 20 },
  { id: 'oak', name: 'Oak National Academy', short: 'Oak', group: 'alb', ring: 1, angle: 65 },

  // ring 2 — the delivery system DfE works through
  { id: 'schools', name: 'Schools & academy trusts', short: 'Schools', group: 'delivery', ring: 2, angle: 160 },
  { id: 'las', name: 'Local authorities', short: 'LAs', group: 'delivery', ring: 2, angle: 195 },
  { id: 'colleges', name: 'Colleges & training providers', short: 'Colleges', group: 'delivery', ring: 2, angle: 230 },
  { id: 'ey-settings', name: 'Early years settings & childminders', short: 'Early years', group: 'delivery', ring: 2, angle: 265 },
  { id: 'he', name: 'Universities & HE providers', short: 'HE', group: 'delivery', ring: 2, angle: 300 },
  { id: 'cscp', name: "Children's social care providers", short: 'Social care', group: 'delivery', ring: 2, angle: 130 },

  // ring 3 — the rest of government
  { id: 'dsit', name: 'DSIT / Government Digital Service', short: 'DSIT·GDS', group: 'centre', ring: 3, angle: 15 },
  { id: 'cabinet-office', name: 'Cabinet Office & No.10', short: 'CO·No.10', group: 'centre', ring: 3, angle: 345 },
  { id: 'dwp', name: 'Department for Work & Pensions', short: 'DWP', group: 'department', ring: 3, angle: 45 },
  { id: 'hmrc', name: 'HM Revenue & Customs', short: 'HMRC', group: 'department', ring: 3, angle: 75 },
  { id: 'dhsc', name: 'DHSC / NHS England', short: 'DHSC·NHS', group: 'department', ring: 3, angle: 105 },
  { id: 'home-office', name: 'Home Office & police', short: 'Home Office', group: 'department', ring: 3, angle: 315 },
  { id: 'moj', name: 'Ministry of Justice & youth justice', short: 'MoJ', group: 'department', ring: 3, angle: 285 },
  { id: 'mhclg', name: 'MHCLG & strategic authorities', short: 'MHCLG', group: 'department', ring: 3, angle: 255 },
  { id: 'ons', name: 'ONS & the statistics system', short: 'ONS', group: 'research', ring: 3, angle: 135 },
  { id: 'researchers', name: 'Researchers & evaluators', short: 'Research', group: 'research', ring: 3, angle: 165 },
  { id: 'parents', name: 'Parents, learners & the public', short: 'Public', group: 'public', ring: 3, angle: 225 },
];

export const ORG_BY_ID: Record<string, Org> = Object.fromEntries(ORGS.map((o) => [o.id, o]));

// Colors validated (dataviz six-checks, light surface) 2026-07-02; DfE is the root
// node in ink, not a series color.
export const ORG_GROUP_META: Record<Org['group'], { label: string; color: string }> = {
  dfe: { label: 'DfE', color: '#1c1611' },
  alb: { label: "DfE arm's-length bodies", color: '#8a2d3a' },
  delivery: { label: 'The delivery system', color: '#2f7a4f' },
  department: { label: 'Other departments', color: '#2c6fa3' },
  centre: { label: 'Centre of government', color: '#5d4696' },
  research: { label: 'Statistics & research', color: '#a06a1f' },
  public: { label: 'The public', color: '#4d6ba8' },
};
