// valueLedger.ts — the claimed value of a data spine and the costs/risks, entry by
// entry, each tagged with confidence and the personas it lands on. "pro" entries are
// claimed benefits; "con" entries are risks and costs. Both sides carry evidence.
import type { Confidence, PersonaId } from './types';

export interface LedgerEntry {
  id: string;
  side: 'pro' | 'con';
  title: string;
  detail: string;
  eli5: string;
  confidence: Confidence;
  personas: PersonaId[];
  sourceUrl?: string;
}

export const LEDGER: LedgerEntry[] = [
  // ---------------- PROS ----------------
  {
    id: 'burden', side: 'pro', title: 'Collection burden falls — if returns are retired',
    detail: 'Schools currently supply ~400 data items per child per year through termly census, CTF and parallel requests. Feed-based collection demonstrably removes burden: the DfE states the daily attendance solution added none, and its own principles doc says wide participation lets it "explore longer-term solutions that could reduce schools\' manual data collection burdens". The benefit is real ONLY if old collections are switched off as feeds switch on.',
    eli5: 'Less form-filling for schools — but only if the government actually deletes the old forms instead of running both.',
    confidence: 'fact', personas: ['mat', 'la', 'vendor'],
    sourceUrl: 'https://assets.publishing.service.gov.uk/media/6511356b2f404b0014c3d820/Requesting_daily_data_from_state-funded_schools_principles_for_collection_and_DfE_use__1_.pdf',
  },
  {
    id: 'rapid', side: 'pro', title: 'Rapid-response services become possible',
    detail: 'Termly data cannot power operational services; daily data can. The attendance feed already drives same-week national statistics and school-level early-warning dashboards. The same pattern extends to children-missing-education alerts, safeguarding notifications (Operation Encompass moves ~2,000 domestic-abuse notifications a day without any national database), and in-year intervention tracking.',
    eli5: 'With live plumbing, the system can react this week — spot a child vanishing from the roll now, not in a report next year.',
    confidence: 'fact', personas: ['la', 'policy', 'mat'],
    sourceUrl: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data',
  },
  {
    id: 'fsm', side: 'pro', title: 'Entitlements reach families automatically',
    detail: 'FSM eligibility checking already joins DWP/HMRC/Home Office data; auto-enrolment pilots find the gap it leaves — Devon\'s single opt-out run found 1,000+ eligible unregistered pupils; EPI estimates ~1 in 10 eligible children nationally are unregistered, losing pupil-premium money too. A spine makes passporting systematic rather than pilot-by-pilot.',
    eli5: 'Free school meals (and the school funding attached) reach every entitled child without parents fighting forms.',
    confidence: 'fact', personas: ['la', 'ogd', 'parent', 'policy'],
    sourceUrl: 'https://epi.org.uk/wp-content/uploads/2025/03/FSM-report-March-2025_PDF.pdf',
  },
  {
    id: 'safeguarding', side: 'pro', title: 'Safeguarding joins that inquiries keep demanding',
    detail: 'From Climbié (2003) onward, serious case reviews repeat one finding: each service held a piece and nobody assembled the picture. A consistent identifier plus a record locator gives a MASH identity resolution in minutes and pointers to which services know a child — the precise gap the reviews name. The targeted CP-IS service (NHS-number-keyed child-protection flags) has quietly proven the pattern for a decade.',
    eli5: 'When professionals worry about a child, they could instantly see which other services know them — the thing every tragedy inquiry says was missing.',
    confidence: 'fact', personas: ['la', 'parent', 'policy'],
    sourceUrl: 'https://www.rcpch.ac.uk/resources/nhs-number-single-unique-identifier-children-position-statement',
  },
  {
    id: 'transitions', side: 'pro', title: 'Transitions stop losing children',
    detail: 'Records fragment at every move: school-to-school (CTF lag), school-to-college (UPN→ULN cliff), education-to-adulthood. FFT found ~8,000 pupils simply "disappeared" from rolls in a year. The Education Record app (national from Aug 2026, ~£30m/yr claimed admin saving) shows the fix shipping: the learner carries their record across the gap.',
    eli5: 'When a child changes school or leaves for college, their record follows them — so no one falls down the crack between systems.',
    confidence: 'fact', personas: ['mat', 'la', 'research'],
    sourceUrl: 'https://www.gov.uk/government/news/government-modernises-exam-records-with-new-app',
  },
  {
    id: 'evaluation', side: 'pro', title: 'Policy evaluation speeds up by years',
    detail: 'LEO linkage (education→earnings) took years to build and runs years behind; most policy evaluation waits for annual statistics. In-year feeds plus a consistent identifier collapse evaluation lag — researchers watched attendance policy respond in near-real-time for the first time in 2024/25. Faster feedback loops mean failing policy dies faster and working policy scales sooner.',
    eli5: 'The government could tell within months — not half a decade — whether a policy actually helps children.',
    confidence: 'hypothesis', personas: ['research', 'policy'],
    sourceUrl: 'https://www.adruk.org/data-access/flagship-datasets/longitudinal-education-outcomes/',
  },
  {
    id: 'operational-turn', side: 'pro', title: 'Infrastructure for a department that now runs services',
    detail: 'The DfE is no longer only a policy department: it operates the attendance dashboards, the Education Record, teacher services, funding systems, the apprenticeship service — a digital estate consolidated from 271 systems into 57 service lines, now with a £200k Director General for Digital owning "data spine and single unique identifier" work. Operational departments need operational data infrastructure; the spine is that turn made explicit.',
    eli5: 'The education ministry increasingly runs live services like a utility company — and utilities need proper pipes, not annual spreadsheets.',
    confidence: 'fact', personas: ['digital', 'policy', 'vendor'],
    sourceUrl: 'https://www.edtechinnovationhub.com/news/englands-dfe-creates-200000-digital-and-ai-role-covering-data-cyber-estates-and-school-safety',
  },
  {
    id: 'market', side: 'pro', title: 'Open standards discipline the MIS market',
    detail: 'The MIS market is concentrated (Arbor ~44%, SIMS ~32%, Bromcom ~16%) and the CMA investigated switching barriers in 2024. Spine-grade open data standards make pupil data portable by construction — loosening lock-in, easing MIS switching, and letting smaller edtech compete on product rather than integration access.',
    eli5: 'If every system must speak the same data language, schools can change software without their data being held hostage.',
    confidence: 'hypothesis', personas: ['vendor', 'mat', 'digital'],
    sourceUrl: 'https://www.whichmis.com/mis-stats-from-the-october-census/',
  },
  {
    id: 'parent-view', side: 'pro', title: 'Parents could finally see the record',
    detail: 'Most parents do not know the NPD exists (defenddigitalme\'s survey finding). A spine built with a citizen-facing surface — the Education Record pattern extended, or an Estonian-style access log — would for the first time let families see what is held and who looked. This benefit is entirely contingent on design choices; nothing announced commits to it.',
    eli5: 'Done right, parents get an app showing their child\'s record and every access to it. Done wrong, they stay in the dark.',
    confidence: 'hypothesis', personas: ['parent', 'policy'],
    sourceUrl: 'https://defenddigitalme.org/research/the-state-of-data-2020/',
  },
  // ---------------- CONS ----------------
  {
    id: 'honeypot', side: 'con', title: 'The honeypot',
    detail: 'A joined child record is the most sensitive data asset the state could hold: identity, address, attendance, attainment, SEND, safeguarding flags — per child, for life. Breach precedent exists at every layer of today\'s estate: the LRS/Trustopia incident exposed access to 28m learner records to a gambling-industry screening firm. Centralised custody multiplies the blast radius; the architecture choice IS the security posture.',
    eli5: 'Put everything about every child in one place and it becomes the most valuable thing to steal in Britain.',
    confidence: 'fact', personas: ['parent', 'digital', 'la'],
    sourceUrl: 'https://defenddigitalme.org/the-learner-records-service-data-breach-and-ico-audit-a-connected-chronology/',
  },
  {
    id: 'trust-deficit', side: 'con', title: 'The custodian\'s record undermines the pitch',
    detail: 'The ICO\'s 2020 audit found the DfE in breach of data-protection law — no record of processing, "no clear picture of what data is held", no IG oversight; 139 recommendations, over 60% urgent/high. Add 2,385+ NPD distributions since 2012 and the Home Office MoU, and "secure and privacy-respecting" arrives with no credibility bank to draw on. Trust is the binding constraint on the whole programme.',
    eli5: 'The organisation asking to hold more children\'s data was formally found to be mishandling the data it already has.',
    confidence: 'fact', personas: ['parent', 'research', 'policy', 'digital'],
    sourceUrl: 'https://schoolsweek.co.uk/dfe-broke-pupil-data-protection-laws-damning-ico-audit-reveals/',
  },
  {
    id: 'scope-creep', side: 'con', title: 'Scope creep is the documented pattern',
    detail: 'Education data collected for one purpose has repeatedly been reused for another: the Home Office MoU turned school records into immigration enforcement (1,836 records supplied); police forces obtained pupil records in bulk; the CWSA leaves the identifier\'s user list to future regulations, with a minister already on record that "if additional benefits are realised, we can obviously explore the provisions further". Infrastructure lowers the cost of the next reuse.',
    eli5: 'Data collected to keep children safe has been quietly re-purposed before — and the new law leaves the door open to add new users later.',
    confidence: 'fact', personas: ['parent', 'ogd', 'la'],
    sourceUrl: 'https://defenddigitalme.org/2025/06/14/nhs-number-to-be-national-id-mandated-in-childrens-wellbeing-and-schools-bill/',
  },
  {
    id: 'chilling', side: 'con', title: 'Chilling effects on families',
    detail: 'The GMC warns families "may choose not to register with a GP" if the NHS number becomes a cross-service tracking key — the Welsh pilot\'s own DPIA flagged the same risk plus "invisible processing". The 2016 nationality-data boycott showed the mechanism live: collection perceived as surveillance produces refusal, and refusal corrupts the very datasets safeguarding depends on. The harm concentrates on the most vulnerable families.',
    eli5: 'If parents fear the number is tracking them, some will avoid doctors and schools\' forms — hurting exactly the children the system means to protect.',
    confidence: 'contested', personas: ['parent', 'la', 'research'],
    sourceUrl: 'https://www.rcpch.ac.uk/resources/nhs-number-single-unique-identifier-children-position-statement',
  },
  {
    id: 'political', side: 'con', title: 'Political fragility: ContactPoint proves the failure mode',
    detail: 'England has already built universal child-data infrastructure once: ContactPoint cost £224m, indexed all 11m children, and was switched off within a year of full operation by an incoming government on privacy grounds. A spine perceived as "a database of every child" inherits that fate risk — and unlike code, political capital does not refactor. The delivery window is one Parliament.',
    eli5: 'The last time Britain built this, a new government binned it almost immediately. £224m gone.',
    confidence: 'fact', personas: ['policy', 'digital', 'parent'],
    sourceUrl: 'https://researchbriefings.files.parliament.uk/documents/SN05171/SN05171.pdf',
  },
  {
    id: 'delivery', side: 'con', title: 'Delivery risk on cross-cutting infrastructure',
    detail: 'GOV.UK Verify: £200m+, 48% verification success against a 90% forecast, 27 adopting services, cancelled — the canonical warning that cross-government platforms fail on adoption, not technology. An education spine must win voluntary enthusiasm from 24,000+ schools, hundreds of trusts, 153 LAs and a commercial MIS/broker layer, or mandate its way to resentful, low-quality compliance.',
    eli5: 'Government has form for building shared platforms nobody plugs into. This one needs twenty-four thousand schools to bother.',
    confidence: 'fact', personas: ['digital', 'vendor', 'mat'],
    sourceUrl: 'https://www.computerweekly.com/news/252462967/Govuk-Verify-has-failed-users-and-its-leaders-lack-accountability-say-MPs',
  },
  {
    id: 'burden-double', side: 'con', title: 'The double-running trap',
    detail: 'The realistic failure mode for burden isn\'t the spine adding collections — it\'s the spine arriving WHILE the census, CTF and every legacy return keep running "during transition", a transition with no end date. Schools then maintain feeds AND forms. The white paper names no collection it will retire. Until it does, the burden-reduction benefit is a promise with no mechanism.',
    eli5: 'The new pipes could just get bolted on top of all the old paperwork — twice the work, sold as less.',
    confidence: 'hypothesis', personas: ['mat', 'la', 'vendor'],
  },
  {
    id: 'profiling', side: 'con', title: 'Profiling and the algorithmic child',
    detail: 'Joined longitudinal data invites prediction: flight-paths, risk scores, "similar schools" comparators (the attendance service already publishes an algorithmic transparency record). defenddigitalme\'s core white-paper critique: pupil data flowing into AI tools and analytics platforms with no equivalent of health\'s Caldicott Guardian regime, no statutory code for children\'s education data, and profiling decisions no parent can see or contest.',
    eli5: 'Once everything is joined, it\'s easy to score and rank children by algorithm — with no rules yet about who may do that.',
    confidence: 'contested', personas: ['parent', 'research'],
    sourceUrl: 'https://defenddigitalme.org/2026/02/26/every-child-achieving-and-thriving-data-drivers-and-our-response/',
  },
  {
    id: 'vendor-capture', side: 'con', title: 'Private plumbing becomes load-bearing state infrastructure',
    detail: 'The DfE\'s flagship rapid-response service already depends on a venture-backed broker: daily attendance flows through Wonde. A spine that standardises this quietly makes commercial intermediaries critical national infrastructure for children\'s data — procurement, resilience, and "who profits from the pipes" questions the white paper does not touch.',
    eli5: 'Right now a private company carries the government\'s school data. The spine could cement that arrangement without anyone deciding it should.',
    confidence: 'hypothesis', personas: ['vendor', 'digital', 'parent'],
    sourceUrl: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data',
  },
  {
    id: 'opportunity-cost', side: 'con', title: 'Opportunity cost in a starved system',
    detail: 'No budget has been published, but the comparators are instructive: ContactPoint £224m + £41m/yr; Verify £200m+; NHS-grade infrastructure runs to billions over a decade. Every pound is contestable against SEND deficits, crumbling estates and recruitment gaps — and an infrastructure programme with benefits arriving in 2028-29 competes badly against classrooms that need money now.',
    eli5: 'Big data plumbing costs serious money that schools would happily spend on teachers and buildings instead.',
    confidence: 'hypothesis', personas: ['mat', 'la', 'policy'],
  },
];
