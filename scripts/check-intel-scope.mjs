#!/usr/bin/env node
// Guard: every reader of the intel tables must be scoped to a space.
//
// Intel rows belong to a person (see src/lib/jkai/intel/scope.ts). A query
// with no space predicate reads everyone's graph — the owner's chat would
// quote a family member's email, or worse the other way round. Postgres RLS
// cannot enforce this here (the production app role bypasses row-level
// security), so the check is in code: a file that reads an intel table must
// show it thought about space, or be named below with a reason.
//
// Limitation: the check is per FILE, not per query. One scoped query makes a
// whole file pass, so a file can still hold unscoped reads beside it (e.g.
// src/lib/jkai/memory/graph.server.ts). PR A2 audits every READS-matching
// file, not only the baseline.
//
// The baseline is the readers that existed before spaces did. It may only
// shrink: an entry that is now scoped or deleted fails the check until it is
// removed, so the list cannot rot. `--strict` requires it to be empty — PR B
// (member data) turns that on.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const READS = /\b(intelNotes|intelEntities|intelRelationships|intelTimelineEvents|intelAlerts|intelInsights|intelLenses|intelDossiers|intelCommissions)\b|\bintel_(notes|entities|relationships|timeline_events|alerts|insights|lenses|dossiers|commissions)\b/;
const SCOPED = /\bspaceIn\(|\bspace_id\s*=|eq\(\w+\.spaceId|OWNER_INTEL_SCOPE|resolveRequestScope|\bscope\s*:\s*IntelScope/;
const SKIP = /(\.test\.ts$|^src\/lib\/db\/schema\.ts$|^src\/lib\/jkai\/intel\/scope(\.server)?\.ts$)/;
const BASELINE = 'scripts/intel-scope-baseline.json';

/**
 * Files exempt from the check, each with the reason. An entry is either a
 * reader that legitimately spans every space (a maintenance sweep), or a file
 * the READS heuristic flags that is not really a table reader (a false
 * positive). PR A2 fills in the rest as each file is reviewed — see the plan.
 */
export const MAINTENANCE = {
  // merge.ts was here (A1) as a resolver sweep that "never returns rows to a
  // user" — but sweepDuplicates feeds the duplicates page. Task 11b scoped it to
  // one space instead, so it passes on its own.
  // Task 11a — not table readers (the READS regex matches a comment or a SQL fragment).
  'src/lib/jkai/intel/analytics/cluster-label.ts':
    'Pure labelling over an analysed snapshot; `intel_notes` appears only in a comment.',
  'src/lib/jkai/intel/analytics/filter.ts':
    'Pure filters over an analysed snapshot; the intel table names appear only in comments.',
  'src/lib/jkai/intel/analytics/model.ts':
    'Pure type module for the analysed graph; the intel table names appear only in comments.',
  'src/lib/jkai/intel/domains.ts':
    'Pure source-to-domain mapping; `intel_notes.source` appears only in a comment.',
  'src/lib/jkai/intel/entity-query.ts':
    'Pure URL parsing and types for the entities index (client-safe); the reader is ' +
    'entity-query.server.ts, which is scoped. `intel_notes` appears only in a comment.',
  'src/lib/jkai/intel/staleness.ts':
    'Pure recency and relevance maths; the intel table names appear only in comments.',
  'src/lib/jkai/intel/provenance.ts':
    'observedAtSql is a SQL fragment, not a reader: MAX(last_seen_at) over the edges of ' +
    'the note id it is given, which carry that note\'s space. The calling query scopes the note.',
  // Task 11a — whole-graph maintenance that never returns rows to a user-facing caller.
  'src/lib/jkai/intel/embed.ts':
    'Embeddings are per row and global (spec §2): embedNote/embedEntity read a row by id only ' +
    'to write its own embedding back; the backfill returns counts.',
  'src/lib/jkai/intel/trust-refresh.ts':
    'Confidence is per row and global (spec §2): scores each entity from its own notes (same ' +
    'space by construction) and writes it back; returns counts.',
  'src/lib/jkai/intel/taxonomy.ts':
    'The type/category vocabulary is shared by every space: usage counts per type/category ' +
    'and relationship type names, never row content. Evidence samples, which name rows, are ' +
    'in taxonomy-governance.server.ts and are scoped there.',
  // Task 11b — not a table reader.
  'src/lib/jkai/intel/resolve/match.ts':
    'Pure matcher (no database import); `intel_entities` appears only in comments. The ' +
    'entities it scores come from merge.ts and ingestion.server.ts, which load one space.',
  'src/lib/jkai/intel/source-policy.server.ts':
    'Drive folder policy sync (the Drive is the owner\'s): re-stamps categories on, or cascades ' +
    'the deletion of, notes derived from Drive files, by file id; returns counts only.',
  // Task 13 — consumers outside the intel library the READS regex flags but that read no intel table.
  'src/lib/components/jkai/KnowledgeGraphModal.svelte':
    'Not a table reader: a client component; `intel_relationships` appears only in a CSS comment. ' +
    'Its data comes from the thread-graph and entity-card routes, which are scoped.',
  'src/lib/daydream/adjudicate.ts':
    'Not a table reader: the tool NAME \'intel_find\' in the reviewer\'s allow-list and ' +
    '`intel_notes` in comments. The tools it hands the reviewer read the owner\'s scope.',
  'src/lib/daydream/mechanics.ts':
    'Not a table reader: descriptive strings for the mechanics page (`reads: [\'intel_notes (email)\']`).',
  'src/lib/daydream/notebook/cards.ts':
    'Not a table reader: `intel_notes.graph_state` appears only in a comment; the weave writes ' +
    'through extractIntoIntel into OWNER_SPACE.',
  'src/lib/daydream/thought-store.ts':
    'Not a table reader: `intel_insights` appears only in the header comment; it reads daydream_thoughts.',
  'src/lib/jkai/graph-colors.ts':
    'Not a table reader: pure colour mapping; `intel_relationships` appears only in a comment.',
  'src/lib/jkai/thread-graph.ts':
    'Not a table reader: the pure half of the thread graph (client-safe); `intel_relationships` ' +
    'appears only in a comment. The reader is thread-graph.server.ts, which is scoped.',
  'src/lib/workflows/chat/legacy-tool-log.ts':
    'Not a table reader: tool NAMES (\'intel_insights\' etc.) mapped to log sentences.',
  'src/lib/workflows/chat/tool-summary.ts':
    'Not a table reader: tool NAMES (\'intel_insights\' etc.) in switch cases that summarise results.',
  'src/lib/workflows/site-tools/keyword-classifier.ts':
    'Not a table reader: tool NAMES (\'intel_insights\' etc.) in a comment beside a toolset pattern.',
  // Task 13 — maintenance that spans every space and returns only counts.
  'src/lib/news/relabel.ts':
    'Whole-table maintenance relabel (secret-authorised backfill route): moves kept news from ' +
    'source \'web\' to \'news\' in every space by its newsKey; returns a count.',
  'src/lib/mail-index/store.ts':
    'Passage indexing is per note, like embeddings (spec §2): backfillMailIndex indexes every ' +
    'admitted thread that has no chunks and pruneUnadmittedMail drops unadmitted ones; both return ' +
    'counts. The reader is mail-index/search.ts, which is scoped.',
};

export function classify(files, baseline, maintenance) {
  const readers = files.filter((f) => !SKIP.test(f.path) && READS.test(f.src));
  const scoped = new Set(readers.filter((f) => SCOPED.test(f.src)).map((f) => f.path));
  const readerPaths = new Set(readers.map((f) => f.path));
  const base = new Set(baseline);
  const unscoped = readers
    .map((f) => f.path)
    .filter((p) => !scoped.has(p) && !(p in maintenance) && !base.has(p))
    .sort();
  const fixed = baseline.filter((p) => !readerPaths.has(p) || scoped.has(p) || p in maintenance).sort();
  return { unscoped, fixed };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const files = walk('src').map((path) => ({ path, src: readFileSync(path, 'utf8') }));
  if (args.has('--write-baseline')) {
    const { unscoped } = classify(files, [], MAINTENANCE);
    writeFileSync(BASELINE, JSON.stringify(unscoped, null, 2) + '\n');
    console.log(`check-intel-scope: wrote ${unscoped.length} baseline readers to ${BASELINE}`);
    return;
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [];
  const { unscoped, fixed } = classify(files, baseline, MAINTENANCE);
  let fail = false;
  if (unscoped.length) {
    fail = true;
    console.error('check-intel-scope: FAIL — these files read intel tables with no space scope:\n');
    for (const p of unscoped) console.error(`  ${p}`);
    console.error('\nPass a `scope: IntelScope` (default OWNER_INTEL_SCOPE) and add spaceIn(...) /');
    console.error('space_id to every query. See src/lib/jkai/intel/scope.ts.');
  }
  if (fixed.length) {
    fail = true;
    console.error('\ncheck-intel-scope: FAIL — remove these from the baseline (now scoped or gone):\n');
    for (const p of fixed) console.error(`  ${p}`);
  }
  if (args.has('--strict') && baseline.length) {
    fail = true;
    console.error(`\ncheck-intel-scope: FAIL — --strict and ${baseline.length} baseline readers remain.`);
  }
  if (fail) process.exit(1);
  console.log(`check-intel-scope: ok (${baseline.length} baseline readers left to scope)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
