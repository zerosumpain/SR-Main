// retrieval.server.ts — SERVER-ONLY lexical retrieval over the shipped project corpus index.
// BM25 + domain-synonym query expansion. No external calls, no DB, no embeddings — fully local,
// fast over ~1k chunks. The `.server.ts` suffix means SvelteKit forbids importing this (or the
// 1.4MB index) into client code. Bound to this project only. Self-contained.

import indexData from './corpusIndex.json';

export interface Chunk {
  id: string;
  sourceKey: string;
  sourceType: 'project' | 'research' | 'policy-doc';
  title: string;
  url: string | null;
  text: string;
}
export interface Retrieved extends Chunk { score: number }

const CHUNKS: Chunk[] = (indexData as any).chunks as Chunk[];
export const INDEX_META = {
  generatedAt: (indexData as any).generatedAt as string,
  chunkCount: (indexData as any).chunkCount as number,
  keystone: (indexData as any).keystone as { key: string; title: string; url: string }[],
  coverage: (indexData as any).coverage as { key: string; status: string; reason?: string }[],
};

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'by', 'with', 'as', 'at', 'it', 'its', 'this', 'that', 'these', 'those', 'from', 'into', 'than', 'then', 'but', 'not', 'no', 'do', 'does', 'how', 'what', 'why', 'when', 'where', 'which', 'who', 'whom', 'can', 'could', 'would', 'should', 'will', 'about', 'i', 'you', 'we', 'they', 'he', 'she', 'me', 'my', 'our', 'your']);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2 && !STOP.has(t));
}

// Domain-synonym expansion bridges the vocabulary gap that pure lexical retrieval suffers from
// (a user types "special needs", the corpus says "SEND/EHCP"). Keys & values are single tokens or
// short phrases (phrases are tokenised). Bidirectional-ish: each present trigger adds its partners.
const SYNONYMS: Record<string, string[]> = {
  send: ['ehcp', 'special', 'educational', 'needs', 'inclusion', 'high needs', 'tribunal'],
  ehcp: ['send', 'plan', 'education health care', 'high needs'],
  special: ['send', 'ehcp', 'needs'],
  neet: ['not in employment', 'youth unemployment', 'inactive', 'post-16', 'milburn', 'youth guarantee'],
  gcse: ['ks4', 'attainment8', 'attainment 8', 'grade 5', 'age 16'],
  ks4: ['gcse', 'attainment8', 'attainment 8', 'age 16'],
  attainment8: ['gcse', 'ks4', 'attainment 8'],
  primary: ['ks2', 'age 11', 'reading writing maths'],
  ks2: ['primary', 'age 11'],
  childcare: ['early years', 'eyfs', 'nursery', 'gld', '30 hours', 'eypp', 'best start'],
  nursery: ['early years', 'eyfs', 'childcare', 'gld'],
  eyfs: ['early years', 'gld', 'good level of development', 'reception'],
  toddler: ['early years', 'two-year-old', 'gld'],
  gld: ['good level of development', 'early years', 'reception', 'school readiness'],
  attendance: ['absence', 'persistent absence', 'severe absence', 'truancy', 'mentors'],
  absence: ['attendance', 'persistent absence', 'truancy'],
  truancy: ['attendance', 'absence', 'fines'],
  deprivation: ['idaci', 'disadvantage', 'fsm', 'pupil premium', 'poverty'],
  disadvantage: ['fsm', 'pupil premium', 'idaci', 'poverty', 'gap'],
  poverty: ['fsm', 'disadvantage', 'child poverty', 'idaci'],
  poorer: ['disadvantaged', 'fsm', 'pupil premium', 'deprivation'],
  money: ['funding', 'spending', 'budget', 'cost'],
  funding: ['money', 'spending', 'budget', 'per pupil', 'high needs', 'dsg'],
  teachers: ['workforce', 'recruitment', 'retention', 'capacity', 'pay', 'bursaries'],
  gap: ['disadvantage gap', 'epi', 'months'],
  region: ['regions', 'regional', 'north east', 'coastal', 'london', 'place'],
  mentalhealth: ['camhs', 'wellbeing', 'inactive health', 'milburn'],
  data: ['monitoring', 'measurement', 'spine', 'echild', 'npd', 'estate'],
  cost: ['funding', 'spending', 'value', 'cost-effectiveness'],
  curriculum: ['francis', 'standards', 'reading', 'oracy'],
  jigsaw: ['safeguarding', 'data sharing', 'multi-agency', 'csprp'],
};

// ---- build the BM25 index once at module load ----
const K1 = 1.5, B = 0.75;
const docTokens: string[][] = CHUNKS.map((c) => tokenize(`${c.title} ${c.text}`));
const titleTokenSets: Set<string>[] = CHUNKS.map((c) => new Set(tokenize(c.title)));
const docLen = docTokens.map((t) => t.length);
const avgdl = docLen.reduce((s, l) => s + l, 0) / Math.max(1, docLen.length);
const df = new Map<string, number>();
const postings = new Map<string, Array<[number, number]>>(); // term -> [docIdx, tf]
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
  // weighted query bag: original terms weight 1, synonym-expansions weight 0.5
  const bag = new Map<string, number>();
  for (const t of tokens) bag.set(t, Math.max(bag.get(t) ?? 0, 1));
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const phrase of syns) for (const st of tokenize(phrase)) bag.set(st, Math.max(bag.get(st) ?? 0, 0.5));
  }
  return bag;
}

/** Retrieve the top-k corpus chunks for a query (BM25 + synonym expansion + title boost + per-source diversity cap). */
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
      if (titleTokenSets[d].has(term)) s *= 1.6; // boost matches in the chunk's source title
      scores.set(d, (scores.get(d) ?? 0) + s);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  // diversity: at most 3 chunks per source so one big document can't dominate
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
