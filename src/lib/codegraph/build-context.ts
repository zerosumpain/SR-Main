/**
 * The push channel: what the graph hands a build at the start of an iteration.
 *
 * WHY PUSH AT ALL, when there is also a pull script
 *
 * pi has no mid-run injection point — `runPi` builds one argv with
 * `--no-context-files`, so nothing enters the agent's context after the
 * executor hands it over. Pull covers what the agent thinks to ask for; push
 * covers what it does not know to ask. The measured failure is precisely the
 * second kind: 10.5 discovery actions per iteration re-deriving context the
 * history already held, and an agent that has never heard of the graph will
 * never call it.
 *
 * WHY THE QUERY IS NOT THE PROMPT
 *
 * 29% of John's prompts are 25 characters or fewer. "crack on" embeds to
 * nothing. The two keys that are actually sharp are mechanical:
 *
 *   1. the FINGERPRINT of the gate error the last iteration hit — the
 *      orchestrator has already extracted those diagnostics and appended them
 *      to `evaluation`, so the previous failure IS this iteration's query; and
 *   2. the FILE SET the build is touching, taken from the files the previous
 *      iteration actually edited, then from paths named in the task text.
 *
 * Both cost a regex. Neither costs an LLM call, which is what makes it
 * affordable on every iteration of every build.
 */
import { cgqlForFiles, cgqlForFingerprints } from './query';
import { fingerprintsIn } from './fingerprint';

/** Paths that look like repo files, taken from free text. */
const PATH_IN_TEXT =
  /\b((?:src|scripts|packages|static|docs|tests|field-study-system|\.github)\/[A-Za-z0-9_\-./[\]]+\.[A-Za-z0-9]{1,6})\b/g;

export function pathsInText(text: string | null | undefined, max = 12): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of String(text).matchAll(PATH_IN_TEXT)) {
    out.add(m[1]);
    if (out.size >= max) break;
  }
  return [...out];
}

export interface BuildRetrievalInput {
  /** The build's task text. */
  prompt: string;
  /** Previous iteration's evaluation — carries the gate diagnostics. */
  previousEvaluation?: string | null;
  /** Previous iteration's recorded actions, for the files actually edited. */
  previousActions?: unknown;
  buildId?: string;
  iterationId?: string;
}

/** File paths the previous iteration actually wrote to. */
export function editedPathsFromActions(actions: unknown, max = 12): string[] {
  if (!Array.isArray(actions)) return [];
  const out = new Set<string>();
  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const rec = a as Record<string, unknown>;
    const tool = String(rec.tool ?? rec.name ?? rec.lang ?? '').toLowerCase();
    if (!/edit|write/.test(tool)) continue;
    const args = (rec.args ?? rec.input ?? rec.params) as Record<string, unknown> | undefined;
    const p = args?.file_path ?? args?.path ?? rec.path ?? rec.file;
    if (typeof p === 'string' && p) {
      out.add(p.replace(/^\/home\/jkai\/workspace\/[^/]+\/dev\//, ''));
      if (out.size >= max) break;
    }
  }
  return [...out];
}

/**
 * Decide what to ask the graph. Returns the CGQL, or null when there is
 * genuinely nothing to ask about — which the caller must log as `empty` rather
 * than as a failure, because the two mean very different things.
 */
export function planBuildQuery(input: BuildRetrievalInput): { query: string; reason: string } | null {
  // 1. The sharpest key: what the gate just said.
  const fps = fingerprintsIn(input.previousEvaluation ?? '', 'npm run gate');
  if (fps.length) {
    const q = cgqlForFingerprints(fps, 3);
    if (q) return { query: q, reason: `gate failure (${fps.slice(0, 3).join(', ')})` };
  }

  // 2. Otherwise the file set: what was edited last, else what the task names.
  const files = [
    ...editedPathsFromActions(input.previousActions),
    ...pathsInText(input.prompt),
  ].filter(Boolean);

  const unique = [...new Set(files)];
  if (unique.length) {
    const q = cgqlForFiles(unique, { hops: 1 });
    if (q) return { query: q, reason: `file set (${unique.length} path(s))` };
  }

  return null;
}
