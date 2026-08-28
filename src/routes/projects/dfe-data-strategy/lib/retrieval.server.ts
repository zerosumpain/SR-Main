// retrieval.server.ts — SERVER-ONLY lexical retrieval over a corpus built at module load
// from this project's own data (pressures, frameworks, legislation, maturity, capabilities,
// postures) plus a few overview chunks. BM25 + domain-synonym expansion. No external calls,
// no embeddings. Bound to this project; uploaded artefacts are NEVER added here.

import { PRESSURES } from '$lib/dfe-data-strategy/pressures';
import { FRAMEWORKS, STRATEGY_THEMES } from '$lib/dfe-data-strategy/frameworks';
import { LEGISLATION, LEGAL_LAYER_META } from '$lib/dfe-data-strategy/legislation';
import { MATURITY_DIMENSIONS } from '$lib/dfe-data-strategy/maturity';
import { CAPABILITY_AREAS } from './capabilities';
import { POSTURE_AXES } from './postures';
import { SECTOR_VOICES, SECTOR_THEMES } from '$lib/dfe-data-strategy/sectorVoices';
import { STRATEGIES, TIER_META } from '$lib/dfe-data-strategy/strategies';
import { POLICY_ENGINE_BRIEF } from '$lib/dfe-data-strategy/policy';
import { COMMITMENTS, DOCUMENTS_BY_ID, STATUS_META, ROLE_META } from './commitments';
import { COMPARATORS } from './comparators';
import { getOpenRouterClient, getEmbeddingModel, hasOpenRouter } from '$lib/llm/keys';

export interface Chunk {
  id: string;
  sourceKey: string;
  sourceType:
    | 'pressure'
    | 'framework'
    | 'legislation'
    | 'maturity'
    | 'capability'
    | 'posture'
    | 'strategy'
    | 'commitment'
    | 'comparator'
    | 'overview';
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

  // the commitments ledger — every white-paper/statutory commitment, with implications
  for (const cm of COMMITMENTS) {
    const doc = DOCUMENTS_BY_ID[cm.docId];
    c.push({
      id: `cm-${cm.id}`,
      sourceKey: `commitment:${cm.theme}`,
      sourceType: 'commitment',
      title: `Commitment: ${cm.title} (${doc?.shortName ?? cm.docId})`,
      url: cm.sourceUrls[0] ?? '/projects/dfe-data-strategy/commitments',
      text: `${cm.title}. ${cm.what} From: ${doc?.title ?? cm.docId}${cm.quote ? ` — "${cm.quote}"` : ''}. Status: ${STATUS_META[cm.status].label}. The department role: ${ROLE_META[cm.dfeRole].label}.${cm.timeframe ? ` Timeframe: ${cm.timeframe}.` : ''} What it means for the strategy: ${cm.strategyImplication}${cm.flows.length ? ` New data flows: ${cm.flows.map((f) => `${f.from} to ${f.to} (${f.what})`).join('; ')}.` : ''}${cm.identifiers.length ? ` Identifiers: ${cm.identifiers.join(', ')}.` : ''}${cm.standards.length ? ` Standards: ${cm.standards.join(', ')}.` : ''}`,
    });
  }

  // comparator strategies — how other departments wrote theirs
  for (const cp of COMPARATORS)
    c.push({
      id: `cmp-${cp.id}`,
      sourceKey: 'comparator',
      sourceType: 'comparator',
      title: `Comparator strategy: ${cp.title} (${cp.org})`,
      url: cp.url,
      text: `${cp.title} — ${cp.org}, ${cp.date}. Sections: ${cp.sections.join('; ')}. Strengths: ${cp.strengths.join('; ')}. Weaknesses: ${cp.weaknesses.join('; ')}. Lesson: ${cp.lesson}`,
    });

  // the influence-map catalogue — every strategy/statute/programme with its verdict
  for (const s of STRATEGIES)
    c.push({
      id: `st-${s.id}`,
      sourceKey: `strategy:${s.tier}`,
      sourceType: 'strategy',
      title: `Strategy: ${s.name} — verdict: ${TIER_META[s.tier].label}`,
      url: s.sourceUrl ?? '/projects/dfe-data-strategy/strategies',
      text: `${s.name} (${s.kind}, status: ${s.status}). Influence-map verdict: ${TIER_META[s.tier].label} — ${TIER_META[s.tier].kicker}. ${s.take} Why it matters to the department: ${s.whyDfE} (relevance ${Math.round(s.relevance * 100)}%, leverage ${Math.round(s.leverage * 100)}%).`,
    });

  // the Policy Engine's data conclusions (the deep-integration source)
  c.push({
    id: 'ov-policy-engine-brief',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'Policy Engine — data conclusions (full brief)',
    url: '/projects/policy-engine/monitor',
    text: POLICY_ENGINE_BRIEF,
  });

  // overview chunks
  c.push({
    id: 'ov-tool',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'About Keystone',
    url: '/projects/dfe-data-strategy',
    text: 'Keystone is an education strategy workbench: a research-grounded decision-support tool that maps the pressures on the education department’s use of data and lets a strategy lead test posture choices and investment trade-offs. It is a transparent rubric, not a numeric forecast. It is a companion to the Policy Engine and The Data Estate.',
  });
  c.push({
    id: 'ov-origins',
    sourceKey: 'overview',
    sourceType: 'overview',
    title: 'The three origins of pressure',
    url: '/projects/dfe-data-strategy/landscape',
    text: 'Pressures on an education data strategy come from three directions: cross-government (National Data Strategy, the CDDO/DSIT digital and data roadmap, AI ambitions, data law, ONS Integrated Data Service); the department’s own policy agenda (the consistent child identifier and data spine, attendance, SEND, NEET, the National Pupil Database); and the partner web (150+ local authorities, thousands of schools and multi-academy trusts, arm’s-length bodies, health and social care, EdTech suppliers).',
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
    text: 'The department-policy pressures are drawn from the Policy Engine field studies: the data spine and consistent child identifier (monitor), multi-agency data-sharing (jigsaw), attendance, SEND and NEET. The strategy is tested against the real data demands the policy modelling surfaced.',
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

function bm25(query: string): Map<number, number> {
  const bag = expand(tokenize(query));
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
  return scores;
}

// ---- semantic layer: a cheap OpenRouter embedding model (openai/text-embedding-3-small).
// The corpus is embedded once (lazily, cached in memory); each query is embedded on demand.
// Fully graceful — any embedding failure falls back to BM25-only so retrieval never breaks. ----
let CORPUS_VECS: number[][] | null = null;
let embedDisabled = false;
let embedInit: Promise<void> | null = null;

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  try {
    const client = getOpenRouterClient();
    const model = getEmbeddingModel();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const res = await client.embeddings.create({ model, input: texts.slice(i, i + 96).map((t) => t.slice(0, 6000)) });
      for (const d of [...res.data].sort((a: any, b: any) => a.index - b.index)) out.push(d.embedding as number[]);
    }
    return out.length === texts.length ? out : null;
  } catch {
    return null;
  }
}

async function ensureCorpusVecs(): Promise<void> {
  if (CORPUS_VECS || embedDisabled) return;
  if (!embedInit) {
    embedInit = (async () => {
      if (!hasOpenRouter()) { embedDisabled = true; return; }
      const v = await embedTexts(CHUNKS.map((c) => `${c.title}. ${c.text}`));
      if (v) CORPUS_VECS = v;
      else embedDisabled = true;
    })();
  }
  await embedInit;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Hybrid retrieval: BM25 + embedding cosine, blended, with a per-source diversity cap.
 *  Async (the query is embedded on demand); falls back to BM25-only if embeddings are off. */
export async function retrieve(query: string, k = 10): Promise<Retrieved[]> {
  const bm = bm25(query);
  await ensureCorpusVecs();

  let cosArr: number[] | null = null;
  if (CORPUS_VECS) {
    const qv = (await embedTexts([query]))?.[0] ?? null;
    if (qv) {
      const raw = CORPUS_VECS.map((v) => cosine(qv, v));
      const mn = Math.min(...raw), span = Math.max(...raw) - mn || 1;
      cosArr = raw.map((c) => (c - mn) / span);
    }
  }
  if (!cosArr && bm.size === 0) return [];

  const maxB = Math.max(1e-9, ...(bm.size ? [...bm.values()] : [0]));
  const final = new Map<number, number>();
  const considered = cosArr ? CHUNKS.map((_, i) => i) : [...bm.keys()];
  for (const d of considered) {
    const b = (bm.get(d) ?? 0) / maxB;
    final.set(d, cosArr ? 0.5 * b + 0.5 * cosArr[d] : b);
  }

  const ranked = [...final.entries()].sort((a, b) => b[1] - a[1]);
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

export const INDEX_META = {
  chunkCount: CHUNKS.length,
  get embeddingsActive() {
    return !!CORPUS_VECS;
  },
};
