// sectorVoices.ts — "voices from the system": what the sector is saying, as helpful
// background. Populated from the keystone-sector-voices research workflow (Schools Week,
// Civil Service World, LAs/ADCS/LGA, MATs/CST, third sector & safeguarding). Faithfully
// paraphrased, cited.

export type VoiceGroup = 'local-authorities' | 'mats' | 'third-sector' | 'press' | 'central';
export type Stance = 'supportive' | 'cautious' | 'critical' | 'mixed';

export interface SectorVoice {
  id: string;
  who: string;
  role?: string;
  group: VoiceGroup;
  stance: Stance;
  point: string;
  sourceName?: string;
  sourceUrl?: string;
  theme?: string;
}

export interface SectorTheme {
  id: string;
  title: string;
  summary: string;
}

export const VOICE_GROUP_META: Record<VoiceGroup, { label: string; blurb: string; color: string }> = {
  'local-authorities': { label: 'Local authorities', blurb: 'Councils, ADCS, LGA, CCN \u2014 the bodies that run children\u2019s services and carry the safeguarding duty.', color: '#2f6f97' },
  mats: { label: 'Schools & trusts', blurb: 'Multi-academy trusts, the Confederation of School Trusts and school leaders (ASCL).', color: '#2f6155' },
  'third-sector': { label: 'Third sector & civil society', blurb: 'Children\u2019s charities, the Children\u2019s Commissioner, and privacy campaigners.', color: '#7a5aa6' },
  press: { label: 'Sector commentary', blurb: 'Schools Week, Civil Service World and independent commentators on what\u2019s deliverable.', color: '#b4632e' },
  central: { label: 'Centre & watchdogs', blurb: 'Government, Parliament, the NAO/PAC and the ICO \u2014 the view from the middle.', color: '#8a2d3a' },
};

export const STANCE_META: Record<Stance, { label: string; color: string }> = {
  supportive: { label: 'Supportive', color: '#2f7d4f' },
  cautious: { label: 'Cautious', color: '#9a7b1f' },
  critical: { label: 'Critical', color: '#b1455e' },
  mixed: { label: 'Mixed', color: '#3a5fa8' },
};

export const SECTOR_THEMES: SectorTheme[] = [
  {
    "id": "consistent-identifier",
    "title": "The consistent child identifier: safeguarding promise vs surveillance fear",
    "summary": "The Children's Wellbeing and Schools Act introduces a single/consistent unique identifier for every child (DfE piloting the NHS number) plus a new duty to share information for welfare and safeguarding. This is the policy centre of gravity. Children's charities, the Children's Commissioner, local-government bodies and the DfE frame it as the way to stop children 'falling through the cracks'; privacy and civil-society groups (Defend Digital Me, Liberty, Reclaim Rights for Children, Open Rights Group) frame it as mission creep, an ever-expanding database and surveillance exceeding ContactPoint. "
  },
  {
    "id": "lawful-basis-vs-power",
    "title": "Governance, lawful basis, consent and scope creep",
    "summary": "A recurring fault line is the distinction between a lawful basis to process data and a legal power to share it, plus consent, transparency and 'Henry VIII' delegated powers letting the secretary of state define key details later by secondary legislation. Critics point to pupil data handed monthly to the Home Office for immigration enforcement and shared with DWP, the National Pupil Database's 23m-28m records with indefinite retention and 2,385+ distributions since 2012 (including to police and commercial firms), and a 2020 ICO finding the DfE in breach of fundamental data-protection principles"
  },
  {
    "id": "data-quality-readiness",
    "title": "Data quality and 'AI-readiness' as prerequisites",
    "summary": "Across central government and schools, poor and fragmented data is named as the load-bearing constraint on any analytics or AI payoff. DSIT's State of Digital Government review found data severely fragmented with inconsistent quality and only ~27% of officials confident their infrastructure gives a comprehensive operational view; the PAC warned 'AI relies on high-quality data to learn' yet government data is poor and trapped in old systems. In schools, MIS-to-DfE sync errors silently propagate into accountability decisions (the disputed 16%-below-32.5-hours figure). Practitioners (Corbridge: '"
  },
  {
    "id": "census-to-realtime",
    "title": "From periodic census to continuous, MIS-scraped real-time data flows",
    "summary": "The DfE wants to move from school-submitted census returns to continuous, automatically-extracted data flows, including a government MIS procurement framework schools will be 'expected' to use from September 2027 on a 'comply or explain' basis, plus benchmarking pilots from 2028. Consultants and trust leaders are cautiously supportive on burden reduction but insist success 'depends entirely on getting all MIS suppliers on board', that costs must not be passed to schools, and that MIS reliability must improve first. Sector-led platform Open Education AI already builds the cross-MIS aggregation-"
  },
  {
    "id": "deliverability-enforcement",
    "title": "Deliverability gap and missing enforcement levers (vision without a funded plan)",
    "summary": "Official reviews and committees diagnose ambition outrunning capability: the SIT Committee found a vision to be 'a truly digital state' but 'no clear plan to translate this vision into a reality'; ~28% of central tech estates are legacy with 21 of 72 red-rated systems unfunded; the digital roadmap (£45bn savings) slipped repeatedly; and the National Data Library lacks the enforcement power (departmental spending authority, the 'baseball bat covered with spikes') to compel departments to share. The cross-cutting lesson for any new data tool: governance and hard levers matter as much as the tech"
  },
  {
    "id": "funding-capacity",
    "title": "Funding sustainability and capacity to deliver the data work",
    "summary": "Local government warns the identifier and sharing duty land on fragmented, ageing case-management systems and stretched budgets. Care services consume roughly two-thirds of council budgets (69% average for counties, up to 76%); per-person children's-services spend rose 77% since 2014; children's social care ran ~14% over budget over three years; spending on children in care could reach ~£12bn a year by 2030. ADCS reports front-door contacts topping 3 million (highest in 17 years) while targeted early help fell to under 18% of spend. The civil service also lacks enough technical staff. Capacity"
  },
  {
    "id": "multiagency-fragility",
    "title": "Multi-agency data-sharing is only as strong as the hollowed-out partners",
    "summary": "Better plumbing cannot compensate for partners who lack capacity, money and incentive. ADCS Phase 9 found 41% of directors said police safeguarding capacity had deteriorated and 45% said the move to Integrated Care Boards worsened the health-safeguarding response, with ICB budgets cut ~30%, non-coterminous boundaries, and councils funding up to 95% of partnership budgets. Centrally, data sharing is throttled by misaligned incentives (e.g. DWP-to-HMRC sharing benefits HMRC, so DWP under-invests), not just technology. An identifier and a duty sit on top of this fragility."
  },
  {
    "id": "public-trust",
    "title": "Public trust, legitimacy and the chilling-effect risk",
    "summary": "Several voices argue distrust in data sharing must be met not with top-down reassurance but with deliberative public engagement ('engage, deliberate, decide') to build durable legitimacy, and that monetisation/AI use should follow only once trust is established. Critics warn the reform could chill the very engagement safeguarding depends on, driving vulnerable and migrant families away from NHS and council services. Surveys cited show 69% of parents unaware the National Pupil Database exists, underlining the transparency gap."
  }
];

export const SECTOR_VOICES: SectorVoice[] = [
  {
    "id": "v1",
    "who": "Department for Education / Bridget Phillipson (Education Secretary)",
    "group": "central",
    "stance": "supportive",
    "point": "The Children's Wellbeing and Schools Act establishes a single unique identifier for every child across datasets with a new duty to share information for welfare and safeguarding; the DfE will run a regional pilot to test whether the NHS number can serve as the consistent identifier. Phillipson frames the Act as 'landmark legislation' providing 'critical new protections.'",
    "role": "Government owner of the data strategy and legislation",
    "sourceName": "Schools Week — Schools bill: All 39 proposed policies (and when they'll start), 20 Dec 2024",
    "sourceUrl": "https://schoolsweek.co.uk/schools-bill-all-39-proposed-policies-and-when-theyll-start/",
    "theme": "consistent-identifier"
  },
  {
    "id": "v2",
    "who": "Department for Education (parents-facing explainer)",
    "group": "central",
    "stance": "supportive",
    "point": "A single unique identifier (like an NHS number) stops children becoming invisible to the system, and a new information-sharing duty eases sharing between schools and social services with a clear legal basis for safeguarding; Royal Assent 29 April 2026, with the identifier piloted via the NHS number ahead of rollout.",
    "role": "Government communications on the Bill",
    "sourceName": "DfE Education Hub — The Children's Wellbeing Bill: what parents need to know (gov.uk)",
    "sourceUrl": "https://educationhub.blog.gov.uk/2024/12/the-childrens-wellbeing-bill-what-parents-need-to-know/",
    "theme": "consistent-identifier"
  },
  {
    "id": "v3",
    "who": "Jen Persson, Defend Digital Me",
    "group": "third-sector",
    "stance": "critical",
    "point": "Warns the bill gives the secretary of state 'huge new powers' to define key data details later via secondary legislation with minimal scrutiny, that the government 'still hands over pupil data monthly for Home Office immigration enforcement' and is 'building ever more matched datasets of parents' income, benefits and pupil data.'",
    "role": "Privacy campaigner / director of children's data-rights group",
    "sourceName": "Schools Week — Campaigners warn of schools bill's 'huge new powers', 3 Feb 2025",
    "sourceUrl": "https://schoolsweek.co.uk/campaigners-warn-of-schools-bills-huge-new-powers/",
    "theme": "lawful-basis-vs-power"
  },
  {
    "id": "v4",
    "who": "Jen Persson, Defend Digital Me (opinion)",
    "group": "third-sector",
    "stance": "critical",
    "point": "Argues schools must defend families from data intrusion: data collected for education is repurposed for immigration enforcement, welfare-fraud detection and commercial uses (National Pupil Database records used for estate-agent 'heat maps'); the NPD holds 23m+ records, 69% of surveyed parents were unaware it existed, and every child should be guaranteed an opt-out.",
    "role": "Privacy campaigner — opinion author",
    "sourceName": "Schools Week — Schools must step up to defend families from data intrusion, 11 May 2024",
    "sourceUrl": "https://schoolsweek.co.uk/schools-must-step-up-to-defend-families-from-data-intrusion/",
    "theme": "public-trust"
  },
  {
    "id": "v5",
    "who": "Defend Digital Me",
    "group": "third-sector",
    "stance": "critical",
    "point": "Opposes mandating the NHS number as a single unique identifier as mission creep beyond its promised health-only use; warns the NPD holds 28m+ records indefinitely with 2,385+ distributions since 2012 (including to police and commercial firms), that a 2020 ICO audit found the DfE in breach of fundamental data-protection principles, and that in the deaths cited to justify the pol",
    "role": "Children's digital-rights advocacy organisation",
    "sourceName": "Defend Digital Me — NHS number to be national ID mandated in Children's Wellbeing and Schools Bill, 14 Jun 2025",
    "sourceUrl": "https://defenddigitalme.org/2025/06/14/nhs-number-to-be-national-id-mandated-in-childrens-wellbeing-and-schools-bill/",
    "theme": "consistent-identifier"
  },
  {
    "id": "v6",
    "who": "Defend Digital Me (2026 NPD review)",
    "group": "third-sector",
    "stance": "critical",
    "point": "Documents at least 2,385 unique distributions of national pupil data since 2012 (39% involving Tier-1 identifying data), examples including all 2,136 of one school's pupil records going to Merseyside Police and commercial heat-maps of pupils' home addresses; proposes concrete fixes (opt-out checkboxes in admissions, coded preferences in school MIS, auditable data-sharing pathwa",
    "role": "Children's digital-rights advocacy organisation",
    "sourceName": "Defend Digital Me — National pupil data distribution: a 2026 review and how to fix it",
    "sourceUrl": "https://defenddigitalme.org/2026/04/15/national-pupil-data-distribution-a-2026-review-and-how-to-fix-it/",
    "theme": "lawful-basis-vs-power"
  },
  {
    "id": "v7",
    "who": "Defend Digital Me (Jan 2026 Bill briefing)",
    "group": "third-sector",
    "stance": "critical",
    "point": "Argues Clause 4 strips two s.251A safeguards (the right to object and the duty of confidence), that an undefined identifier is legislated 'blind' via regulations with scope creep, and that there is no lapse of the identifier at age 18 or 25.",
    "role": "Children's data-rights campaign group",
    "sourceName": "Defend Digital Me — Briefing on the Children's Wellbeing and Schools Bill (01/01/2026)",
    "sourceUrl": "https://defenddigitalme.org/wp-content/uploads/2026/01/Defend-Digital-Me-Briefing_Childrens-Wellbeing-and-Schools-Bill-01012026.pdf",
    "theme": "lawful-basis-vs-power"
  },
  {
    "id": "v8",
    "who": "Nick Finnemore, edtech consultant",
    "group": "press",
    "stance": "supportive",
    "point": "Supports modernising statutory returns: 'In a modern data environment, the government should be able to access the statutory data it needs, when it needs it' — but stresses 'success will depend entirely on getting all MIS suppliers on board.'",
    "role": "Education technology consultant",
    "sourceName": "Schools Week — MIS: DfE wants to scrape real-time data from schools, 16 Jan 2026",
    "sourceUrl": "https://schoolsweek.co.uk/dfe-wants-to-scrape-real-time-mis-data-from-schools/",
    "theme": "census-to-realtime"
  },
  {
    "id": "v9",
    "who": "Duncan Baldwin, education consultant",
    "group": "press",
    "stance": "mixed",
    "point": "Sees benefits in real-time MIS data flows (less time on census returns, earlier benchmarking) and supports a government MIS framework if it is simpler and lower-risk, but insists 'the costs must not be passed on to schools' and that fairness and openness for suppliers must be maintained.",
    "role": "Education consultant",
    "sourceName": "Schools Week — MIS: DfE wants to scrape real-time data from schools, 16 Jan 2026",
    "sourceUrl": "https://schoolsweek.co.uk/dfe-wants-to-scrape-real-time-mis-data-from-schools/",
    "theme": "census-to-realtime"
  },
  {
    "id": "v10",
    "who": "Bridget Phillipson / DfE (MIS procurement framework)",
    "group": "central",
    "stance": "supportive",
    "point": "Schools will be 'expected' to buy MIS through a government framework from September 2027 on a 'comply or explain' basis, to ensure data flows across schools/trusts/LAs/national level, ease trust-transfer data moves, protect pupil data and use the 'collective buying power of 22,000 schools'; Phillipson: 'We are stepping in to support them to drive down costs, protect pupils' dat",
    "role": "Government",
    "sourceName": "Schools Week — Schools 'expected' to use government route to buy MIS from 2027, 8 Jun 2026",
    "sourceUrl": "https://schoolsweek.co.uk/schools-expected-to-use-government-route-to-buy-mis-from-2027/",
    "theme": "census-to-realtime"
  },
  {
    "id": "v11",
    "who": "Information Commissioner's Office (ICO)",
    "group": "central",
    "stance": "critical",
    "point": "Classified the DfE's live daily-attendance tracker (data extracted from registers via edtech firm Wonde) as 'clearly in the high risk category', found the DfE had not completed a required data protection impact assessment before launch, ordered correction of a DfE claim about ICO involvement, and questioned holding sensitive pupil data (ethnicity, FSM, SEND) for 66 years and th",
    "role": "Data protection regulator",
    "sourceName": "Schools Week — ICO sounds alarm over live school attendance tracker, 16 Sep 2022",
    "sourceUrl": "https://schoolsweek.co.uk/information-watchdog-sounds-alarm-over-live-school-attendance-tracker/",
    "theme": "lawful-basis-vs-power"
  },
  {
    "id": "v12",
    "who": "Geoff Barton, ASCL (then General Secretary)",
    "group": "mats",
    "stance": "cautious",
    "point": "On the live attendance tracker: schools 'unlikely would have signed up' had they known the data-protection safeguards (the DPIA) had not been completed before launch.",
    "role": "School leaders' union",
    "sourceName": "Schools Week — ICO sounds alarm over live school attendance tracker, 16 Sep 2022",
    "sourceUrl": "https://schoolsweek.co.uk/information-watchdog-sounds-alarm-over-live-school-attendance-tracker/",
    "theme": "lawful-basis-vs-power"
  },
  {
    "id": "v13",
    "who": "Pepe Di'Iasio (ASCL) with Lift Schools, Harris Federation, Equals Trust, Bishop Hogarth Ca",
    "group": "mats",
    "stance": "critical",
    "point": "Dispute the DfE finding that ~16% of schools (3,256 of 20,000) fall below the 32.5-hour week, saying figures were 'captured incorrectly between the DfE and the MIS' (implausible values like 8 or 52+ hours); Di'Iasio 'wouldn't be surprised if the 16 per cent figure is inaccurate' — a systemic MIS-to-DfE data-quality problem, not non-compliance.",
    "role": "School leaders' union and academy trusts",
    "sourceName": "Schools Week — Schools suggest DfE data on 32.5 hour week is 'inaccurate', 30 Jan 2026",
    "sourceUrl": "https://schoolsweek.co.uk/dodgy-dfe-data-shortens-schools-working-weeks/",
    "theme": "data-quality-readiness"
  },
  {
    "id": "v14",
    "who": "Lauren Thorpe (United Learning) & Matthew Woodruff, Open Education AI",
    "group": "mats",
    "stance": "supportive",
    "point": "OEAI consolidates data from ~30 edtech firms and all major MIS into unified dashboards (assessment, behaviour, attendance, safeguarding, staffing) for 600+ schools across 30+ trusts; trusts have built predictive attendance models flagging at-risk pupils and combined school results with crime data to spot safeguarding vulnerabilities. Thorpe: it 'levels the playing field' for tr",
    "role": "Sector-led non-profit edtech data platform (founders)",
    "sourceName": "Schools Week — New AI platform aims to make sense of 'myriad of data', 23 Jan 2026",
    "sourceUrl": "https://schoolsweek.co.uk/new-ai-platform-aims-to-make-sense-of-myriad-of-data/",
    "theme": "data-quality-readiness"
  },
  {
    "id": "v15",
    "who": "Leora Cruddas, Confederation of School Trusts (CEO)",
    "group": "mats",
    "stance": "cautious",
    "point": "On RISE: 'Who decides? Who is responsible? Who is accountable to whom and for what?' — warns the plan 'fails to understand or articulate a theory of regulation' and leaves accountability for data-triggered intervention unclear.",
    "role": "Trust-sector membership body",
    "sourceName": "Schools Week — 'Who's accountable?': RISE improvement teams criticised, 8 Nov 2024",
    "sourceUrl": "https://schoolsweek.co.uk/unintelligible-leaders-question-governments-new-rise-teams/",
    "theme": "deliverability-enforcement"
  },
  {
    "id": "v16",
    "who": "DfE / Bridget Phillipson (RISE, school profiles)",
    "group": "central",
    "stance": "supportive",
    "point": "RISE engages with schools showing 'concerning levels of pupil attainment, including large year-on-year declines' (bottom 25% at KS2/KS4 incl. disadvantaged pupils), and a new 'school profiles' digital service (launching 2025-26) will be a 'one-stop shop' of report cards, performance/exam data and census figures comparing schools with similar characteristics; Phillipson: 'I will",
    "role": "Government accountability regime",
    "sourceName": "Schools Week — New school accountability regime: 8 key findings, 3 Feb 2025",
    "sourceUrl": "https://schoolsweek.co.uk/new-accountability-regime-rise-stuck-schools-and-profiles-explained/",
    "theme": "data-quality-readiness"
  },
  {
    "id": "v17",
    "who": "DfE AI toolkits / Bridget Phillipson",
    "group": "central",
    "stance": "mixed",
    "point": "DfE AI toolkits warn schools must ensure AI complies with UK GDPR before use ('if a system stores, learns from, or shares the data, staff could be breaching data protection law'), that most free tools are unsuitable for student use, that tools must not train on pupil work, and that 'no decision that could adversely impact a student's outcomes is based purely on AI without human",
    "role": "Government AI guidance for schools",
    "sourceName": "Schools Week — DfE school AI toolkits: 9 things leaders need to know, 10 Jun 2025",
    "sourceUrl": "https://schoolsweek.co.uk/school-ai-toolkits-9-things-leaders-need-to-know/",
    "theme": "data-quality-readiness"
  },
  {
    "id": "v18",
    "who": "David Gregson, #BeeWell (co-founder)",
    "group": "third-sector",
    "stance": "supportive",
    "point": "Argues better wellbeing 'hinges on putting the right data into the right hands': anonymous survey data should be surfaced at neighbourhood level via dashboards for local decision-making and benchmarking against similar schools, giving leaders 'the consistent data they need' without adding accountability burden.",
    "role": "Wellbeing-data initiative",
    "sourceName": "Schools Week — Better wellbeing hinges on the right data in the right hands, 28 Mar 2024",
    "sourceUrl": "https://schoolsweek.co.uk/improving-wellbeing-hinges-on-putting-the-right-data-into-the-right-hands/",
    "theme": "public-trust"
  },
  {
    "id": "v19",
    "who": "Department for Science, Innovation & Technology (DSIT)",
    "group": "central",
    "stance": "mixed",
    "point": "The official review diagnoses that ~28% of government tech systems are legacy, data is severely fragmented with inconsistent quality, and institutional/technical barriers restrict data movement between departments — concluding current capabilities and infrastructure make the digital and data ambitions difficult to deliver without substantial investment and structural/cultural c",
    "role": "Authors of the State of Digital Government review",
    "sourceName": "State of digital government review (Jan 2025)",
    "sourceUrl": "https://assets.publishing.service.gov.uk/media/678a47649752f24aa1573589/state-of-digital-government.pdf",
    "theme": "data-quality-readiness"
  },
  {
    "id": "v20",
    "who": "House of Commons Science, Innovation and Technology Committee",
    "group": "central",
    "stance": "critical",
    "point": "In 'Rewiring the state' the committee found the government intends to make the UK 'a truly digital state' but 'has not set out what this means in detail or in practice and there is no clear plan to translate this vision into a reality', and noted current legacy-IT data is incomplete with thousands of non-critical ageing systems still unidentified.",
    "role": "Parliamentary select committee scrutinising digital government",
    "sourceName": "Rewiring the state: Delivering digital government (committee report)",
    "sourceUrl": "https://publications.parliament.uk/pa/cm5902/cmselect/cmsctech/61/report.html",
    "theme": "deliverability-enforcement"
  },
  {
    "id": "v21",
    "who": "James O'Malley, technology/policy commentator",
    "group": "press",
    "stance": "mixed",
    "point": "Argues the National Data Library has emerged as essentially a curated relaunch of data.gov.uk for open datasets — not a secure gateway for inter-departmental personal-data sharing (the early-years health/education pilot runs separately) — and that its critical weakness is the lack of enforcement power to compel departments to publish and standardise data, unlike GDS which had d",
    "role": "Independent commentator",
    "sourceName": "We finally (sort of) know what the National Data Library is (James O'Malley, Jun 2026)",
    "sourceUrl": "https://takes.jamesomalley.co.uk/p/omg-ndl-wtf-bbq",
    "theme": "deliverability-enforcement"
  },
  {
    "id": "v22",
    "who": "Nigel Shadbolt, Open Data Institute (NDL Expert Advisory Group)",
    "group": "third-sector",
    "stance": "supportive",
    "point": "Stressed the National Data Library must be 'AI-ready from the outset', built on open standards and data-hygiene measures, with governance that balances innovation against public trust.",
    "role": "ODI chairman / NDL advisory group",
    "sourceName": "UK government's National Data Library works up steam (Computer Weekly, Jan 2026)",
    "sourceUrl": "https://www.computerweekly.com/news/366637775/UK-governments-National-Data-Library-works-up-steam",
    "theme": "data-quality-readiness"
  },
  {
    "id": "v23",
    "who": "TPXimpact (Bill Roberts; Timothy Hill)",
    "group": "third-sector",
    "stance": "cautious",
    "point": "Contend the NDL's main obstacles are organisational — misaligned incentives, diverse user objectives and governance complexity — not technology ('Technology alone won't solve this'); recommend the NDL enable multiple independent 'data spaces' and 'start small and test and learn' with high-value datasets rather than a comprehensive rollout.",
    "role": "Digital transformation consultancy",
    "sourceName": "National Data Library: a new plan for joined-up government data (TPXimpact)",
    "sourceUrl": "https://www.tpximpact.com/knowledge-hub/insights/national-data-library-joined-up-government-data",
    "theme": "multiagency-fragility"
  },
  {
    "id": "v24",
    "who": "Ada Lovelace Institute",
    "group": "third-sector",
    "stance": "cautious",
    "point": "Argues that distrust in government data sharing should not be met with top-down reassurance but with deliberative public engagement — an 'engage, deliberate, decide' approach — to build the legitimacy that makes data sharing trustworthy and durable.",
    "role": "Independent research institute on data and AI",
    "sourceName": "Turning distrust in data sharing into 'engage, deliberate, decide' (Ada Lovelace Institute)",
    "sourceUrl": "https://www.adalovelaceinstitute.org/blog/distrust-data-sharing-engage-deliberate-decide/",
    "theme": "public-trust"
  },
  {
    "id": "v25",
    "who": "Local Government Association (Cllr Arooj Shah)",
    "group": "local-authorities",
    "stance": "mixed",
    "point": "Called unique identifiers for children 'a positive step' but said this 'should be accompanied by wider reform to facilitate better information sharing including investment in systems and administrative support', and pressed for education providers to become a statutory safeguarding partner — the identifier alone is not enough without money for systems and admin.",
    "role": "National membership body for councils; Children and Young People Board chair",
    "sourceName": "Local authority bodies' statements on the Children's Wellbeing and Schools Bill (Local Government Lawyer)",
    "sourceUrl": "https://www.localgovernmentlawyer.co.uk/education-law/394-education-news/59489-children-not-in-school-registers-and-unique-identifier-numbers-to-be-introduced-through-children-s-wellbeing-and-schools-bill",
    "theme": "consistent-identifier"
  },
  {
    "id": "v26",
    "who": "Local Government Association (financial analysis)",
    "group": "local-authorities",
    "stance": "critical",
    "point": "LGA analysis of MHCLG data found councils overspending children's social care by ~14.2% a year over 2022-23 to 2024-25, with Q1 2025-26 already running ahead of budget (~£15.65bn annualised vs £15.55bn budgeted) and one in six social-services councils on exceptional financial support; warned demand and cost increases are 'outstripping councils' available resources' and the posi",
    "role": "Voice on financial sustainability of statutory services",
    "sourceName": "Community Care — Council social care budgets already under pressure (LGA/MHCLG analysis), 17 Oct 2025",
    "sourceUrl": "https://www.communitycare.co.uk/2025/10/17/council-social-care-budgets-already-under-pressure-this-year-finds-analysis-of-current-spending/",
    "theme": "funding-capacity"
  },
  {
    "id": "v27",
    "who": "Association of Directors of Children's Services (Andy Smith, President)",
    "group": "local-authorities",
    "stance": "mixed",
    "point": "Called the Bill 'a significant step forward' and welcomed unique identifiers, but said they 'should be accompanied by wider reform to facilitate better information sharing including investment in systems and administrative support', and that 'ongoing evaluation of the various pilot programmes and pathfinders... plus a clear implementation strategy alongside adequate funding wil",
    "role": "Professional leadership body for Directors of Children's Services",
    "sourceName": "ADCS response to the Children's Wellbeing Bill, 17 Dec 2024",
    "sourceUrl": "https://www.adcs.org.uk/adcs-response-to-the-childrens-wellbeing-bill/",
    "theme": "consistent-identifier"
  },
  {
    "id": "v28",
    "who": "ADCS Safeguarding Pressures Phase 9",
    "group": "local-authorities",
    "stance": "critical",
    "point": "Shows initial contacts topping 3 million — the highest in the 17-year series — while documenting fragile multi-agency arrangements: 41% of respondents said police safeguarding capacity had deteriorated, 45% said the introduction of ICBs worsened the health-safeguarding response, ICB budgets were cut ~30%, partner boundaries are rarely coterminous, and councils routinely fund th",
    "role": "Longitudinal evidence on safeguarding system pressures",
    "sourceName": "ADCS Safeguarding Pressures Research — Phase 9 (full report), Jan 2025",
    "sourceUrl": "https://www.adcs.org.uk/wp-content/uploads/2025/01/ADCS_Safeguarding_Pressures_Phase9_FINALv1.pdf",
    "theme": "multiagency-fragility"
  },
  {
    "id": "v29",
    "who": "ADCS Safeguarding Pressures Phase 9 (early help)",
    "group": "local-authorities",
    "stance": "critical",
    "point": "Reports targeted early help has fallen to under 18% of total children's-services spend (down from 36% in 2010-11) and calls for a shift away from 'short-term, competitive funding to long-term, equitable funding streams that enable forward planning, stabilise the workforce and enable local authorities to meet local need' — the data agenda asked of a sector whose preventative cap",
    "role": "Evidence on prevention/early-help erosion",
    "sourceName": "ADCS Safeguarding Pressures Research — Phase 9 (full report), Jan 2025",
    "sourceUrl": "https://www.adcs.org.uk/wp-content/uploads/2025/01/ADCS_Safeguarding_Pressures_Phase9_FINALv1.pdf",
    "theme": "funding-capacity"
  },
  {
    "id": "v30",
    "who": "ADCS (Childhood Matters position paper)",
    "group": "local-authorities",
    "stance": "mixed",
    "point": "Calls for a comprehensive cross-government 'vision and plan for childhood' backed by a long-term, sustainable funding settlement for all local authorities (not just some), arguing that 'emergency one-off injections of funding, while helpful, do not negate the need for sufficient, long-term funding' — reforms including data reforms should not be pursued department-by-department ",
    "role": "Strategic policy position",
    "sourceName": "ADCS Position Paper — Childhood Matters, Feb 2024",
    "sourceUrl": "https://www.adcs.org.uk/wp-content/uploads/2024/04/ADCS_Childhood_Matters_FINAL.pdf",
    "theme": "funding-capacity"
  },
  {
    "id": "v31",
    "who": "County Councils Network (Cllr Roger Gough)",
    "group": "local-authorities",
    "stance": "critical",
    "point": "Said two-thirds of council budgets now go on children's services and adult social care combined — 69% on average for counties, up to 76% for some, up from 63% a decade ago — with per-person children's-services spend up 77% since 2014; warned there is 'less and less each year' for other services and that without funding and demand management councils cannot sustain delivery.",
    "role": "Represents England's county and unitary councils",
    "sourceName": "CCN — councils spend two-thirds of budgets on care services, 18 Mar 2024",
    "sourceUrl": "https://www.countycouncilsnetwork.org.uk/councils-call-for-honest-discussion-on-what-they-should-be-expected-to-deliver-as-new-data-reveals-local-authorities-spend-two-thirds-of-their-budgets-on-care-services/",
    "theme": "funding-capacity"
  },
  {
    "id": "v32",
    "who": "Confederation of School Trusts and Edurio",
    "group": "mats",
    "stance": "mixed",
    "point": "Reports 56% of 8.5m children are now in academy trusts; of 417 CEOs surveyed (June-July 2024), 66% expect growth (81% in 20-plus-school trusts) and 39% see a merger as likely; digital strategy is rising as a priority (27%) but financial sustainability (66%, with 85% on budget) and SEND dominate trust concerns.",
    "role": "Sector body; survey of 417 trust CEOs",
    "sourceName": "CST/Edurio — National School Trust Report, September 2024",
    "sourceUrl": "https://cstuk.org.uk/system/files/paragraphs/cw_file/2025-04/CST_National_School_Trust_Report_2024.pdf",
    "theme": "census-to-realtime"
  },
  {
    "id": "v33",
    "who": "Confederation of School Trusts (Building Strong Trusts framework)",
    "group": "mats",
    "stance": "supportive",
    "point": "Defines seven domains of a strong trust (strategic governance; expert ethical leadership; high-quality inclusive education; school improvement at scale; workforce resilience/wellbeing; finance/operations; public benefit/civic duty) — a framework that maps onto but differs from DfE descriptors and notably does not foreground data or interoperability standards.",
    "role": "Sector body quality framework",
    "sourceName": "CST — Building strong trusts (April 2023, updated September 2024)",
    "sourceUrl": "https://cstuk.org.uk/knowledge/discussion-and-policy-papers/building-strong-trusts/",
    "theme": "data-quality-readiness"
  }
];

export const SECTOR_BACKGROUND: Record<string, string[]> = {
  "schoolsweek": [
    "The Children's Wellbeing and Schools Bill was introduced in December 2024 and lists 39 proposed policies; the single unique identifier for every child is one of them, paired with a new statutory duty to share information for welfare and safeguarding.",
    "The DfE is running a regional pilot to test whether the NHS number can serve as the consistent identifier across education, health and social-care datasets.",
    "The DfE wants school MIS providers to allow real-time data extraction so it can make faster policy decisions and give schools earlier benchmarking (benchmarking pilots planned from 2028).",
    "Schools will be 'expected' to buy MIS through a government procurement framework from September 2027 on a 'comply or explain' basis, using the collective buying power of about 22,000 schools.",
    "The ICO previously found the DfE's live daily-attendance tracker (data extracted via edtech firm Wonde) 'clearly in the high risk category', launched without a completed data protection impact assessment, with the DfE having overstated ICO involvement.",
    "Defend Digital Me's Jen Persson cites that 69% of parents surveyed were unaware the National Pupil Database exists, that the NPD holds 23m+ records, and that pupil data is handed to the Home Office monthly for immigration enforcement and shared with the DWP."
  ],
  "civilserviceworld": [
    "DSIT's State of Digital Government review (Jan 2025) found ~28% of central-government technology estates are legacy (up from 26% in 2023) and only ~27% of officials believe their infrastructure gives a comprehensive operational view.",
    "The National Data Library is backed by over £100m within a £1.9bn digital programme; after a year-long discovery phase it emerged closer to a curated relaunch of data.gov.uk than a secure cross-government personal-data exchange.",
    "The Public Accounts Committee flagged that 21 of 72 red-rated legacy systems still lack remediation funding and warned 'AI relies on high-quality data to learn'.",
    "The Modern Digital Government roadmap (meant to unlock ~£45bn in savings) slipped from summer 2025 to December 2025 to January 2026.",
    "The Children's Wellbeing and Schools Act introduces a consistent/single unique identifier for children with the DfE piloting the NHS number, justified by the Independent Review of Children's Social Care and tragic case reviews.",
    "Defend Digital Me states the National Pupil Database records 28m+ people with indefinite retention and has seen 2,385+ data distributions since 2012, and that a 2020 ICO audit found the DfE in breach of fundamental data-protection principles."
  ],
  "localAuthorities": [
    "The Children's Wellbeing and Schools Act 2026 introduces a consistent (single unique) child identifier, a new information-sharing duty, and children-not-in-school registers; Royal Assent reported variously around 29 April 2026.",
    "Care services consume roughly two-thirds of council budgets — 69% on average for counties, up to 76% for some — up from 63% a decade ago, with per-person children's-services spend up 77% since 2014 (County Councils Network).",
    "LGA analysis found children's social care overspending ~14.2% a year over 2022-23 to 2024-25, with one in six social-services councils on exceptional financial support and the position described as 'not financially sustainable'.",
    "ADCS Safeguarding Pressures Phase 9 (Jan 2025, 124 LAs' data) shows initial contacts at the front door topping 3 million, the highest in the 17-year series, while targeted early help fell to under 18% of children's-services spend (from 36% in 2010-11).",
    "ADCS Phase 9 found 41% of directors said police safeguarding capacity had deteriorated, 45% said the move to Integrated Care Boards worsened the health-safeguarding response, ICB budgets were cut ~30%, and councils fund up to 95% of multi-agency partnership budgets.",
    "2024 government data recorded 83,630 children in care, about 15,000 more than a decade ago; CCN warns spending on children in care could reach ~£12bn a year by 2030."
  ],
  "mats": [
    "The Confederation of School Trusts' National School Trust Report (Sept 2024) reports 56% of 8.5m children are now in academy trusts, and the system is consolidating.",
    "Of 417 trust CEOs surveyed (June-July 2024), 66% expect growth (81% in 20-plus-school trusts), conversions dominate (83%) but 39% see a merger as likely.",
    "Digital strategy is a rising trust priority (27%) but financial sustainability (66%, with 85% citing budget) and SEND dominate CEO concerns.",
    "CST's Building Strong Trusts framework defines seven domains of a strong trust and does not foreground data or interoperability standards.",
    "The DfE frames the single unique identifier (like an NHS number) as stopping children becoming invisible to the system, with a new information-sharing duty giving a clear legal basis for safeguarding; Royal Assent 29 April 2026, with the identifier piloted via the NHS number ahead of rollout.",
    "defenddigitalme opposes mandating the NHS number, citing scope creep, healthcare-disengagement risk (GMC warning), removal of Health and Social Care Act 2012 confidentiality protections, and a 2020 ICO finding that the DfE could not demonstrate GDPR compliance."
  ],
  "thirdSector": [
    "Children's charities and the Children's Commissioner broadly welcome the consistent identifier to stop children falling between services; NSPCC wants all relevant professionals enabled to use it and its purpose extended to evaluation/commissioning.",
    "Barnardo's and the wider coalition want clear timescales, the NHS number, anonymised-research use, and protections for migrant and asylum-seeking children.",
    "The Children's Commissioner (campaigning since 2021) warns against a narrow 'protection from harm' framing and wants guidance on 'unreasonable delay', training and monitoring.",
    "Defend Digital Me argues Clause 4 strips two s.251A safeguards (the right to object and the duty of confidence), that an undefined identifier is legislated 'blind' via regulations, and that there is no lapse at age 18 or 25.",
    "Liberty backs the aim but flags NHS-number identifiability, retention at 18, discrimination against children without an NHS number, and an immigration-enforcement chilling effect.",
    "Reclaim Rights for Children (Professors Edwards and Gillies) warn the identifier itself becomes a national database, with surveillance exceeding ContactPoint and profiling of SEND and marginalised children; Open Rights Group urges narrow, proportionate scope."
  ]
};

export const VOICES_BY_GROUP = (): Record<VoiceGroup, SectorVoice[]> => ({
  'local-authorities': SECTOR_VOICES.filter((v) => v.group === 'local-authorities'),
  mats: SECTOR_VOICES.filter((v) => v.group === 'mats'),
  'third-sector': SECTOR_VOICES.filter((v) => v.group === 'third-sector'),
  press: SECTOR_VOICES.filter((v) => v.group === 'press'),
  central: SECTOR_VOICES.filter((v) => v.group === 'central'),
});
