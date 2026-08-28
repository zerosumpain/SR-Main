// `codegraph` toolset — jkai reasoning over what building this codebase has
// already taught us.
//
// `knowledge_search` retrieves text and `intel_*` walks the world graph. Neither
// can answer "what happened last time someone changed this file", "what fixed
// this error class", or "what rule applies to `scripts/`" — those live in the
// build-history graph, and until now nothing could ask it.
//
// Read-only, and it shares the same loader the build push channel uses, so what
// chat sees and what a build is handed cannot drift apart.
import { register } from '../registry-internal';

// The retrieval modules reach `$lib/db`, and this file is imported by the tool
// registry — which route handlers and tests import purely to enumerate tool
// names. Lazy imports keep registry import free of a database connection; the
// same reason `intel-graph.ts` does it, and the same `load` prefix so a local
// variable cannot shadow the loader into its own temporal dead zone.
const loadQuery = () => import('$lib/codegraph/query');
const loadRetrieve = () => import('$lib/codegraph/retrieve');

register({
  name: 'codegraph_query',
  description:
    'Ask the build-history graph what this codebase has already learned. Use it before answering any "how do I change X", "why does X work that way", or "has this broken before" question about the repo, and whenever a build or gate error needs precedent. ' +
    'Query language (CGQL): start with a seed — file:src/lib/a.ts (commas for several, * allowed), fingerprint:typecheck:TS2345 (an error class), gate:svelte-check, or topic:"free text" — then optionally pipe stages: | hops 1 | lessons limit=5 | episodes verdict=verified,landed limit=3 | budget 4000. ' +
    'Returns the rules that apply and what happened the last time those files changed, each with a verdict: verified (proved by a gate), landed (merged), repaired (later corrected), abandoned.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'CGQL. e.g. `file:src/lib/jkai/executor.ts | hops 1` or `fingerprint:typecheck:TS2345` or `topic:"the tool bridge"`.',
      },
      repo: { type: 'string', description: 'Repo to search. Defaults to SR-Main (the personal site).' },
    },
    required: ['query'],
  },
  category: 'Knowledge',
  toolset: 'codegraph',
  handler: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) return { success: false as const, error: 'codegraph_query needs a query.' };

    const { CgqlError } = await loadQuery();
    const { runCgql, buildContextBlock } = await loadRetrieve();

    try {
      const result = await runCgql(query, { repo: args.repo ? String(args.repo) : undefined });

      // Log chat serves alongside build serves. One table answers "is this
      // being used at all", which is the question the tool bridge could not
      // answer for sixty days while reporting itself healthy.
      const { db } = await import('$lib/db');
      const { codegraphQueries } = await import('$lib/db/schema');
      await db.insert(codegraphQueries).values({
        channel: 'chat',
        query,
        outcome: result.outcome,
        episodeIds: result.episodes.map((e) => e.id),
        lessonIds: result.lessons.map((l) => l.id),
        charsServed: 0,
        durationMs: result.durationMs,
      }).catch(() => {});

      if (result.outcome === 'empty') {
        // Say WHY it is empty and what to try instead. An empty result that
        // reads like an outage gets reported to the user as "this is not
        // covered", which is a different and false statement.
        return {
          success: true as const,
          data: {
            outcome: 'empty',
            message:
              'The build-history graph was queried and holds nothing for this seed. That means no precedent has been recorded — not that the area is uncovered. Try a broader seed (a directory with `*`, or topic:"..."), or fall back to knowledge_search for prose.',
            query,
          },
        };
      }

      return {
        success: true as const,
        data: {
          outcome: 'served',
          block: buildContextBlock(result),
          lessons: result.lessons.map((l) => ({ title: l.title, citedPaths: l.citedPaths, origin: l.origin })),
          episodes: result.episodes.map((e) => ({
            title: e.title, verdict: e.verdict, gate: e.gate, fingerprint: e.fingerprint,
            resolution: e.resolution, verification: e.verification,
            filesTouched: e.filesTouched, prNumber: e.prNumber,
          })),
          relatedFiles: result.nodes.map((n) => n.canonicalPath),
          durationMs: result.durationMs,
        },
      };
    } catch (err) {
      if (err instanceof CgqlError) {
        return {
          success: false as const,
          error: `That is not valid CGQL: ${err.message} (at character ${err.position}). A query starts with file:, gate:, fingerprint: or topic:"...".`,
        };
      }
      return { success: false as const, error: `codegraph query failed: ${(err as Error).message}` };
    }
  },
});
