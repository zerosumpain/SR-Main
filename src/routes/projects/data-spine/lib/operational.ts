// operational.ts — the rapid-response services a spine powers, and the larger story
// they tell: the DfE's shift from policy department to operational department.
import type { Confidence } from './types';

export interface OpService {
  id: string;
  name: string;
  status: 'live' | 'rolling-out' | 'legislated' | 'proposed';
  cadence: string;
  what: string;
  spineRole: string;
  eli5: string;
  confidence: Confidence;
  url?: string;
}

export const SERVICES: OpService[] = [
  {
    id: 'attendance', name: 'Daily attendance solution', status: 'live', cadence: 'Twice-daily batch',
    what: 'Automated extraction from every state school\'s MIS via Wonde — mandatory since 2024/25. Weekly national statistics; same-day dashboards for schools, trusts and LAs; an algorithmic "similar schools" comparator with a published transparency record.',
    spineRole: 'The proof-of-concept vertebra: demonstrates feed-based national collection with zero added school burden — and that the current spine runs on a commercial broker.',
    eli5: 'Every school\'s register flows to the government automatically each day, and schools get useful dashboards back.',
    confidence: 'fact', url: 'https://www.gov.uk/guidance/share-your-daily-school-attendance-data',
  },
  {
    id: 'education-record', name: 'Education Record app', status: 'rolling-out', cadence: 'At transition',
    what: 'Year 11 pupils get a digital record — schools attended, GCSE results, support needs — to share with sixth forms, colleges and apprenticeship providers. National ahead of August 2026 results; claimed £30m/yr admin saving.',
    spineRole: 'The learner-held vertebra: the record moves because the young person carries it. A trust-friendly pattern the spine could generalise.',
    eli5: 'School leavers carry their results and history in an app and show it to colleges themselves.',
    confidence: 'fact', url: 'https://www.gov.uk/government/news/government-modernises-exam-records-with-new-app',
  },
  {
    id: 'fsm', name: 'FSM auto-enrolment', status: 'rolling-out', cadence: 'Continuous eligibility checks',
    what: 'The Eligibility Checking System already joins DWP/HMRC/Home Office data; LA opt-out pilots (Devon: 1,000+ eligible unregistered pupils found in one run) and a Private Member\'s Bill push toward automatic registration.',
    spineRole: 'The cross-departmental vertebra: entitlement passporting is the friendliest possible case for OGD data joins — money flowing TO families.',
    eli5: 'Instead of parents applying, the systems talk to each other and free school meals switch on automatically.',
    confidence: 'fact', url: 'https://commonslibrary.parliament.uk/research-briefings/cbp-10206/',
  },
  {
    id: 'cnis', name: 'Children-not-in-school registers', status: 'legislated', cadence: 'Event-driven',
    what: 'CWSA 2026 makes LA registers of children not in school compulsory (expected fully in place 2027+). The Welsh SUI pilot\'s explicit use case: cross-matching NHS records against education registers to find children missing education entirely.',
    spineRole: 'The safeguarding vertebra: registers are only as good as the joins that populate them — this duty is unperformable at quality without identifier + locator infrastructure.',
    eli5: 'Councils must now keep a list of children not in any school — which only works if health and education systems can compare notes.',
    confidence: 'fact', url: 'https://www.cypnow.co.uk/content/news/childrens-wellbeing-and-schools-act-becomes-law',
  },
  {
    id: 'isp', name: 'Digital Individual Support Plans', status: 'proposed', cadence: 'Per child, live',
    what: 'The white paper replaces SEN support plans with digital ISPs — a live, shareable plan following the child across settings, plus new School Profiles combining attendance, attainment and Ofsted data for parents.',
    spineRole: 'The record-following-the-child vertebra: a live plan crossing school boundaries is architecturally a spine use-case, whatever it ends up being called.',
    eli5: 'A support plan that travels with the child between schools, always current, instead of PDFs emailed around.',
    confidence: 'fact', url: 'https://www.gov.uk/government/publications/every-child-achieving-and-thriving/every-child-achieving-and-thriving-html-version',
  },
];

export const OPERATIONAL_SHIFT = {
  title: 'From policy department to operational department',
  prose: [
    'The Department for Education used to be a policy machine with a statistics arm: it set rules, distributed money, and measured the system annually, in arrears. That department needed censuses. It did not need a spine.',
    'That department no longer exists. Today\'s DfE runs live services: attendance dashboards consumed by 20,000 schools, an Education Record in pupils\' pockets, eligibility checking joined to three other departments, teacher services, funding platforms, the apprenticeship service. Its digital strategy consolidated 271 systems into 57 service lines; it is hiring a £200k Director General for Digital whose brief names the data spine and the single unique identifier explicitly.',
    'This is the deeper reading of the spine commitment: not an analytics upgrade but the infrastructure bill for an operational department. Services need identity resolution, live data and standard interfaces the way policy analysis never did. The white paper\'s language — "flows seamlessly", "immediate insight" — is service language, not statistics language.',
    'It also explains the governance stakes. A policy department misusing data produces a bad dataset; an operational department misusing data produces a bad decision about a specific child, at speed, at scale. The move from termly statistics to daily operations is precisely why the information-governance section of this project is its largest.',
  ],
  eli5: 'The education ministry has quietly become a service-running organisation, like a utility. The spine is it admitting that and asking for proper pipes — which is also why the privacy rules matter so much more now.',
  confidence: 'hypothesis' as Confidence,
};
