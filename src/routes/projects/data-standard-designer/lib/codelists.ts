// Enumerated codelists (controlled vocabularies) — the actual permissible
// values for fields, where they are publicly defined. A field that points to a
// codelist by id gets: real enum values in the JSON Schema / Table Schema /
// CSVW exports, a value picker in the editor, and codelist-driven synthetic
// data. Where only a subset of a large official list is reproduced, `partial`
// is set true and the source is linked so the full list can be consulted.

export interface CodelistValue {
  code: string;
  label: string;
}

export interface Codelist {
  id: string;
  name: string;
  /** Owning standard / source. */
  source: string;
  sourceUrl?: string;
  /** True when this is a representative subset of a larger official list. */
  partial?: boolean;
  values: CodelistValue[];
}

export const CODELISTS: Codelist[] = [
  {
    id: 'sex',
    name: 'Sex',
    source: 'CBDS / NHS Data Dictionary',
    sourceUrl: 'https://www.datadictionary.nhs.uk/',
    values: [
      { code: 'M', label: 'Male' },
      { code: 'F', label: 'Female' },
    ],
  },
  {
    id: 'iso-5218-sex',
    name: 'Sex (ISO 5218)',
    source: 'ISO/IEC 5218',
    values: [
      { code: '0', label: 'Not known' },
      { code: '1', label: 'Male' },
      { code: '2', label: 'Female' },
      { code: '9', label: 'Not applicable' },
    ],
  },
  {
    id: 'dfe-ethnicity',
    name: 'Ethnicity (DfE / CBDS extended)',
    source: 'DfE Common Basic Data Set',
    sourceUrl: 'https://www.gov.uk/government/collections/common-basic-data-set',
    partial: true,
    values: [
      { code: 'WBRI', label: 'White British' },
      { code: 'WIRI', label: 'Irish' },
      { code: 'WIRT', label: 'Traveller of Irish heritage' },
      { code: 'WROM', label: 'Gypsy/Roma' },
      { code: 'WOTH', label: 'Any other White background' },
      { code: 'MWBC', label: 'White and Black Caribbean' },
      { code: 'MWBA', label: 'White and Black African' },
      { code: 'MWAS', label: 'White and Asian' },
      { code: 'MOTH', label: 'Any other mixed background' },
      { code: 'AIND', label: 'Indian' },
      { code: 'APKN', label: 'Pakistani' },
      { code: 'ABAN', label: 'Bangladeshi' },
      { code: 'AOTH', label: 'Any other Asian background' },
      { code: 'BCRB', label: 'Caribbean' },
      { code: 'BAFR', label: 'African' },
      { code: 'BOTH', label: 'Any other Black background' },
      { code: 'CHNE', label: 'Chinese' },
      { code: 'OOTH', label: 'Any other ethnic group' },
      { code: 'REFU', label: 'Refused' },
      { code: 'NOBT', label: 'Information not yet obtained' },
    ],
  },
  {
    id: 'sen-provision',
    name: 'SEN provision (CBDS / SEN2)',
    source: 'DfE Common Basic Data Set',
    sourceUrl: 'https://www.gov.uk/government/collections/common-basic-data-set',
    values: [
      { code: 'N', label: 'No special educational need' },
      { code: 'K', label: 'SEN support' },
      { code: 'E', label: 'Education, Health and Care plan' },
    ],
  },
  {
    id: 'attendance-mark',
    name: 'Attendance codes (DfE)',
    source: 'DfE School attendance codes',
    sourceUrl: 'https://www.gov.uk/government/publications/school-attendance',
    partial: true,
    values: [
      { code: '/', label: 'Present (AM)' },
      { code: '\\', label: 'Present (PM)' },
      { code: 'L', label: 'Late (before registers closed)' },
      { code: 'U', label: 'Late (after registers closed)' },
      { code: 'I', label: 'Illness' },
      { code: 'M', label: 'Medical/dental appointment' },
      { code: 'R', label: 'Religious observance' },
      { code: 'H', label: 'Holiday (authorised)' },
      { code: 'G', label: 'Holiday (unauthorised)' },
      { code: 'O', label: 'Absent (unauthorised)' },
      { code: 'C', label: 'Authorised — other circumstances' },
      { code: 'N', label: 'Reason not yet provided' },
      { code: 'X', label: 'Not required to be in school' },
    ],
  },
  {
    id: 'session-ampm',
    name: 'Session',
    source: 'DfE attendance',
    values: [
      { code: 'AM', label: 'Morning' },
      { code: 'PM', label: 'Afternoon' },
    ],
  },
  {
    id: 'ssda903-legal-status',
    name: 'Legal status (SSDA903)',
    source: 'DfE Children Looked After return (SSDA903)',
    sourceUrl: 'https://www.gov.uk/government/collections/children-in-care',
    partial: true,
    values: [
      { code: 'C1', label: 'Interim care order' },
      { code: 'C2', label: 'Full care order' },
      { code: 'V2', label: 'Accommodated under s.20 (single period)' },
      { code: 'V3', label: 'Accommodated under s.20 (series of short-term)' },
      { code: 'V4', label: 'Accommodated under s.20 (agreed series)' },
      { code: 'E1', label: 'Placement order granted' },
      { code: 'D1', label: 'Freeing order granted' },
      { code: 'J1', label: 'Remanded / committed and accommodated' },
      { code: 'J2', label: 'Placed in local-authority accommodation (PACE)' },
      { code: 'J3', label: 'Sentenced to a supervision order with residence requirement' },
      { code: 'L1', label: 'Under police protection' },
      { code: 'L2', label: 'Emergency protection order' },
      { code: 'L3', label: 'Under child assessment order' },
    ],
  },
  {
    id: 'ssda903-placement',
    name: 'Placement type (SSDA903)',
    source: 'DfE Children Looked After return (SSDA903)',
    sourceUrl: 'https://www.gov.uk/government/collections/children-in-care',
    partial: true,
    values: [
      { code: 'A3', label: 'Foster placement with relative/friend (long term)' },
      { code: 'A4', label: 'Foster placement with relative/friend (not long term)' },
      { code: 'A5', label: 'Foster placement with relative/friend who is also an approved adopter' },
      { code: 'A6', label: 'Foster placement with relative/friend — emergency' },
      { code: 'H5', label: 'Semi-independent living accommodation (not subject to children\'s-homes regs)' },
      { code: 'K1', label: 'Secure children\'s home' },
      { code: 'K2', label: 'Children\'s home' },
      { code: 'P1', label: 'Placed with own parents/person with parental responsibility' },
      { code: 'P2', label: 'Independent living (e.g. flat, lodgings)' },
      { code: 'R1', label: 'Residential care home' },
      { code: 'R2', label: 'NHS / health-trust establishment' },
      { code: 'R3', label: 'Family centre / mother-and-baby unit' },
      { code: 'S1', label: 'Placed for adoption with consent' },
      { code: 'T1', label: 'Residential school' },
      { code: 'U1', label: 'Foster placement with relative/friend' },
      { code: 'U2', label: 'Foster placement with other foster carer' },
    ],
  },
  {
    id: 'cin-factors',
    name: 'Factors at the end of assessment (CIN census)',
    source: 'DfE Children in Need census',
    sourceUrl: 'https://www.gov.uk/government/collections/children-in-need-census',
    partial: true,
    values: [
      { code: '1A', label: 'Alcohol misuse — concerns about the child' },
      { code: '1B', label: 'Alcohol misuse — concerns about a parent/carer' },
      { code: '2A', label: 'Drug misuse — concerns about the child' },
      { code: '2B', label: 'Drug misuse — concerns about a parent/carer' },
      { code: '3A', label: 'Domestic abuse — concerns about the child' },
      { code: '3B', label: 'Domestic abuse — concerns about a parent/carer' },
      { code: '4A', label: 'Mental health — concerns about the child' },
      { code: '4B', label: 'Mental health — concerns about a parent/carer' },
      { code: '5A', label: 'Learning disability' },
      { code: '6A', label: 'Physical disability or illness' },
      { code: '7A', label: 'Young carer' },
      { code: '8B', label: 'Privation / low income' },
      { code: '9A', label: 'Emotional abuse' },
      { code: '10A', label: 'Physical abuse' },
      { code: '11A', label: 'Sexual abuse' },
      { code: '12A', label: 'Neglect' },
      { code: '13A', label: 'Child sexual exploitation' },
      { code: '14A', label: 'Trafficking' },
      { code: '15A', label: 'Gangs' },
      { code: '16A', label: 'Socially unacceptable behaviour' },
      { code: '17A', label: 'Self-harm' },
      { code: '18A', label: 'Abuse linked to faith or belief' },
      { code: '19A', label: 'Child criminal exploitation' },
      { code: '20', label: 'Other' },
    ],
  },
  {
    id: 'ehc-plan-status',
    name: 'EHC plan status',
    source: 'Proposed (SEN2-aligned)',
    values: [
      { code: 'assessment', label: 'Needs assessment underway' },
      { code: 'issued', label: 'Plan issued and maintained' },
      { code: 'review', label: 'Annual review due/underway' },
      { code: 'ceased', label: 'Plan ceased' },
    ],
  },
  {
    id: 'ownership-sector',
    name: 'Provider ownership sector',
    source: 'Proposed',
    values: [
      { code: 'public', label: 'Public sector' },
      { code: 'private', label: 'Private sector' },
      { code: 'voluntary', label: 'Voluntary / community sector' },
      { code: 'mixed', label: 'Mixed' },
    ],
  },
  {
    id: 'yes-no',
    name: 'Yes / No',
    source: 'Proposed',
    values: [
      { code: 'Y', label: 'Yes' },
      { code: 'N', label: 'No' },
    ],
  },
];

const BY_ID = new Map(CODELISTS.map((c) => [c.id, c]));
export function codelistById(id?: string): Codelist | undefined {
  return id ? BY_ID.get(id) : undefined;
}
/** A human label for the codelist (used as the field's `codelist` text). */
export function codelistLabel(id?: string): string | undefined {
  const c = codelistById(id);
  return c ? `${c.name}${c.partial ? ' (subset)' : ''}` : undefined;
}
