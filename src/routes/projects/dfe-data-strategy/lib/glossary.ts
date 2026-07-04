// glossary.ts — the jargon an education data-strategy conversation swims in, defined in a
// sentence each. Rendered as hover tooltips (components/Term.svelte) and as the
// method page's jargon buster.

export interface GlossaryTerm {
  id: string;
  term: string;
  def: string;
}

export const GLOSSARY: GlossaryTerm[] = [
  { id: 'data-spine', term: 'Data spine', def: "The department's emerging backbone for joining records about a child or learner across services — one trusted core record other systems link to." },
  { id: 'sui', term: 'Single unique identifier', def: 'The consistent identifier for children legislated in the Children\'s Wellbeing and Schools Act 2026 (s.16LC Children Act 2004) — being piloted using the NHS number.' },
  { id: 'upn', term: 'UPN', def: 'Unique Pupil Number — the identifier schools give pupils, used across the department school data; imperfectly stable when children move.' },
  { id: 'uln', term: 'ULN', def: 'Unique Learner Number — the identifier for learners aged 14+ in further and higher education, held in the Learning Records Service.' },
  { id: 'giac', term: 'GIAC', def: 'Get Information About Children — The department service being built to give practitioners a joined view of a child, sitting on the identifier work.' },
  { id: 'gias', term: 'GIAS', def: 'Get Information About Schools — the register of schools and trusts everything else joins to.' },
  { id: 'npd', term: 'NPD', def: 'National Pupil Database — the longitudinal record of pupils in England: census, attainment, absence, exclusions.' },
  { id: 'leo', term: 'LEO', def: 'Longitudinal Education Outcomes — the linked dataset joining education records to HMRC earnings and DWP benefits, showing what education leads to.' },
  { id: 'ees', term: 'EES', def: 'Explore Education Statistics — The department\'s open statistics platform and API.' },
  { id: 'cnis', term: 'Children not in school registers', def: 'The statutory registers every local authority must keep of children not in school (CWSA 2026), with duties on parents and providers to supply information.' },
  { id: 'cin', term: 'CIN census', def: 'Children in Need census — the child-level social-care collection covering referrals, assessments and protection plans.' },
  { id: 'sen2', term: 'SEN2', def: 'The person-level census of education, health and care (EHC) plans — the SEND system\'s core dataset.' },
  { id: 'ehcp', term: 'EHCP', def: 'Education, Health and Care Plan — the statutory plan for children with higher-level special educational needs.' },
  { id: 'duaa', term: 'DUAA 2025', def: 'The Data (Use and Access) Act 2025 — reforms UK data law: recognised legitimate interests, smart data schemes, digital verification services, research provisions.' },
  { id: 'dea', term: 'DEA 2017', def: 'The Digital Economy Act 2017 — the main statutory gateways for data-sharing across public bodies (public service delivery, debt, fraud, research).' },
  { id: 'dpia', term: 'DPIA', def: 'Data Protection Impact Assessment — the risk assessment UK GDPR requires before high-risk processing.' },
  { id: 'dsa', term: 'DSA', def: 'Data-sharing agreement — the governance instrument that sets the terms when organisations share personal data.' },
  { id: 'atrs', term: 'ATRS', def: 'Algorithmic Transparency Recording Standard — the mandatory public record for algorithmic tools used in government decisions.' },
  { id: 'dma', term: 'DMA', def: 'Data Maturity Assessment for Government — the CDDO framework departments use to score their data maturity across ten themes.' },
  { id: 'ids', term: 'IDS', def: 'Integrated Data Service — ONS\'s cross-government platform for linking and analysing de-identified data.' },
  { id: 'srs', term: 'SRS', def: 'Secure Research Service — ONS\'s accredited safe environment for researcher access to sensitive data.' },
  { id: 'adr', term: 'ADR UK', def: 'Administrative Data Research UK — the partnership making linked administrative data safely available for research.' },
  { id: 'ndl', term: 'National Data Library', def: 'The government programme to make public-sector datasets findable and usable across departments and for research — The department data is expected within it.' },
  { id: 'one-login', term: 'GOV.UK One Login', def: 'The single sign-on and identity service all central government services are mandated to adopt.' },
  { id: 'mis', term: 'MIS', def: 'Management Information System — the school-held systems (Arbor, Bromcom, SIMS…) where most pupil data is born.' },
  { id: 'wonde', term: 'Attendance feed', def: 'The daily flow of attendance data from school MIS to the department (statutory since September 2024) — the model for API-first collection.' },
  { id: 'ilr', term: 'ILR', def: 'Individualised Learner Record — the further-education equivalent of the school census.' },
  { id: 'plr', term: 'Learning Records Service', def: 'The department service behind the ULN and personal learning records.' },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryTerm> = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
