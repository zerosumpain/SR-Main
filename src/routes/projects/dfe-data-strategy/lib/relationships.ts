// relationships.ts — how DfE's data relationships actually play out across the sector:
// what flows in, what flows back, the mandate underneath, the friction, and what each
// partner wants. Researched and verified against primary sources 2026-07-04 (the
// keystone relationship sweep); every entry cites its sources. This replaced the
// "live estate" widgets — the estate said what runs; this says how the deals work.

export interface RelFlow {
  what: string;
  detail: string;
}

export interface RelSource {
  name: string;
  url: string;
}

export interface Relationship {
  id: string;
  name: string;
  who: string;
  /** Data DfE takes from this partner. */
  flowsIn: RelFlow[];
  /** What DfE gives back. */
  flowsOut: RelFlow[];
  /** The legal/mandate basis, naming the instrument where possible. */
  mandate: string;
  /** The real tension in the relationship. */
  friction: string;
  /** What the partner wants from the relationship. */
  wants: string;
  sources: RelSource[];
}

export interface RelDynamic {
  id: string;
  title: string;
  text: string;
  exampleIds: string[];
}

export const RELATIONSHIPS: Relationship[] = [
  {
    id: 'schools-and-trusts',
    name: 'Schools & MATs',
    who: 'The c.24,000 state-funded schools in England and the multi-academy trusts that run most academies.',
    flowsIn: [
      { what: 'School census', detail: 'Termly (autumn/spring/summer) pupil-level return covering ~9.1m pupils — characteristics, FSM, SEND, exclusions — feeding the National Pupil Database.' },
      { what: 'Daily attendance data (via Wonde)', detail: 'Session-level attendance extracted from each school’s MIS and passed to DfE every day via Wonde; mandatory since the 2024/25 academic year after a voluntary trial.' },
      { what: 'School workforce census', detail: 'Staff-level return taken on the first Thursday each November: contracts, pay, qualifications, absence and vacancies.' },
      { what: 'Financial returns', detail: 'Academies accounts returns and maintained-school consistent financial reporting feed DfE’s financial benchmarking service.' },
    ],
    flowsOut: [
      { what: 'Analyse School Performance / View your education data', detail: 'DfE Sign-in dashboards returning a school’s own attainment and context data for self-evaluation and inspection preparation.' },
      { what: 'Monitor your school attendance', detail: 'Daily attendance dashboards back to schools, trusts and LAs — the flagship give-back of the daily collection, for earlier intervention.' },
      { what: 'Financial Benchmarking and Insights Tool (FBIT)', detail: 'Compares spending against similar schools and trusts; DfE reports 87% of schools and academies engaged with it in its first year.' },
    ],
    mandate:
      'Pupil censuses are statutory under s.537A Education Act 1996 and the Education (Information About Individual Pupils) (England) Regulations 2013 — amended in 2024 (SI 2024/66) to mandate daily attendance sharing; no parental consent is required. Workforce data is collected under separate school-workforce regulations.',
    friction:
      'Schools carry the collection burden through commercial MIS they pay for, while the analytical give-back has churned through successive tools (RAISEonline → ASP → FBIT / View your education data); the daily attendance feed raised workload and surveillance concerns, addressed in a published DPIA.',
    wants: 'Fewer, de-duplicated collections — and their own data returned quickly with genuine benchmarking insight.',
    sources: [
      { name: 'Complete the school census: statutory requirement (GOV.UK)', url: 'https://www.gov.uk/guidance/complete-the-school-census/statutory-requirement-data-sharing-and-regulations' },
      { name: 'Share your daily school attendance data (GOV.UK)', url: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data' },
      { name: 'Financial Benchmarking and Insights Tool', url: 'https://financial-benchmarking-and-insights-tool.education.gov.uk/' },
    ],
  },
  {
    id: 'local-authorities',
    name: 'Local authorities',
    who: 'England’s top-tier councils, which run children’s social care, SEND, early years and school admissions.',
    flowsIn: [
      { what: 'Children in need census', detail: 'Annual child-level return of every referral, assessment, s.47 enquiry and child protection plan in children’s social care, covering the year to 31 March.' },
      { what: 'Children looked after return (SSDA903)', detail: 'Annual episode-level return on every looked-after child and eligible care leaver; the SSDA903 collection dates back to 1992.' },
      { what: 'SEN2 survey', detail: 'January collection on every 0–25-year-old with an EHC plan — the only complete national EHCP source; collected at person level since 2023.' },
      { what: 'Early years census & preference collections', detail: 'January child-level count of funded early-years places in private/voluntary settings, plus statutory applications-and-offers returns around national offer days.' },
    ],
    flowsOut: [
      { what: 'Local Authority Interactive Tool (LAIT)', detail: 'Benchmarks each LA against England, its region and statistical neighbours across a wide set of children’s-services indicators.' },
      { what: 'Daily attendance reports', detail: 'LAs get daily dashboards for schools in their area from the attendance feed, to target attendance support earlier.' },
      { what: 'LA-level published statistics', detail: 'Explore Education Statistics returns CIN, looked-after children, EHCP and outcomes data at LA level, used for sufficiency planning and inspection preparation.' },
    ],
    mandate:
      'Children’s social care returns (CIN census, SSDA903) are statutory under s.83 Children Act 1989; SEN2, the early years census and the preference collections are mandatory DfE collections (the Childcare Act 2006 underpins early years). The Children’s Wellbeing and Schools Act 2026 adds Children Not in School registers — a new LA data duty.',
    friction:
      'Capacity: ADCS argues new granular collections should be fully funded and warns LA data capability varies widely; DfE has funded work on reducing children’s-social-care data burdens even as SEN2 went person-level and the 2026 Act adds registers.',
    wants: 'Funded, rationalised collections and faster national benchmarking back — to manage demand-led statutory services.',
    sources: [
      { name: 'Children in need census: guide (GOV.UK)', url: 'https://www.gov.uk/guidance/children-in-need-census' },
      { name: 'Children looked after return: guide (GOV.UK)', url: 'https://www.gov.uk/guidance/children-looked-after-return-guide-to-submitting-data' },
      { name: 'Local authority interactive tool (LAIT)', url: 'https://www.gov.uk/government/publications/local-authority-interactive-tool-lait' },
    ],
  },
  {
    id: 'ofsted',
    name: 'Ofsted',
    who: 'The inspectorate for schools, early years, FE and children’s services — a non-ministerial department reporting to Parliament, not to DfE.',
    flowsIn: [
      { what: 'Inspection outcomes', detail: 'Inspection judgements and monthly management information feed DfE statistics and intervention decisions, and link from every school’s GIAS record.' },
      { what: 'LA children’s-services (ILACS) outcomes', detail: 'Ofsted’s judgements on council children’s services inform DfE improvement intervention in local authorities.' },
    ],
    flowsOut: [
      { what: 'Inspection Data Summary Report (IDSR) inputs', detail: 'DfE census, attainment and attendance data is packaged into Ofsted’s IDSR, used by inspectors to prepare for and guide every school inspection.' },
      { what: 'GIAS registry data', detail: 'Ofsted takes school opens/closes, type, phase, religious character and predecessor links from DfE’s Get Information about Schools database.' },
    ],
    mandate:
      'Ofsted inspects under the Education Act 2005 and was constituted by the Education and Inspections Act 2006, reporting to Parliament. Data moves between the two under sharing agreements: DfE owns the collections, Ofsted owns the judgement.',
    friction:
      'The independence dynamic: Ofsted insists data “does not drive judgements” while schools experience the IDSR as DfE data with enforcement teeth; after single headline grades were scrapped from Sept 2024, GIAS removed its Ofsted rating fields — a visible loosening of the data coupling.',
    wants: 'Timely pupil-level DfE data for risk assessment and inspection preparation — without being cast as DfE’s enforcement arm.',
    sources: [
      { name: 'School inspection data summary report (IDSR) guide (GOV.UK)', url: 'https://www.gov.uk/guidance/school-inspection-data-summary-report-idsr-guide' },
      { name: 'Ofsted: the role of data on inspections (Nov 2025)', url: 'https://educationinspection.blog.gov.uk/2025/11/07/the-role-of-data-on-school-and-further-education-inspections/' },
      { name: 'Get Information about Schools: FAQ', url: 'https://get-information-schools.service.gov.uk/Faq' },
    ],
  },
  {
    id: 'ofqual-sta-awarding',
    name: 'Ofqual, STA & awarding bodies',
    who: 'The qualifications regulator (Ofqual), DfE’s Standards and Testing Agency for primary assessment, and the exam awarding organisations.',
    flowsIn: [
      { what: 'GCSE/A level results from awarding organisations', detail: 'Awarding organisations supply results covering the vast majority of pupils direct to DfE for KS4/KS5 performance measures, amended through autumn checking exercises.' },
      { what: 'Key stage 2 test data', detail: 'STA collects national curriculum test results via the NCA Portal — Pearson has run the Test Operations Service since Sept 2025, replacing the Primary Assessment Gateway.' },
      { what: 'Phonics and EYFSP results via LAs', detail: 'Phonics screening and early years foundation stage profile outcomes reach DfE through local authority returns.' },
    ],
    flowsOut: [
      { what: 'GRADE research dataset', detail: 'A joint Ofqual–DfE–UCAS initiative linking micro-data from all three (2017–2022) for independent research via the ONS secure research environment.' },
      { what: 'Validation feedback to awarding organisations', detail: 'DfE checks supplied results (e.g. qualification-number validity) and reports discrepancies back to awarding organisations for review.' },
    ],
    mandate:
      'National curriculum assessments are statutory for state schools; Ofqual regulates under the Apprenticeships, Skills, Children and Learning Act 2009; awarding organisations’ results supply is an established administrative arrangement underpinning performance tables rather than a census-style statutory return.',
    friction:
      'Boundary-holding: the data estate is deliberately split — Ofqual holds exam-level data, DfE holds the pupil spine — so system-wide questions need negotiated linkage (GRADE took a dedicated joint initiative); the 2025 handover of test operations to Pearson moved schools onto a new portal mid-cycle.',
    wants: 'Linked pupil-level context for standard-setting and research — while preserving regulatory independence from DfE.',
    sources: [
      { name: 'Key stage 4 performance: methodology (EES)', url: 'https://explore-education-statistics.service.gov.uk/methodology/key-stage-4-performance' },
      { name: 'GRADE user guide (GOV.UK)', url: 'https://www.gov.uk/government/publications/grading-and-admissions-data-for-england-grade-framework/grading-and-admissions-data-for-england-grade-user-guide' },
      { name: 'New Test Operations Service provider (GOV.UK)', url: 'https://www.gov.uk/guidance/new-test-operations-service-provider-information-for-schools' },
    ],
  },
  {
    id: 'post16-he',
    name: 'Post-16 & HE',
    who: 'Colleges and training providers, the Office for Students, Jisc/HESA as designated data body, and UCAS across further and higher education.',
    flowsIn: [
      { what: 'Individualised learner record (ILR)', detail: 'Learner-level returns from colleges, training providers and apprenticeship employers up to 14 times a year — collected directly by DfE since ESFA closed on 31 March 2025.' },
      { what: 'HESA student record (Data Futures)', detail: 'Jisc, which absorbed HESA, collects the annual student record from HE providers to a specification set by the OfS; DfE is a statutory customer of the data.' },
      { what: 'UCAS admissions data', detail: 'UCAS application and acceptance data is linked into DfE’s LEO dataset and the joint GRADE research dataset.' },
    ],
    flowsOut: [
      { what: 'LEO outcomes statistics', detail: 'Graduate and learner earnings/employment outcomes by provider and subject, built from education records linked to HMRC/DWP data, published for course choice and accountability.' },
      { what: 'Learning Records Service', detail: 'DfE operates the LRS, issuing unique learner numbers and holding personal learning records that providers and awarding bodies query.' },
    ],
    mandate:
      'ILR returns are a condition of DfE funding agreements rather than a census statute; the student record is statutory under the Higher Education and Research Act 2017, with Jisc designated data body for England (from Oct 2022) collecting to OfS specification.',
    friction:
      'The Data Futures re-platforming of the HESA record was troubled enough that the OfS commissioned an independent review after the strained 2022/23 collection; post-ESFA, FE providers deal directly with DfE for ILR compliance and funding-reconciliation deadlines.',
    wants: 'Stable specifications, fewer re-platformings, and course-level earnings-outcome data returned for planning and recruitment.',
    sources: [
      { name: 'ILR technical documents and guidance (Submit Learner Data)', url: 'https://guidance.submit-learner-data.service.gov.uk/' },
      { name: 'HESA: Designated Data Body for England', url: 'https://www.hesa.ac.uk/about/what-we-do/designated-data-body' },
      { name: 'OfS: independent review of Data Futures published', url: 'https://www.officeforstudents.org.uk/news-blog-and-events/press-and-media/independent-review-of-data-futures-programme-published/' },
    ],
  },
  {
    id: 'health-social-care',
    name: 'Health & social care',
    who: 'NHS England, integrated care boards and DHSC — the health side of children’s services and SEND.',
    flowsIn: [
      { what: 'NHS numbers via the Personal Demographics Service', detail: 'The consistent-identifier pilot with Wigan tests whether NHS numbers from the PDS improve match rates when linking children’s records across local services.' },
      { what: 'NHS datasets linked into ECHILD', detail: 'NHS England supplies Hospital Episode Statistics plus birth, maternity, mental-health and community data, linked to the NPD in ECHILD — c.20m children born 1984–2022.' },
      { what: 'Health advice into EHC needs assessments', detail: 'ICBs provide health advice and provision detail in EHC needs assessments, which surfaces in LAs’ person-level SEN2 returns to DfE.' },
    ],
    flowsOut: [
      { what: 'ECHILD research access', detail: 'De-identified NPD education and social-care records flow into the ECHILD database for accredited health and education researchers via the ONS Secure Research Service.' },
      { what: 'EHC plan statistics', detail: 'Published EHCP statistics give ICBs and DHSC the demand picture for joint commissioning of SEND health provision.' },
    ],
    mandate:
      'The Children and Families Act 2014 places joint-commissioning and cooperation duties on LAs and health bodies for SEND; the Children’s Wellbeing and Schools Act 2026 legislates for a single unique identifier for children — ministers intend it to be the NHS number — with new information-sharing duties for safeguarding.',
    friction:
      'The confidentiality boundary: RCPCH supports the NHS-number identifier only with safeguards, and campaigners warn against the NHS number becoming a de facto national child ID; without a shared identifier, education–health record matching has historically been lossy — which is what the Wigan pilot is testing.',
    wants: 'A working shared identifier, and education signals that help clinicians and ICBs see vulnerable children whole.',
    sources: [
      { name: 'RCPCH: NHS number as single unique identifier — position statement', url: 'https://www.rcpch.ac.uk/resources/nhs-number-single-unique-identifier-children-position-statement' },
      { name: 'ADR UK: ECHILD flagship dataset', url: 'https://www.adruk.org/data-access/flagship-datasets/education-and-child-health-insights-from-linked-data-england/' },
      { name: 'Defend Digital Me on the SUI provisions', url: 'https://defenddigitalme.org/2025/06/14/nhs-number-to-be-national-id-mandated-in-childrens-wellbeing-and-schools-bill/' },
    ],
  },
  {
    id: 'other-government-departments',
    name: 'HMRC, DWP & Home Office',
    who: 'The Whitehall departments whose data DfE links to — and which come to DfE for pupil matching.',
    flowsIn: [
      { what: 'HMRC/DWP earnings and benefits data (LEO)', detail: 'PAYE, self-assessment and benefits data is matched to education records, then de-identified, to build the Longitudinal Education Outcomes dataset.' },
      { what: 'DWP/HMRC/Home Office checks for FSM eligibility', detail: 'DfE’s Eligibility Checking System queries DWP, HMRC and Home Office data so LAs can verify free school meals and early-years entitlements; a rebuilt ECS rolls out from 1 June 2026.' },
    ],
    flowsOut: [
      { what: 'Pupil matching for the Home Office', detail: 'Under a December 2015 MoU, DfE matched pupils’ school and home address details against Home Office requests — capped at 1,500 children a month — for immigration enforcement.' },
      { what: 'Transparency-logged external shares', detail: 'NPD-level shares with the Home Office and police have been listed in DfE’s “external data shares” transparency publication since December 2017.' },
    ],
    mandate:
      'LEO’s linkage gateway is s.78 of the Small Business, Enterprise and Employment Act 2015; FSM eligibility checking rests on s.110 of the Education Act 2005 (limited to that purpose); the Home Office arrangement rests on a Memorandum of Understanding rather than bespoke statute.',
    friction:
      'The Home Office deal began in secret in 2015, was exposed via FOI in 2016, fuelled the Boycott School Census campaign, and forced DfE to scrap nationality/country-of-birth collection (2018) and delete the data (2020) — a lasting trust scar over the whole NPD.',
    wants: 'Reliable identity and eligibility matching against DfE’s pupil spine — enforcement and entitlement checking, not education insight.',
    sources: [
      { name: 'LEO privacy notice (GOV.UK)', url: 'https://www.gov.uk/government/publications/longitudinal-education-outcomes-study-how-we-use-and-share-data/longitudinal-education-outcomes-leo-privacy-notice' },
      { name: 'Schools Week: DfE’s pupil-data agreement with the Home Office', url: 'https://schoolsweek.co.uk/dfe-had-agreement-to-share-pupil-nationality-data-with-home-office/' },
      { name: 'DfE external data shares (GOV.UK)', url: 'https://www.gov.uk/government/publications/dfe-external-data-shares' },
    ],
  },
  {
    id: 'the-centre',
    name: 'The centre: DSIT, ONS & ADR UK',
    who: 'The cross-government data centre — DSIT/GDS and the National Data Library, ONS research services, and ADR UK.',
    flowsIn: [
      { what: 'Research accreditation regime (DEA 2017/UKSA)', detail: 'DfE relies on UKSA research accreditation and ONS-run secure environments to vet every researcher and project that touches NPD or LEO extracts.' },
      { what: 'ADR UK investment', detail: 'ADR UK (ESRC-funded) pays for curation of DfE-derived flagship research datasets — LEO, ECHILD and GRADE.' },
      { what: 'National Data Library programme', detail: 'DSIT’s NDL (£100m+ backing) chose early years as its kickstarter, joining education, health and childcare data with Leeds, Hammersmith & Fulham and Liverpool City Region councils.' },
    ],
    flowsOut: [
      { what: 'NPD/LEO deposits into the ONS Secure Research Service', detail: 'De-identified NPD and LEO extracts sit in the ONS SRS as DfE’s default researcher-access route, gatekept by DfE’s Data Sharing Approval Panel (DSAP).' },
      { what: 'Flagship linked datasets', detail: 'DfE data became national research infrastructure: LEO and ECHILD are ADR UK flagship datasets, and GRADE links DfE, Ofqual and UCAS micro-data.' },
    ],
    mandate:
      'Research access runs under Chapter 5 (s.64) of the Digital Economy Act 2017 and the UKSA accreditation scheme, with DSAP assessing every request for public benefit, proportionality and security; National Data Library participation is a policy programme, not a statutory duty.',
    friction:
      'Platform churn: ONS’s Integrated Data Service was meant to replace the SRS but stopped taking new research applications in July 2025, with the SRS continuing “indefinitely” — DfE’s research-access route is hostage to the centre’s infrastructure wobbles.',
    wants: 'DfE’s linked datasets wired into cross-government infrastructure as exemplar assets for the National Data Library.',
    sources: [
      { name: 'Apply for DfE personal data (GOV.UK)', url: 'https://www.gov.uk/guidance/apply-for-department-for-education-dfe-personal-data' },
      { name: 'National Data Library: progress update, January 2026', url: 'https://www.gov.uk/government/publications/national-data-library-progress-update-january-2026/national-data-library-progress-update-january-2026' },
      { name: 'ADR UK: the future of the SRS and IDS', url: 'https://www.adruk.org/news-publications/news-blogs/ons-shares-an-update-on-the-future-of-the-secure-research-service-and-the-integrated-data-service/' },
    ],
  },
  {
    id: 'edtech-mis',
    name: 'EdTech, MIS & intermediaries',
    who: 'The commercial layer: MIS suppliers (Arbor, SIMS/ParentPay Group, Bromcom) and intermediaries like Wonde that physically move school data.',
    flowsIn: [
      { what: 'Daily attendance extraction via Wonde', detail: 'Wonde, a private intermediary, extracts session attendance from school MIS and transfers it to DfE daily at no charge to schools — a commercial pipe inside a statutory flow.' },
      { what: 'Census files generated by MIS', detail: 'MIS software assembles and validates schools’ statutory census and workforce returns before submission to DfE — supplier data quality shapes national statistics.' },
    ],
    flowsOut: [
      { what: 'Data standards and framework design', detail: 'DfE publishes education data standards and is designing the MIS framework around portability, so data “flows smoothly across school, trust, LA and national levels”.' },
      { what: 'Framework market access', detail: 'The coming procurement framework will list approved suppliers; schools with sufficient broadband are “expected” to buy MIS through it from September 2027, comply-or-explain.' },
    ],
    mandate:
      'No statute binds suppliers directly: they act as processors inside schools’ and DfE’s statutory flows (the attendance collection has a published DfE DPIA). From Sept 2027 the relationship shifts from pure market to DfE-brokered comply-or-explain procurement via the framework.',
    friction:
      'Lock-in politics: DfE officials say some suppliers hold “schools’ data as hostage” with exit tactics; the ~£200m market has flipped — SIMS from 74% share (2021) to ~34%, behind Arbor on 39%, Bromcom on 16% — amid litigation such as Bromcom’s High Court claim over a trust-wide MIS deal.',
    wants: 'A place on the framework, fair procurement rules, and protection of supplier IP as data-portability requirements tighten.',
    sources: [
      { name: 'Schools Week: schools “expected” to use government MIS route from 2027', url: 'https://schoolsweek.co.uk/schools-expected-to-use-government-route-to-buy-mis-from-2027/' },
      { name: 'Schools Week: DfE official on “nightmare” MIS procurement', url: 'https://schoolsweek.co.uk/dfe-official-hopes-to-improve-nightmare-mis-procurement/' },
      { name: 'Share your daily school attendance data (GOV.UK)', url: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data' },
    ],
  },
];

export const RELATIONSHIP_BY_ID: Record<string, Relationship> = Object.fromEntries(RELATIONSHIPS.map((r) => [r.id, r]));

export const REL_DYNAMICS: RelDynamic[] = [
  {
    id: 'mandate-vs-reciprocity',
    title: 'Mandate buys data, not goodwill',
    text: 'DfE can compel collection through statute — s.537A censuses, s.83 social-care returns — but the return flow of dashboards and benchmarking is discretionary and has churned repeatedly. The health of each relationship tracks the perceived value of the give-back, which is why DfE now leads with FBIT, Monitor your school attendance and LAIT rather than the bare legal duty.',
    exampleIds: ['schools-and-trusts', 'local-authorities'],
  },
  {
    id: 'intermediary-layer',
    title: 'Commercial pipes inside statutory flows',
    text: 'Statutory duties are increasingly executed through private intermediaries: Wonde moves the daily attendance collection, Pearson runs national test operations, Jisc collects the HE record, and MIS suppliers hold the source data behind every census. DfE mandates the flow but a contractor owns the pipe — so procurement decisions have become data-policy decisions.',
    exampleIds: ['edtech-mis', 'schools-and-trusts', 'ofqual-sta-awarding', 'post16-he'],
  },
  {
    id: 'burden-politics',
    title: 'Every duty lands as a return',
    text: 'New policy almost always materialises as a new or deeper collection — person-level SEN2, daily attendance, the CWSA’s children-not-in-school registers — while ADCS and school bodies demand funding and rationalisation. DfE runs burden-reduction work and expands granularity at the same time; the tension is structural, not accidental.',
    exampleIds: ['local-authorities', 'schools-and-trusts'],
  },
  {
    id: 'identifier-seam',
    title: 'The identifier seam',
    text: 'Joins fail at identity: UPN in schools, ULN post-16, NHS number in health, NI number for LEO matching. The Children’s Wellbeing and Schools Act 2026 single-unique-identifier provisions — NHS number intended, piloted with Wigan — are the first statutory attempt to stitch the seam, and the most contested, because a working join is also a surveillance capability.',
    exampleIds: ['health-social-care', 'other-government-departments', 'post16-he'],
  },
  {
    id: 'accidental-research-infrastructure',
    title: 'Research infrastructure by accident',
    text: 'Data collected for funding and accountability — the NPD, ILR and HESA record — has become national research infrastructure, with LEO, ECHILD and GRADE now ADR UK flagship assets. Governance was retrofitted (DSAP, DEA 2017 accreditation), and the 2025 retreat from the Integrated Data Service back onto the SRS showed the platform layer is more fragile than the data it carries.',
    exampleIds: ['the-centre', 'post16-he', 'other-government-departments'],
  },
];
