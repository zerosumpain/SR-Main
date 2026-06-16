// strategies.ts — the influence catalogue behind the editorial "Influence Map". Every strategy,
// statute, programme and framework in the landscape is positioned on two axes:
//   • relevance — how directly it bears on DfE's data context (does it complement DfE?)
//   • leverage  — how much it should SHAPE the strategy (mandate strength × strategic value)
// and given an editorial verdict (tier) + a punchy take. Scores are reasoned editorial
// judgements, grounded in the keystone-research sources; they are positions, not measurements.

export type StrategyKind = 'statute' | 'mandate' | 'gov-strategy' | 'gov-framework' | 'programme' | 'corporate';
export type Tier = 'shape' | 'borrow' | 'watch' | 'context';

export interface StrategyItem {
  id: string;
  name: string;
  short: string;
  kind: StrategyKind;
  status: string;
  relevance: number; // 0..1
  leverage: number; // 0..1
  tier: Tier;
  take: string; // editorial one-liner
  whyDfE: string;
  sourceUrl: string;
}

export const KIND_META: Record<StrategyKind, { label: string; color: string }> = {
  statute: { label: 'Statute', color: '#8a2d3a' },
  mandate: { label: 'Mandate', color: '#b4632e' },
  'gov-strategy': { label: 'Gov strategy', color: '#3a5fa8' },
  'gov-framework': { label: 'Gov framework', color: '#2f6f97' },
  programme: { label: 'Programme', color: '#2f6155' },
  corporate: { label: 'Industry', color: '#7a5aa6' },
};

export const TIER_META: Record<Tier, { label: string; kicker: string; blurb: string; color: string }> = {
  shape: {
    label: 'Set the course',
    kicker: 'Should heavily influence',
    blurb: 'The statutes, mandates and yardsticks that ought to shape the strategy from the first page. Ignore these and the strategy is non-compliant or irrelevant.',
    color: '#8a2d3a',
  },
  borrow: {
    label: 'Borrow from',
    kicker: 'Adopt selectively',
    blurb: 'Strong patterns, assets and methods to lift into the strategy — on DfE’s own terms. Useful, not binding.',
    color: '#2f6155',
  },
  watch: {
    label: 'Comply & watch',
    kicker: 'Answer to, but don’t follow',
    blurb: 'You must respond to these, and they set the political weather — but they don’t set DfE’s direction. Meet them; don’t be led by them.',
    color: '#b4632e',
  },
  context: {
    label: 'Context only',
    kicker: 'Keep in view',
    blurb: 'Real and worth knowing, but peripheral to a data strategy. Design for them; never build around them.',
    color: 'rgba(28,22,17,0.55)',
  },
};

export const STRATEGIES: StrategyItem[] = [
  // ---------------- SHAPE ----------------
  {
    id: 'cwsa', name: 'Children’s Wellbeing and Schools Act — consistent identifier', short: 'CWSA / child identifier',
    kind: 'statute', status: 'In law (2026 c. 21)', relevance: 0.97, leverage: 0.97, tier: 'shape',
    take: 'The one that rewrites everything. A legal duty to identify and join up every child — build the strategy around it.',
    whyDfE: 'Mandates the Single Unique Identifier (NHS number) and a safeguarding information-sharing duty — the keystone of DfE’s whole data agenda.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2026/21/contents',
  },
  {
    id: 'dma', name: 'Data Maturity Assessment for Government', short: 'DMA for Government',
    kind: 'gov-framework', status: 'Live (2023)', relevance: 0.9, leverage: 0.8, tier: 'shape',
    take: 'The scorecard you’ll be marked against. Use it to prioritise — not to tick boxes.',
    whyDfE: 'The cross-government maturity yardstick. Directly operational: it tells DfE where it is weak and where to invest first.',
    sourceUrl: 'https://www.gov.uk/government/publications/data-maturity-assessment-for-government',
  },
  {
    id: 'duaa', name: 'Data (Use and Access) Act 2025', short: 'DUAA 2025',
    kind: 'statute', status: 'In force (Feb 2026)', relevance: 0.8, leverage: 0.93, tier: 'shape',
    take: 'New rules of the road. A fresh lawful basis and looser automated-decision rules — re-paper the sharing on day one.',
    whyDfE: 'Resets the lawful-basis and access regime DfE’s every data flow stands on, and changes the rules for data-driven decisions.',
    sourceUrl: 'https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes',
  },
  {
    id: 'dea', name: 'Digital Economy Act 2017 (Part 5)', short: 'DEA 2017',
    kind: 'statute', status: 'In law', relevance: 0.86, leverage: 0.8, tier: 'shape',
    take: 'The door you already walk through. The research gateway behind safe access to DfE data — lean on it.',
    whyDfE: 'The principal statutory gateway DfE uses to share de-identified data for research, and a candidate power for wider public-service sharing.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2017/30/part/5',
  },
  {
    id: 'ndl', name: 'National Data Library & Modern Digital Government', short: 'National Data Library',
    kind: 'programme', status: 'Discovery (2026)', relevance: 0.82, leverage: 0.88, tier: 'shape',
    take: 'The centre is building the shop window. Get DfE’s best datasets onto the shelves — AI-ready and linkable.',
    whyDfE: 'DSIT’s flagship for unlocking and linking data for the national missions and AI; the live successor to the National Data Strategy that DfE is expected to feed.',
    sourceUrl: 'https://www.gov.uk/government/publications/national-data-library-progress-update-january-2026/national-data-library-progress-update-january-2026',
  },
  {
    id: 'gdq', name: 'Government Data Quality Framework', short: 'Data Quality Framework',
    kind: 'gov-framework', status: 'Live (2020)', relevance: 0.84, leverage: 0.74, tier: 'shape',
    take: 'No quality, no strategy. DfE’s admin data is only as useful as it is trustworthy.',
    whyDfE: 'Quality is the precondition for every use — analysis, AI, the identifier. The six dimensions are the floor DfE must measure against.',
    sourceUrl: 'https://www.gov.uk/government/publications/the-government-data-quality-framework',
  },

  // ---------------- BORROW ----------------
  {
    id: 'npd', name: 'National Pupil Database & ECHILD linkage', short: 'NPD / ECHILD',
    kind: 'programme', status: 'DfE asset', relevance: 0.88, leverage: 0.62, tier: 'borrow',
    take: 'Crown jewels — handle with care. The richest dataset in government, and the biggest trust risk.',
    whyDfE: 'DfE’s own flagship asset and its proven linkage practice (NPD + hospital + mortality data); the model — and the cautionary tale — for safe reuse.',
    sourceUrl: 'https://www.gov.uk/government/collections/national-pupil-database',
  },
  {
    id: 'ethics', name: 'Data and AI Ethics Framework', short: 'Data & AI Ethics',
    kind: 'gov-framework', status: 'Live (2025)', relevance: 0.8, leverage: 0.66, tier: 'borrow',
    take: 'The licence to operate. With children’s data, trust is the whole game.',
    whyDfE: 'Non-statutory but decisive: it (and the ATRS) is how DfE keeps the social licence that one lost dataset can destroy.',
    sourceUrl: 'https://www.gov.uk/government/publications/data-ethics-framework',
  },
  {
    id: 'dama', name: 'DAMA-DMBOK', short: 'DAMA-DMBOK',
    kind: 'corporate', status: 'Industry standard', relevance: 0.8, leverage: 0.56, tier: 'borrow',
    take: 'The architect’s pattern book. Borrow the operating model; skip the dogma.',
    whyDfE: 'The canonical map of what a data function does. DfE can lift its governance-centred operating model wholesale.',
    sourceUrl: 'https://www.dama.org/cpages/body-of-knowledge',
  },
  {
    id: 'mesh', name: 'Data Mesh', short: 'Data Mesh',
    kind: 'corporate', status: 'Industry pattern', relevance: 0.72, leverage: 0.5, tier: 'borrow',
    take: 'Made for a federated system. Thousands of trusts and councils won’t centralise — let domains own their data.',
    whyDfE: 'The one industry pattern that fits DfE’s reality: domain ownership + federated governance maps onto a sector of autonomous bodies.',
    sourceUrl: 'https://martinfowler.com/articles/data-mesh-principles.html',
  },
  {
    id: 'dcam', name: 'EDM Council DCAM', short: 'DCAM',
    kind: 'corporate', status: 'Industry standard', relevance: 0.6, leverage: 0.52, tier: 'borrow',
    take: 'A deeper MOT. Pair it with the DMA when you need granular capability evidence.',
    whyDfE: 'A finer-grained capability assessment than the DMA — useful where DfE needs evidence-backed scoring of a specific function.',
    sourceUrl: 'https://edmcouncil.org/frameworks/dcam/',
  },

  // ---------------- WATCH ----------------
  {
    id: 'ai-opp', name: 'AI Opportunities Action Plan', short: 'AI Opportunities Plan',
    kind: 'programme', status: 'Active (2025)', relevance: 0.6, leverage: 0.86, tier: 'watch',
    take: 'The political weather. AI is the headline; data is the unglamorous precondition — say so, loudly.',
    whyDfE: 'High-profile and names DfE as a delivery partner, but its data implications are indirect: it raises the stakes on foundations rather than setting them.',
    sourceUrl: 'https://www.gov.uk/government/publications/ai-opportunities-action-plan',
  },
  {
    id: 'data-asset-policy', name: 'Cross-government Data Asset Management Policy', short: 'Data Asset Policy',
    kind: 'mandate', status: 'Mandatory', relevance: 0.66, leverage: 0.72, tier: 'watch',
    take: 'The register you must keep. Inventory the estate, or you can’t govern it.',
    whyDfE: 'Requires DfE and its ALBs to identify, document and annually report their data assets — a compliance task that doubles as useful hygiene.',
    sourceUrl: 'https://www.gov.uk/government/publications/transforming-for-a-digital-future-governments-2022-to-25-roadmap-for-digital-and-data',
  },
  {
    id: 'atrs', name: 'Algorithmic Transparency Recording Standard', short: 'ATRS',
    kind: 'mandate', status: 'Mandatory (2024)', relevance: 0.56, leverage: 0.72, tier: 'watch',
    take: 'Show your working. If DfE scores or sorts children by algorithm, publish how.',
    whyDfE: 'Mandatory for central government: any algorithmic tool in DfE decisions must be recorded and published.',
    sourceUrl: 'https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub',
  },

  // ---------------- CONTEXT ----------------
  {
    id: 'nds', name: 'National Data Strategy (2020)', short: 'National Data Strategy',
    kind: 'gov-strategy', status: 'Superseded operationally', relevance: 0.62, leverage: 0.5, tier: 'context',
    take: 'The founding text — now more reference than route. Cite the pillars; follow the roadmap.',
    whyDfE: 'Still live and worth quoting for its four pillars, but operational ambition has moved to Modern Digital Government and the National Data Library.',
    sourceUrl: 'https://www.gov.uk/government/publications/uk-national-data-strategy/national-data-strategy',
  },
  {
    id: 'cddo-roadmap', name: 'Transforming for a Digital Future (2022–25)', short: 'CDDO 2022–25 roadmap',
    kind: 'gov-strategy', status: 'Largely concluded', relevance: 0.55, leverage: 0.46, tier: 'context',
    take: 'Yesterday’s roadmap. Good lineage; the live work moved on.',
    whyDfE: 'Set the Data Marketplace, API catalogue and standards direction — now carried forward by the 2026 Modern Digital Government roadmap.',
    sourceUrl: 'https://www.gov.uk/government/publications/transforming-for-a-digital-future-governments-2022-to-25-roadmap-for-digital-and-data',
  },
  {
    id: 'ids', name: 'ONS Integrated Data Service', short: 'ONS IDS',
    kind: 'programme', status: 'Winding down (closes Mar 2026)', relevance: 0.5, leverage: 0.32, tier: 'context',
    take: 'The route that’s closing. Don’t anchor to it — back the Secure Research Service instead.',
    whyDfE: 'The IDS programme is closing after a RED delivery rating; the durable cross-government sharing route for DfE is the retained ONS Secure Research Service.',
    sourceUrl: 'https://www.gov.uk/government/publications/integrated-data-service',
  },
  {
    id: 'foi-eir', name: 'FOI 2000 & Environmental Information Regs 2004', short: 'FOI / EIR',
    kind: 'statute', status: 'Always on', relevance: 0.45, leverage: 0.4, tier: 'context',
    take: 'Always on, rarely strategic. Design for disclosure; don’t build the strategy around it.',
    whyDfE: 'A standing access obligation that shapes what must be disclosable, but not a force that should direct the data strategy.',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2000/36/contents',
  },
  {
    id: 'cdmc', name: 'Cloud Data Management Capabilities (CDMC)', short: 'CDMC',
    kind: 'corporate', status: 'Industry standard', relevance: 0.42, leverage: 0.46, tier: 'context',
    take: 'For when you’re cloud-deep. A control set, not a compass.',
    whyDfE: 'Valuable once DfE is managing sensitive data at scale in cloud — but a control framework, not a strategy driver.',
    sourceUrl: 'https://edmcouncil.org/frameworks/cdmc/',
  },
  {
    id: 'fabric', name: 'Data Fabric', short: 'Data Fabric',
    kind: 'corporate', status: 'Industry pattern', relevance: 0.46, leverage: 0.42, tier: 'context',
    take: 'Plumbing, not policy. The metadata layer that makes mesh work.',
    whyDfE: 'A useful connective-technology pattern that complements data mesh — an implementation detail, not a strategic choice.',
    sourceUrl: 'https://www.gartner.com/en/information-technology/glossary/data-fabric',
  },
];

export const STRATEGIES_BY_TIER: Record<Tier, StrategyItem[]> = {
  shape: STRATEGIES.filter((s) => s.tier === 'shape'),
  borrow: STRATEGIES.filter((s) => s.tier === 'borrow'),
  watch: STRATEGIES.filter((s) => s.tier === 'watch'),
  context: STRATEGIES.filter((s) => s.tier === 'context'),
};

export const TIER_ORDER: Tier[] = ['shape', 'borrow', 'watch', 'context'];
