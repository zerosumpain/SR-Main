// retrieval.server.ts — SERVER-ONLY lexical retrieval for the project's Ask-the-model
// chat. Unlike policy-engine's prebuilt JSON index, this project's corpus is small
// enough to assemble at module load directly from the typed content constants —
// no build step, always in sync with the page content. BM25 + synonym expansion,
// pattern copied from policy-engine/lib/retrieval.server.ts. Self-contained.

import { QUOTES, STATUS, LAYERS, SPINE_VS_ID, TIMELINE } from './spine';
import { ARCHETYPES, PRECEDENTS } from './precedents';
import { PERSONAS } from './personas';
import { LEDGER } from './valueLedger';
import { SERVICES, OPERATIONAL_SHIFT } from './operational';
import { TRUST_EVENTS, LEGAL, PETS, PLAYBOOK, SYNTHESIS } from './governance';

export interface Chunk {
  id: string;
  sourceKey: string;
  sourceType: 'concept' | 'precedent' | 'persona' | 'ledger' | 'governance' | 'operational';
  title: string;
  url: string | null;
  text: string;
}
export interface Retrieved extends Chunk { score: number }

// ---- assemble the corpus from the content constants ----
function buildChunks(): Chunk[] {
  const out: Chunk[] = [];
  const add = (c: Chunk) => out.push(c);

  add({ id: 'status', sourceKey: 'spine', sourceType: 'concept', title: 'Status of the data spine', url: QUOTES[0].url, text: `${STATUS.headline}. ${STATUS.detail} Verbatim commitments: ${QUOTES.map((q) => `"${q.text}" (${q.who}, ${q.where}, ${q.date})`).join(' | ')}` });
  for (const l of LAYERS) add({ id: `layer-${l.id}`, sourceKey: 'anatomy', sourceType: 'concept', title: `Spine layer ${l.no}: ${l.name}`, url: null, text: `${l.question} TODAY: ${l.today} WITH A SPINE: ${l.withSpine}` });
  add({ id: 'spine-vs-id', sourceKey: 'spine', sourceType: 'concept', title: 'Spine vs consistent identifier', url: null, text: `${SPINE_VS_ID.intro} SPINE: ${SPINE_VS_ID.spine.what} Basis: ${SPINE_VS_ID.spine.basis} Status: ${SPINE_VS_ID.spine.status} IDENTIFIER: ${SPINE_VS_ID.identifier.what} Basis: ${SPINE_VS_ID.identifier.basis} Status: ${SPINE_VS_ID.identifier.status}` });
  for (const t of TIMELINE) add({ id: `tl-${t.year}-${t.title.slice(0, 12)}`, sourceKey: 'timeline', sourceType: 'concept', title: `${t.date}: ${t.title}`, url: t.url ?? null, text: t.detail });
  for (const a of ARCHETYPES) add({ id: `arch-${a.id}`, sourceKey: 'archetypes', sourceType: 'precedent', title: `Archetype: ${a.name}`, url: null, text: `${a.short} ${a.how} Strengths: ${a.strengths.join('; ')}. Weaknesses: ${a.weaknesses.join('; ')}. Record: ${a.record}` });
  for (const p of PRECEDENTS) add({ id: `prec-${p.id}`, sourceKey: `precedent-${p.id}`, sourceType: 'precedent', title: `${p.name} (${p.where})`, url: p.url, text: `${p.what} Scale: ${p.scale}. Fate: ${p.fate}. Lesson: ${p.lesson}` });
  for (const p of PERSONAS) add({ id: `persona-${p.id}`, sourceKey: `persona-${p.id}`, sourceType: 'persona', title: `Perspective: ${p.label}`, url: null, text: `${p.who} Stake: ${p.stake} Wants: ${p.wants.join('; ')}. Fears: ${p.fears.join('; ')}. The spine they want: ${p.spineTheyWant} Verdict: ${p.verdict} (Grounding: ${p.grounding})` });
  for (const e of LEDGER) add({ id: `ledger-${e.id}`, sourceKey: 'ledger', sourceType: 'ledger', title: `${e.side === 'pro' ? 'Benefit' : 'Risk'}: ${e.title}`, url: e.sourceUrl ?? null, text: `${e.detail} (Confidence: ${e.confidence}.)` });
  for (const s of SERVICES) add({ id: `svc-${s.id}`, sourceKey: 'operational', sourceType: 'operational', title: `Service: ${s.name} (${s.status})`, url: s.url ?? null, text: `${s.what} Spine role: ${s.spineRole}` });
  add({ id: 'op-shift', sourceKey: 'operational', sourceType: 'operational', title: OPERATIONAL_SHIFT.title, url: null, text: OPERATIONAL_SHIFT.prose.join(' ') });
  for (const t of TRUST_EVENTS) add({ id: `trust-${t.id}`, sourceKey: 'trust', sourceType: 'governance', title: `Trust ledger: ${t.title} (${t.year})`, url: t.url ?? null, text: `${t.what} Why it matters: ${t.why}` });
  for (const l of LEGAL) add({ id: `legal-${l.id}`, sourceKey: 'legal', sourceType: 'governance', title: `Legal: ${l.name}`, url: l.url ?? null, text: `${l.what} Spine relevance: ${l.spineRelevance}` });
  for (const p of PETS) add({ id: `pet-${p.id}`, sourceKey: 'pets', sourceType: 'governance', title: `Privacy technique: ${p.name}`, url: p.url ?? null, text: `${p.what} Precedent: ${p.precedent} Maturity: ${p.maturity}.` });
  for (const d of PLAYBOOK) for (const o of d.options)
    add({ id: `play-${d.id}-${o.id}`, sourceKey: 'playbook', sourceType: 'governance', title: `Design choice — ${d.title}: ${o.label}`, url: null, text: `${o.detail} Consequence: ${o.consequence} Precedent: ${o.precedent}` });
  add({ id: 'synthesis', sourceKey: 'synthesis', sourceType: 'governance', title: SYNTHESIS.title, url: null, text: SYNTHESIS.points.join(' ') });
  return out;
}

const CHUNKS: Chunk[] = buildChunks();

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'by', 'with', 'as', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'from', 'into', 'than', 'then', 'but', 'not', 'no', 'do', 'does', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'can', 'could', 'would', 'should', 'will', 'about', 'i', 'you', 'we', 'they', 'he', 'she', 'me', 'my', 'our', 'your']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

const SYNONYMS: Record<string, string[]> = {
  spine: ['backbone', 'infrastructure', 'plumbing', 'locator', 'exchange'],
  identifier: ['sui', 'nhs number', 'upn', 'uln', 'consistent', 'unique', 'number'],
  sui: ['single unique identifier', 'consistent identifier', 'nhs number', 'wigan'],
  nhs: ['health', 'pds', 'spine', 'number'],
  privacy: ['governance', 'gdpr', 'ico', 'pet', 'pseudonymisation', 'transparency', 'consent'],
  safeguarding: ['climbie', 'mash', 'child protection', 'cp-is', 'encompass', 'serious case'],
  census: ['collect', 'termly', 'burden', 'returns', 'collection'],
  attendance: ['daily', 'wonde', 'feed', 'absence'],
  research: ['npd', 'leo', 'srs', 'tre', 'linkage', 'adr', 'epi', 'datalab'],
  trust: ['ico', 'audit', 'breach', 'mou', 'contactpoint', 'trustopia', 'scandal'],
  vendor: ['mis', 'arbor', 'sims', 'bromcom', 'wonde', 'groupcall', 'broker', 'market'],
  parents: ['families', 'privacy', 'defenddigitalme', 'transparency', 'rights'],
  council: ['la', 'local authority', 'children services', 'mash'],
  mat: ['academy', 'multi-academy', 'trust data', 'burden'],
  academy: ['mat', 'multi-academy', 'trust data'],
  estonia: ['x-road', 'xroad', 'federated'],
  architecture: ['archetype', 'custody', 'store', 'locator', 'federated', 'central'],
  fsm: ['free school meals', 'eligibility', 'auto-enrolment', 'dwp', 'entitlement'],
  law: ['legal', 'cwsa', 'gdpr', 'duaa', 'act', 'statute', 'regulations', 'gateway'],
};

const K1 = 1.5, B = 0.75;
const docTokens: string[][] = CHUNKS.map((c) => tokenize(`${c.title} ${c.text}`));
const titleTokenSets: Set<string>[] = CHUNKS.map((c) => new Set(tokenize(c.title)));
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

/** Top-k corpus chunks for a query (BM25 + synonyms + title boost + per-source diversity cap). */
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
      if (titleTokenSets[d].has(term)) s *= 1.6;
      scores.set(d, (scores.get(d) ?? 0) + s);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const perSource = new Map<string, number>();
  const out: Retrieved[] = [];
  for (const [d, score] of ranked) {
    const c = CHUNKS[d];
    const n = perSource.get(c.sourceKey) ?? 0;
    if (n >= 3) continue;
    perSource.set(c.sourceKey, n + 1);
    out.push({ ...c, score });
    if (out.length >= k) break;
  }
  return out;
}
