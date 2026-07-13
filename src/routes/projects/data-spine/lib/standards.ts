// standards.ts — what a spine would have to STANDARDISE before a single real query
// crosses a real exchange, and the design decisions the summer-2026 consultation is
// left to make. Moved out of the federation deck in the 2026-07-13 research-flow reorg
// so the "next steps" beat owns the forward-looking material. Nothing here is blocked
// by cryptography; all of it is blocked by agreement.

export interface StandardLayer {
  k: string;
  title: string;
  have: string[];
  miss: string[];
}

export const STANDARDS: StandardLayer[] = [
  {
    k: 'IDENTIFY', title: 'One child, one number',
    have: ['UPN for schools, ULN from 14, URN/UKPRN for settings (GIAS)', 'The LRS/LDS learner-records plumbing for post-16'],
    miss: ['A lifetime learner identifier crossing the early-years and FE boundaries', 'A published identity-resolution standard: match keys, confidence scoring, what happens when matching is wrong', 'Governance for identifier issuance outside state schools'],
  },
  {
    k: 'DESCRIBE', title: 'A canonical model, versioned in the open',
    have: ['CBDS — the Common Basic Data Set behind the census', 'CTF/ATF schemas for transfers', 'Census and ILR specifications (updated annually, by circular)'],
    miss: ['An open canonical education-record model every gateway maps to once', 'A schema registry with semantic versioning and deprecation policy — the wellbeing/1.0 pattern from the scenarios', 'Conformance fixtures per schema version'],
  },
  {
    k: 'MOVE', title: 'Query contracts, not file transfers',
    have: ['CTF files and School-to-School (S2S) for moves', 'Proprietary MIS APIs; Wonde and peers as de-facto brokers', 'The daily attendance feed — the spine’s first vertebra'],
    miss: ['A signed query-contract standard: purpose, basis, aggregation and retention as machine-readable fields', 'One gateway API profile every MIS implements (precedents: Ed-Fi, 1EdTech OneRoster, X-Road’s message protocol)', 'A public conformance suite that certifies a gateway before it joins'],
  },
  {
    k: 'PROVE', title: 'Trust made inspectable',
    have: ['DfE Sign-in for humans', 'Transport encryption everywhere, informally'],
    miss: ['A federation PKI / e-seal profile: who signs what, key ceremony, revocation SLAs measured in minutes', 'The citizen-readable audit-ledger format — the obelisk needs a spec, not a vibe', 'Non-repudiation and trusted time-stamping rules (the part of X-Road worth importing wholesale)'],
  },
  {
    k: 'PROTECT', title: 'Law as configuration',
    have: ['DEA 2017 research accreditation and the ONS SDC practice', 'UK GDPR Art. 21 objection rights', 'Health’s national data opt-out — proof a registry can work, and how hard retrofitting is'],
    miss: ['A machine-readable basis registry: which statute unlocks which fields at which aggregation — the thing every gateway checks in the simulations', 'An opt-out/objection registry standard enforced at source, not remembered at the centre', 'A published suppression + noise profile (small cells, ε-budgets) applied identically by every estate'],
  },
  {
    k: 'ADOPT', title: 'Make plugging in pay',
    have: ['DfE digital and technology standards for schools', 'G-Cloud and the MIS choice frameworks trusts already buy through'],
    miss: ['The procurement hook: gateway conformance as a condition of framework listing', 'A funded on-ramp for the long tail — Databridge and the self-hosted schools cannot subsidise the spine', 'An edtech certification tier for the tendrils: aggregate-only contracts, pseudonym rules, audit obligations', 'Honest migration timelines — the incumbent estates move in years, not quarters'],
  },
];

// The decisions the consultation is left to make — each with the fork and the study's read.
export interface OpenDecision {
  id: string;
  question: string;
  fork: string;
  read: string;
  eli5: string;
}

export const OPEN_DECISIONS: OpenDecision[] = [
  {
    id: 'custody',
    question: 'Connect or collect?',
    fork: 'A locator/federation that leaves records at source (NHS-Spine / X-Road pattern), or a central store that copies them in (ContactPoint pattern).',
    read: 'The single decision everything else hangs on — and the only one with a proven English failure mode. Every UK precedent punishes the central store and rewards the index/federation. The consultation is where this gets chosen; the white paper deliberately did not.',
    eli5: 'Do the records stay in schools and get fetched when needed, or get copied into one national database? Britain built the database once and switched it off.',
  },
  {
    id: 'resolution',
    question: 'Who writes the identity-resolution standard?',
    fork: 'A published standard for matching a UPN to an LA case ID to an NHS number — with confidence scoring and a defined answer for when matching is wrong — or continued ad-hoc matching, project by project.',
    read: 'The named gap. The simulation makes it literal: every cross-context join (schools × local authorities, schools × health) fails without it, and produces a match confidence, not a certainty. There is no published standard today.',
    eli5: 'When two services hold records for the same child under different numbers, how do you know it’s the same child — and how sure are you? Nobody has written this rule down.',
  },
  {
    id: 'custodian',
    question: 'Who runs it, and who audits them?',
    fork: 'A DfE-operated service, an arm’s-length body, or a genuinely federated arrangement with no single operator — and an audit function that is independent of whoever runs the exchange.',
    read: 'The white paper names no custodian. Whoever holds the switchboard holds the power; the citizen-readable ledger and an independent auditor are what stop “privacy-respecting” from being a slogan.',
    eli5: 'Who operates the plumbing, and who checks that they behave? Both are still blank.',
  },
  {
    id: 'onramp',
    question: 'Who pays for the long tail to plug in?',
    fork: 'A funded on-ramp for small and self-hosted schools and specialist AP/special estates, or a market solution that quietly excludes whoever cannot afford the integration.',
    read: 'Adoption, not architecture, kills cross-government platforms (GOV.UK Verify). A spine the smallest participant cannot afford to join is Verify again — and the estates a federation must serve best (special, AP) are the least able to pay.',
    eli5: 'Big MIS vendors can build the connection. Who pays for the tiny schools and specialist providers — or do they just get left out?',
  },
  {
    id: 'consent',
    question: 'Where does a family’s “no” live?',
    fork: 'An opt-out/objection enforced at source, beside the record it protects, or an opt-out register the centre must remember to consult on every extract, forever.',
    read: 'The NPD has no general opt-out at all; health’s national data opt-out shows both that it is possible and how hard retrofitting one is. In a federation the objection sits with the data; in a central store it is one missed join away from silently failing.',
    eli5: 'If a family objects to their child’s data being used, does that “no” travel with the record, or does one big system have to remember it every single time?',
  },
];
