#!/usr/bin/env node
/**
 * codegraph-query.mjs — ask the build-history graph a question, mid-build.
 *
 * Usage, from the workspace:
 *   node <repo>/scripts/codegraph-query.mjs 'file:src/lib/jkai/executor.ts'
 *   node <repo>/scripts/codegraph-query.mjs 'fingerprint:typecheck:TS2345'
 *   node <repo>/scripts/codegraph-query.mjs 'topic:"how the tool bridge authenticates"'
 *
 * WHY THIS IS A SCRIPT AND NOT A TOOL
 *
 * The obvious design is a registered site tool the agent calls. That design is
 * dead on arrival here: all 5,214 tool actions recorded across 280 production
 * build iterations are pi's seven built-ins, and not one is a bridged site
 * tool — the bridge failed four different silent ways and logged "OK"
 * throughout. `bash` is the only transport that has never been stripped,
 * because `buildToolAllowlist` seeds its allow-list from `BASE_PI_TOOLS` and
 * bash is in that constant by construction.
 *
 * So this is a script, invoked over bash, exactly like scripts/studio-research.mjs
 * — the one mid-build retrieval pattern in this repo with a working track record.
 *
 * Exit codes: 0 served or empty (both are answers), 2 misconfigured, 1 failed.
 */
const API =
  process.env.JKAI_API_URL?.replace(/\/$/, '') || 'http://127.0.0.1:4173';
const TOKEN = process.env.JKAI_BRIDGE_TOKEN || process.env.CLAUDE_CHANGELOG_SECRET || '';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const query = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1]?.startsWith('--') !== true).join(' ').trim();

if (!query) {
  console.error(`Ask the build-history graph what this codebase already knows.

  codegraph-query.mjs 'file:src/lib/jkai/executor.ts'
  codegraph-query.mjs 'fingerprint:typecheck:TS2345 | episodes limit=3'
  codegraph-query.mjs 'topic:"the tool bridge" | lessons limit=5'

Seeds: file:PATH[,PATH]  gate:NAME  fingerprint:FP  topic:"text"
Stages: | hops 1|2  | lessons  | episodes verdict=verified,landed limit=N  | budget N`);
  process.exit(2);
}

if (!TOKEN) {
  // Say which variable and where it comes from. "unauthorized" with no cause
  // is what made the bridge's failures take months to diagnose.
  console.error(
    'codegraph: no bridge token in the environment (JKAI_BRIDGE_TOKEN). ' +
      'The orchestrator sets this per build; if you are seeing this inside a build, ' +
      'the sidecar env is stale — it is read once at process start.',
  );
  process.exit(2);
}

const res = await fetch(`${API}/api/jkai/codegraph/query`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    query,
    channel: 'pull',
    buildId: flag('build') || process.env.JKAI_BUILD_ID || null,
  }),
}).catch((e) => {
  console.error(`codegraph: cannot reach ${API} — ${e.message}`);
  process.exit(1);
});

const text = await res.text();
if (!res.ok) {
  console.error(`codegraph: ${res.status} — ${text.slice(0, 400)}`);
  process.exit(res.status === 400 ? 2 : 1);
}

const data = JSON.parse(text);
// Print the rendered block: it already says "NO PRECEDENT" when empty, which is
// an answer the agent should act on rather than an absence it should ignore.
console.log(data.block);
console.log(`\n[${data.outcome} · ${data.lessons?.length ?? 0} lessons · ${data.episodes?.length ?? 0} episodes · ${data.durationMs}ms]`);
