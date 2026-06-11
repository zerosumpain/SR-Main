#!/usr/bin/env node
// policy-engine-ingest.mjs — builds the RAG corpus index for the project-bound "Ask the model"
// chat. Pure Node (no API key, no DB): reads the project's own captured content + fetches the
// curated keystone policy documents, chunks everything, and writes a shipped index JSON that the
// runtime loads for lexical (BM25) retrieval. Run: `node scripts/policy-engine-ingest.mjs`.
//
// Deliberately self-contained and offline-first: the project corpus always indexes; keystone
// fetches are best-effort (skip-and-log on failure) since the project content already summarises
// every source with a link.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const ROOT = process.cwd();
const PE = 'src/routes/projects/policy-engine';
const OUT = join(ROOT, PE, 'lib', 'corpusIndex.json');

// ---------------------------------------------------------------------------
// 1 — the project's own captured content (always available, the core corpus)
// ---------------------------------------------------------------------------
const PROJECT_FILES = [
  // data dossiers
  ['lib/sendIntel.ts', 'SEND — case study data'],
  ['lib/jigsawIntel.ts', 'Jigsaw — multi-agency data-sharing case study'],
  ['lib/earlyYearsIntel.ts', 'Early Years (0–5) — case study data'],
  ['lib/monitorIntel.ts', 'Monitoring / the data spine — case study data'],
  ['lib/attendanceIntel.ts', 'Attendance — case study data'],
  ['lib/regionsIntel.ts', 'Regions — case study data'],
  ['lib/populationIntel.ts', 'Population — case study data'],
  ['lib/globalIntel.ts', 'Global comparators — case study data'],
  ['lib/neet.ts', 'NEET — case study data'],
  ['lib/memo.ts', 'The Memo — cross-study synthesis'],
  ['lib/triage.ts', 'NEET triage simulator — logic & data'],
  ['lib/uplift.ts', 'NEET uplift modelling — logic & data'],
  // model configuration & evidence
  ['lib/levers.ts', 'Policy levers — definitions, evidence & sources'],
  ['lib/params.ts', 'Model parameters — calibration, sources & confidence'],
  ['lib/outcomes.ts', 'Outcomes — definitions'],
  ['lib/stories.ts', 'Field Study mastheads — themes & data-asks'],
  ['lib/themes.ts', 'Cross-cutting themes — the second spine'],
  ['lib/evidence.ts', 'Third-party analyses registry'],
  ['lib/contradictions.ts', 'Contested findings — the two-camps registry'],
  ['lib/sources.ts', 'Source bibliography'],
  ['lib/measurement.ts', 'Measurement layer — how outcomes would be tracked'],
  ['lib/dataestate.ts', 'The data estate — instruments map'],
  ['lib/monitoring.ts', 'Monitoring instruments'],
  ['lib/summaries.ts', 'Chart summaries'],
  ['lib/scenarios.ts', 'Scenario presets'],
  ['lib/comparators.ts', 'International comparators dataset'],
  ['lib/regions.ts', 'Regional re-basing — offsets & notes'],
  // methodology-bearing components
  ['components/Methodology.svelte', 'How it works — methodology, equations, assumptions, limitations'],
  ['components/CausalFlow.svelte', 'The causal-flow diagram — relationships & mechanisms'],
  ['components/CalcViewer.svelte', 'Live calculation viewer — the worked equations'],
  // page prose
  ['+page.svelte', 'Overview — landing page'],
  ['outcomes/+page.svelte', 'The Briefing — state of the system'],
  ['regions/+page.svelte', 'Regions — page prose'],
  ['population/+page.svelte', 'Population — page prose'],
  ['global/+page.svelte', 'Global — page prose'],
  ['monitor/+page.svelte', 'Monitoring — page prose'],
  ['neet/+page.svelte', 'NEET — page prose'],
  ['early-years/+page.svelte', 'Early Years — page prose'],
  ['send/+page.svelte', 'SEND — page prose'],
  ['attendance/+page.svelte', 'Attendance — page prose'],
  ['jigsaw/+page.svelte', 'Jigsaw — page prose'],
  ['themes/+page.svelte', 'Themes — page prose'],
  ['memo/+page.svelte', 'The Memo — page prose'],
];

const DOC_FILES = [
  ['docs/policy-engine-research/01-milburn-social-mobility.md', 'Research dossier — Milburn / social mobility'],
  ['docs/policy-engine-research/02-send-ehcp.md', 'Research dossier — SEND / EHCP'],
  ['docs/policy-engine-research/03-cwsa-attendance-workforce-earlyyears.md', 'Research dossier — CWSA / attendance / workforce / early years'],
  ['docs/policy-engine-research/04-white-paper-curriculum-ofsted.md', 'Research dossier — White Paper / curriculum / Ofsted'],
  ['docs/superpowers/specs/2026-06-10-policy-engine-realignment-design.md', 'Design spec — realignment'],
  ['docs/superpowers/specs/2026-06-06-education-policy-engine-design.md', 'Design spec — original'],
];

// ---------------------------------------------------------------------------
// 2 — curated KEYSTONE policy documents (the docs the model is calibrated to).
// HTML URLs preferred for reliable extraction; best-effort, skip-and-log on failure.
// ---------------------------------------------------------------------------
const KEYSTONE = [
  { key: 'white-paper', title: 'Schools White Paper — Every Child Achieving and Thriving (DfE)', url: 'https://www.gov.uk/government/publications/a-childs-life-changing-education-every-child-achieving-and-thriving' },
  { key: 'francis-review', title: 'Curriculum and Assessment (Francis) Review — final report (DfE)', url: 'https://www.gov.uk/government/publications/curriculum-and-assessment-review-final-report' },
  { key: 'best-start', title: 'Giving Every Child the Best Start in Life (DfE strategy)', url: 'https://www.gov.uk/government/publications/giving-every-child-the-best-start-in-life' },
  { key: 'nao-send', title: 'NAO — Support for children and young people with SEN', url: 'https://www.nao.org.uk/reports/support-for-children-and-young-people-with-special-educational-needs/' },
  { key: 'epi-annual', title: 'EPI — Annual Report (disadvantage gap)', url: 'https://epi.org.uk/annual-report-2025-disadvantage/' },
  { key: 'ifs-spending', title: 'IFS — Annual report on education spending in England', url: 'https://ifs.org.uk/publications/annual-report-education-spending-england-2025-26' },
  { key: 'nfer-tlm', title: 'NFER — Teacher Labour Market in England', url: 'https://www.nfer.ac.uk/publications/teacher-labour-market-in-england-annual-report-2025/' },
  { key: 'eef-toolkit', title: 'EEF — Teaching and Learning Toolkit', url: 'https://educationendowmentfoundation.org.uk/education-evidence/teaching-learning-toolkit' },
  { key: 'eef-ey', title: 'EEF — Early Years Toolkit', url: 'https://educationendowmentfoundation.org.uk/education-evidence/early-years-toolkit' },
  { key: 'epi-neet', title: 'EPI — Five charts on the rise in NEET rates', url: 'https://epi.org.uk/publications-and-research/five-charts-that-explain-the-rise-in-neet-rates/' },
  { key: 'suttontrust-ey', title: 'Sutton Trust — A Fair Start? (early years access)', url: 'https://www.suttontrust.com/our-research/a-fair-start-equalising-access-to-early-education/' },
  { key: 'localtrust', title: 'Local Trust — Left-behind neighbourhoods', url: 'https://localtrust.org.uk/policy/left-behind-neighbourhoods/' },
  { key: 'commons-childcare', title: 'House of Commons Library — Expanding government-funded childcare', url: 'https://commonslibrary.parliament.uk/research-briefings/cbp-10288/' },
  { key: 'gatsby', title: 'Gatsby — Good career guidance prevents NEET', url: 'https://www.gatsbybenchmarks.org.uk/news/good-career-guidance-prevents-6000-young-people-becoming-neet-each-year/' },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function stripSvelteStyle(s) {
  // CSS is pure noise for retrieval; keep script + template (where the prose lives)
  return s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
}
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function chunkText(text, { size = 1500, overlap = 200 } = {}) {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      // prefer a paragraph or sentence boundary near the end
      const slice = clean.slice(i, end);
      const para = slice.lastIndexOf('\n\n');
      const sent = slice.lastIndexOf('. ');
      const cut = para > size * 0.5 ? para : sent > size * 0.5 ? sent + 1 : -1;
      if (cut > 0) end = i + cut;
    }
    chunks.push(clean.slice(i, end).trim());
    i = end - overlap;
    if (i < 0) i = 0;
    if (end >= clean.length) break;
  }
  return chunks.filter((c) => c.length > 40);
}

async function fetchDoc(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (policy-engine-ingest; +strangeramblings.com)' },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) return { ok: false, reason: 'PDF (no extractor) — covered by project summary' };
    const html = await res.text();
    const text = htmlToText(html);
    if (text.length < 400) return { ok: false, reason: `thin (${text.length} chars) — likely JS-rendered` };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: (e?.message || 'fetch error').slice(0, 60) };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
const chunks = [];
let id = 0;
const push = (sourceKey, sourceType, title, url, text) => {
  for (const c of chunkText(text)) {
    chunks.push({ id: `c${id++}`, sourceKey, sourceType, title, url: url || null, text: c });
  }
};

// project files
let projOk = 0;
for (const [rel, title] of [...PROJECT_FILES.map((x) => [`${PE}/${x[0]}`, x[1], 'project']), ...DOC_FILES.map((x) => [x[0], x[1], 'project-doc'])]) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) { console.warn('  skip (missing):', rel); continue; }
  let text = readFileSync(p, 'utf-8');
  if (rel.endsWith('.svelte')) text = stripSvelteStyle(text);
  push(basename(rel), rel.includes('/docs/') ? 'research' : 'project', title, null, text);
  projOk++;
}
console.log(`Project corpus: ${projOk} files → ${chunks.length} chunks`);

// keystone policy documents (best-effort)
const coverage = [];
const beforeKeystone = chunks.length;
for (const k of KEYSTONE) {
  const r = await fetchDoc(k.url);
  if (r.ok) {
    const capped = r.text.slice(0, 60000); // cap each doc so one huge report can't dominate
    const before = chunks.length;
    push(k.key, 'policy-doc', k.title, k.url, capped);
    coverage.push({ key: k.key, status: 'ok', chunks: chunks.length - before });
    console.log(`  ✓ ${k.key} → ${chunks.length - before} chunks`);
  } else {
    coverage.push({ key: k.key, status: 'skipped', reason: r.reason });
    console.log(`  ✗ ${k.key} — ${r.reason}`);
  }
}
console.log(`Keystone docs: ${chunks.length - beforeKeystone} chunks from ${coverage.filter((c) => c.status === 'ok').length}/${KEYSTONE.length} docs`);

const index = {
  generatedAt: new Date().toISOString(),
  chunkCount: chunks.length,
  coverage,
  keystone: KEYSTONE.map((k) => ({ key: k.key, title: k.title, url: k.url })),
  chunks,
};
writeFileSync(OUT, JSON.stringify(index));
const kb = (JSON.stringify(index).length / 1024).toFixed(0);
console.log(`\nWrote ${OUT}\n  ${chunks.length} chunks · ${kb} KB`);
