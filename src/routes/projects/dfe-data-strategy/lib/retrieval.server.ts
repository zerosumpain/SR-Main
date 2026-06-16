// retrieval.server.ts — SERVER-ONLY lexical retrieval over a corpus built at module load
// from this project's own data (pressures, frameworks, legislation, maturity, capabilities,
// postures) plus a few overview chunks. BM25 + domain-synonym expansion. No external calls,
// no embeddings. Bound to this project; uploaded artefacts are NEVER added here.

import { PRESSURES } from './pressures';
import { FRAMEWORKS, STRATEGY_THEMES } from './frameworks';
import { LEGISLATION, LEGAL_LAYER_META } from './legislation';
import { MATURITY_DIMENSIONS } from './maturity';
import { CAPABILITY_AREAS } from './capabilities';
import { POSTURE_AXES } from './postures';
import { SECTOR_VOICES, SECTOR_THEMES } from './sectorVoices';

export interface Chunk {
  id: string;
  sourceKey: string;
  sourceType: 'pressure' | 'framework' | 'legislation' | 'maturity' | 'capability' | 'posture' | 'overview';
  title: string;
  url: string | null;
  text: string;
}
export interface Retrieved extends Chunk {
  score: number;
}

function buildCorpus(): Chunk[] {
  const c: Chunk[] = [];
  for (const p of PRESSURES)
    c.push({
      id: `pr-${p.id}`,
      sourceKey: `pressure:${p.origin}`,
      sourceType: 'pressure',
      title: `Pressure: ${p.title}`,
      url: p.sourceUrl ?? null,
      text: `${p.title}. ${p.description} This pressure comes from ${p.origin}. It demands the capabilities: ${p.demands.join(', ')}. Severity ${p.severity}/5, urgency ${p.urgency}/5. Source: ${p.sourceName ?? ''}.`,
    });
  for (const f of FRAMEWORKS)
    c.push({
      id: `fw-${f.id}`,
      sourceKey: `framework:${f.type}`,
      sourceType: 'framework',
      title: `Framework: ${f.name}`,
      url: f.sourceUrl ?? null,
      text: `${f.name} (${f.type === 'uk-gov' ? 'UK government' : 'corporate'} framework). ${f.summary} Key elements: ${f.keyElements.join('; ')}.`,
    });
  for (const l of LEGISLATION)
    c.push({
      id: `lg-${l.id}`,
      sourceKey: 'legislation',
      sourceType: 'legislation',
      title: `Law: ${l.name}`,
      url: l.sourceUrl ?? null,
      text: `${l.name}${l.citation ? ` (${l.citation})` : ''}. Layer: ${LEGAL_LAYER_META[l.layer]?.name}. ${l.summary} Relevance: ${l.relevance}`,
    });
  for (const d of MATURITY_DIMENSIONS)
    c.push({
      id: `mt-${d.id}`,
      sourceKey: 'maturity',
      sourceType: 'maturity',
      title: `Maturity dimension: ${d.name}`,
      url: null,
      text: `${d.name}. ${d.description} Driven by the capabilities: ${d.areas.join(', ')}. ${d.govSource ?? ''}. Corporate crosswalk: ${d.corporateCrosswalk ?? ''}.`,
    });
  for (const a of CAPABILITY_AREAS)
    c.push({
      id: `cap-${a.id}`,
      sourceKey: 'capability',
      sourceType: 'capability',
      title: `Capability: ${a.name}`,
      url: null,
      text: `${a.name}. ${a.description}`,
    });
  for (const ax of POSTURE_AXES)
    c.push({
      id: `po-${ax.id}`,
      sourceKey: 'posture',
      sourceType: 'posture',
      title: `Posture: ${ax.leftLabel} vs ${ax.rightLabel}`,
      url: null,
      text: `Strategic posture axis: ${ax.leftLabel} versus ${ax.rightLabel}. ${ax.description} The tension: ${ax.tension}`,
    });
  for (const t of STRATEGY_THEMES)
    c.push({
      id: `th-${t.title.replace(/\W+/g, '-').toLowerCase()}`,
      sourceKey: 'theme',
      sourceType: 'framework',
      title: `Theme: ${t.title}`,
      url: null,
      text: `${t.title}. ${t.blurb} A theme every mature data strategy should cover.`,
    });
  for (const t of SECTOR_THEMES)
    c.push({
      id: `svt-${t.id}`,
      sourceKey: 'sector-theme',
      sourceType: 'overview',
      title: `Sector debate: ${t.title}`,
      url: '/projects/dfe-data-strategy/sector',
      text: `${t.title}. ${t.summary}`,
    });
  for (const v of SECTOR_VOICES)
    c.push({
      id: `svv-${v.id}`,
      sourceKey: `sector:${v.group}`,
      sourceType: 'overview',
      title: `Sector voice — ${v.who} (${v.stance})`,
      url: v.sourceUrl ?? '/projects/dfe-data-strategy/sector',
      text: `${v.who} (${v.group}, ${v.stance}): ${v.point}`,
    });

  // overview chunks
  c.push({
    id: 'ov-tool',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'About Keystone',
    url: '/projects/dfe-data-strategy',
    text: 'Keystone is a DfE data-strategy workbench: a research-grounded decision-support tool that maps the pressures on the Department for Education’s use of data and lets a strategy lead test posture choices and investment trade-offs. It is a transparent rubric, not a numeric forecast. It is a companion to the Policy Engine and The Data Estate.',
  });
  c.push({
    id: 'ov-origins',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'The three origins of pressure',
    url: '/projects/dfe-data-strategy/landscape',
    text: 'Pressures on a DfE data strategy come from three directions: cross-government (National Data Strategy, the CDDO/DSIT digital and data roadmap, AI ambitions, data law, ONS Integrated Data Service); DfE’s own policy agenda (the consistent child identifier and data spine, attendance, SEND, NEET, the National Pupil Database); and the partner web (150+ local authorities, thousands of schools and multi-academy trusts, arm’s-length bodies, health and social care, EdTech suppliers).',
  });
  c.push({
    id: 'ov-engine',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'How the alignment engine scores a strategy',
    url: '/projects/dfe-data-strategy/method',
    text: 'The alignment engine turns posture and allocation levers into a capability strength per area (saturating, posture-modulated), then scores pressure coverage (severity-weighted), maturity progress, strategic tensions (incoherent or under-resourced or legally risky combinations), the legislation implicated, and a recommended focus. Everything is deterministic and traceable.',
  });
  c.push({
    id: 'ov-policy-engine',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'Link to the Policy Engine',
    url: '/projects/policy-engine/monitor',
    text: 'The DfE-policy pressures are drawn from the Policy Engine field studies: the data spine and consistent child identifier (monitor), multi-agency data-sharing (jigsaw), attendance, SEND and NEET. The strategy is tested against the real data demands the policy modelling surfaced.',
  });
  return c;
}

const CHUNKS = buildCorpus();

const STOP = new Set(['the','a','an','and','or','of','to','in','on','for','is','are','was','were','be','by','with','as','at','it','its','this','that','these','those','from','into','than','then','but','not','no','do','does','how','what','why','when','where','which','who','whom','can','could','would','should','will','about','i','you','we','they','our','your']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

const SYNONYMS: Record<string, string[]> = {
  pressure: ['demand', 'force', 'driver'],
  strategy: ['plan', 'approach', 'roadmap'],
  data: ['information', 'datasets', 'records'],
  sharing: ['share', 'exchange', 'linkage', 'data sharing', 'interoperability'],
  identifier: ['child identifier', 'consistent', 'unique', 'id', 'matching', 'spine'],
  spine: ['data spine', 'backbone', 'identifier', 'monitor'],
  governance: ['ownership', 'stewardship', 'accountability', 'operating model', 'cdo'],
  quality: ['data quality', 'accuracy', 'completeness', 'fitness'],
  ethics: ['trust', 'transparency', 'atrs', 'privacy', 'fairness', 'data ethics'],
  interoperability: ['standards', 'apis', 'reference data', 'master data', 'metadata'],
  maturity: ['data maturity', 'capability', 'dma', 'assessment'],
  ai: ['artificial intelligence', 'machine learning', 'algorithm', 'opportunities'],
  legal: ['law', 'legislation', 'gateway', 'lawful basis', 'gdpr', 'vires', 'power'],
  gdpr: ['data protection', 'dpa', 'lawful basis', 'article 6'],
  dea: ['digital economy act', 'gateway', 'data sharing power'],
  send: ['ehcp', 'special educational needs', 'high needs'],
  neet: ['participation', 'youth', 'not in education'],
  attendance: ['absence', 'daily attendance'],
  partners: ['local authorities', 'councils', 'multi-academy trusts', 'mat', 'schools', 'agencies'],
  npd: ['national pupil database', 'pupil data', 'researcher access'],
  centralise: ['central', 'platform', 'consolidate'],
  federate: ['federated', 'data mesh', 'domain', 'decentralised'],
};

const K1 = 1.5,
  B = 0.75;
const docTokens = CHUNKS.map((c) => tokenize(`${c.title} ${c.text}`));
const titleSets = CHUNKS.map((c) => new Set(tokenize(c.title)));
const docLen = docTokens.map((t) => t.length);
const avgdl = docLen.reduce((s, l) => s + l, 0) / Math.max(1, docLen.length);
const df = new Map<string, number>();
const postings = new Map<string, Array<[number, number]>>();
docTokens.forEach((toks, d) => {
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  for (const [t, f] of tf) {
    df.set(t, (df.get(t) ?? 0) + 1);
    if (!postings.has(t)) postings.set(t, []);
    postings.get(t)!.push([d, f]);
  }
});
const N = CHUNKS.length;
const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));

function expand(tokens: string[]): Map<string, number> {
  const bag = new Map<string, number>();
  for (const t of tokens) bag.set(t, Math.max(bag.get(t) ?? 0, 1));
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const phrase of syns) for (const st of tokenize(phrase)) bag.set(st, Math.max(bag.get(st) ?? 0, 0.5));
  }
  return bag;
}

export function retrieve(query: string, k = 10): Retrieved[] {
  const bag = expand(tokenize(query));
  if (bag.size === 0) return [];
  const scores = new Map<number, number>();
  for (const [term, w] of bag) {
    const plist = postings.get(term);
    if (!plist) continue;
    const termIdf = idf(term);
    for (const [d, f] of plist) {
      const denom = f + K1 * (1 - B + (B * docLen[d]) / avgdl);
      let s = w * termIdf * ((f * (K1 + 1)) / denom);
      if (titleSets[d].has(term)) s *= 1.6;
      scores.set(d, (scores.get(d) ?? 0) + s);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const perSource = new Map<string, number>();
  const out: Retrieved[] = [];
  for (const [d, score] of ranked) {
    const c = CHUNKS[d];
    const n = perSource.get(c.sourceKey) ?? 0;
    if (n >= 4) continue;
    perSource.set(c.sourceKey, n + 1);
    out.push({ ...c, score });
    if (out.length >= k) break;
  }
  return out;
}

export const INDEX_META = { chunkCount: CHUNKS.length };
