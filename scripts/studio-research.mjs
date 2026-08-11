#!/usr/bin/env node
/**
 * studio-research.mjs — ask the research corpus a question, mid-build.
 *
 * Usage, from the workspace:
 *   node <repo>/scripts/studio-research.mjs "how a claim is assessed"
 *   node <repo>/scripts/studio-research.mjs "eligibility evidence" --limit 12
 *
 * WHY THIS EXISTS
 *
 * The research brief is assembled once, before planning, and never consulted
 * again. By the time the agent is writing chapter 4 it has whatever survived
 * into the fifteen facts chosen for a whole-project query. When that is thin,
 * the only honest thing left to write is "the supplied record does not
 * establish this" — which is what two IBCA builds kept writing, chapter after
 * chapter. They were not being cautious. They could not ask.
 *
 * Use it per chapter, with the chapter's own question. Search is semantic, so
 * phrase it as the thing you want to explain, not as keywords.
 *
 * Facts come back with their source type and date attached. WEIGH THEM: a
 * government publication and a social-media post are not equivalent evidence,
 * and a chapter leaning on the weaker one should say so.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Everything that is not a flag or a flag's value is the question.
const argv = process.argv.slice(2);
const words = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  words.push(argv[i]);
}
const query = (flag('q') || words.join(' ')).trim();
const limit = flag('limit', '8');

if (!query) {
  console.error(
    'studio-research: no question.\n' +
      '  node scripts/studio-research.mjs "how a claim is assessed" [--limit 12]\n' +
      '\nAsk it as the thing you want to explain, not as keywords — the search is semantic.',
  );
  process.exit(2);
}

const api = process.env.JKAI_API_URL;
const token = process.env.JKAI_BRIDGE_TOKEN;
if (!api || !token) {
  console.error(
    'studio-research: JKAI_API_URL / JKAI_BRIDGE_TOKEN are not set in this shell, ' +
      'so the corpus cannot be reached. Work from the FACTS in your brief instead — ' +
      'and do not present the gap as though the record itself is silent.',
  );
  process.exit(2);
}

let res;
try {
  res = await fetch(`${api}/api/jkai/studio/research`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, limit: Number(limit) }),
    signal: AbortSignal.timeout(60_000),
  });
} catch (err) {
  console.error(`studio-research: could not reach the corpus (${err.message}).`);
  process.exit(1);
}

if (!res.ok) {
  const detail = (await res.text()).slice(0, 300);
  console.error(
    `studio-research: the corpus returned ${res.status}. ${detail}\n` +
      'This is an infrastructure fault, NOT evidence that the topic is uncovered. ' +
      'Do not write "the record does not establish this" on the strength of it.',
  );
  process.exit(1);
}

const { facts, count } = await res.json();

if (!count) {
  console.log(`No facts in the corpus match "${query}".`);
  console.log(
    'That means nobody has researched it — which is NOT the same as the record ' +
      'establishing nothing. Say which of the two you mean, or ask a different question.',
  );
  process.exit(0);
}

console.log(`${count} fact(s) for "${query}":\n`);
for (const [i, f] of facts.entries()) {
  const marks = [
    f.sourceType ? f.sourceType : 'provenance unverified',
    f.credibility != null ? `credibility ${Number(f.credibility).toFixed(2)}` : null,
    f.asOf ? `as of ${f.asOf}` : null,
  ].filter(Boolean);
  console.log(`${i + 1}. ${f.claim}`);
  console.log(`   ${f.sourceTitle ? f.sourceTitle + ' — ' : ''}${f.sourceUrl}`);
  console.log(`   [${marks.join(' · ')}]\n`);
}
console.log('Cite the URL, not this output. Weigh the source types before you lean on one.');
