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
import { cgqlForFiles, cgqlForFingerprints, cgqlForTopic } from './query';
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

/*
 * Bare filenames, and why they have to be handled separately.
 *
 * `PATH_IN_TEXT` requires a full repo-relative path, and a person writing a
 * task does not supply one. Build f85ed296 (2026-08-17) asked to fix a
 * duplication "in src/lib/jkai/" between `orchestrator.ts` and
 * `rescue-body.ts`, and `planBuildQuery` returned null: no query, no serve,
 * no context. The three earlier builds only retrieved because their prompts
 * happened to be written with full paths — by the same person who wrote the
 * regex. That is not a retrieval system, it is a retrieval system that works
 * when you already know the answer.
 *
 * Resolution is deliberately conservative. Against 3,170 file nodes,
 * `orchestrator.ts` matches once, `types.ts` 39 times and `+server.ts` 369
 * times. Seeding a query from an ambiguous name would inject context from
 * whichever part of the tree happened to sort first, which is worse than
 * injecting nothing: a wrong precedent is read as authoritative.
 */
const BARE_NAME_IN_TEXT = /(?:^|[^\w/.-])([A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:ts|js|mjs|svelte|json|css|md|sh|py))\b/g;

/** A directory the task text names, e.g. `src/lib/jkai/`. Used only to disambiguate. */
const DIR_IN_TEXT = /\b((?:src|scripts|packages|static|docs|tests|field-study-system|\.github)\/[A-Za-z0-9_\-./]*\/)/g;

export function bareNamesInText(text: string | null | undefined, max = 12): string[] {
  if (!text) return [];
  const s = String(text);
  // Anything already captured as a full path is not a bare name — otherwise
  // `src/lib/jkai/executor.ts` would also be offered as `executor.ts` and
  // resolve a second time, ambiguously.
  const inFullPaths = new Set(pathsInText(s, 64).map((p) => p.slice(p.lastIndexOf('/') + 1)));
  const out = new Set<string>();
  for (const m of s.matchAll(BARE_NAME_IN_TEXT)) {
    const name = m[1];
    if (inFullPaths.has(name)) continue;
    out.add(name);
    if (out.size >= max) break;
  }
  return [...out];
}

export function dirHintsInText(text: string | null | undefined, max = 6): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of String(text).matchAll(DIR_IN_TEXT)) {
    out.add(m[1]);
    if (out.size >= max) break;
  }
  return [...out];
}

/**
 * Choose canonical paths for bare names, given every candidate the graph holds.
 *
 * A name is taken only when it lands on exactly one file. A directory named in
 * the same task text narrows the field first — "in `src/lib/jkai/` … fix
 * `types.ts`" is unambiguous even though `types.ts` alone is not — which is the
 * shape people actually write. Everything still ambiguous is reported rather
 * than guessed at, so the caller can log what it declined to seed from.
 */
export function pickNamedFiles(
  names: string[],
  dirHints: string[],
  candidates: string[],
): { resolved: string[]; ambiguous: string[] } {
  const resolved: string[] = [];
  const ambiguous: string[] = [];

  for (const name of names) {
    const matches = candidates.filter((p) => p.slice(p.lastIndexOf('/') + 1) === name);
    if (matches.length === 1) {
      resolved.push(matches[0]);
      continue;
    }
    if (matches.length > 1 && dirHints.length) {
      const narrowed = matches.filter((p) => dirHints.some((d) => p.startsWith(d)));
      if (narrowed.length === 1) {
        resolved.push(narrowed[0]);
        continue;
      }
    }
    if (matches.length) ambiguous.push(name);
  }
  return { resolved: [...new Set(resolved)], ambiguous };
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
export function planBuildQuery(
  input: BuildRetrievalInput,
  /**
   * Paths resolved from bare filenames in the task text, which needs the node
   * table and therefore cannot happen in here. Passed in so this stays pure and
   * the ranking it feeds stays testable without a database.
   */
  namedFiles: string[] = [],
  /**
   * Paths the graph actually holds a live node for, when the caller has checked.
   *
   * `null` means "not checked" and preserves the old behaviour. Supplying it is
   * what stops the file lane seeding on a path that does not exist — see the
   * filter below.
   */
  knownPaths: ReadonlySet<string> | null = null,
): { query: string; reason: string; fingerprints: string[] } | null {
  // 1. The sharpest key: what the gate just said.
  const fps = fingerprintsIn(input.previousEvaluation ?? '', 'npm run gate');
  if (fps.length) {
    const q = cgqlForFingerprints(fps, 3);
    if (q) return { query: q, reason: `gate failure (${fps.slice(0, 3).join(', ')})`, fingerprints: fps };
  }

  // 2. Otherwise the file set: what was edited last, else what the task names.
  const files = [
    ...editedPathsFromActions(input.previousActions),
    ...pathsInText(input.prompt),
    ...namedFiles,
  ].filter(Boolean);

  /*
   * ONLY PATHS THE GRAPH ACTUALLY KNOWS.
   *
   * `pathsInText` is a regex over the task text and verifies nothing, so a task
   * naming a file it is about to CREATE — the ordinary shape of "add
   * scripts/foo.mjs" — planned a file query for a path with no node behind it.
   * `resolveSeed` then produced an empty seed, and `pickLessons` answers an
   * empty seed with the N most recently observed lessons in the corpus.
   *
   * Measured on build 4cda9a8d, seeded `file:scripts/codegraph-stats.mjs`: four
   * lessons served, about the Landgrab territory game, the jkai model picker,
   * the nightly conflation detector and pgvector neighbour ranking. Zero had
   * anything to do with the task, and it was still logged as `served`.
   *
   * Declining here is what lets the TOPIC lane below run instead — and for that
   * same build the topic lane returned `project_codegraph`, which carries the
   * rule the task actually needed (a new file under `scripts/` needs its own
   * rsync line in `ci-release.sh` or it is silently absent in production).
   * So this is not merely "serve less"; it is "reach the lane that had the
   * answer", which the file lane was shadowing by always claiming the query.
   */
  const unique = [...new Set(files)].filter((p) => !knownPaths || knownPaths.has(p));
  if (unique.length) {
    const q = cgqlForFiles(unique, { hops: 1 });
    // No fingerprints: a file-set serve cannot be resolved by "did the error
    // recur", so it stays unresolved rather than being credited for free.
    if (q) return { query: q, reason: `file set (${unique.length} path(s))`, fingerprints: [] };
  }

  /*
   * 3. Last resort: what the task is ABOUT.
   *
   * The two keys above are both retrospective — they need a gate that has
   * already failed, or a file that already exists and was already named. A task
   * like "add a Notion connector" satisfies neither, and until this lane existed
   * it produced no query at all: the graph held five notes on exactly that
   * subject (which service the credential binds to, why a credential in node
   * config spreads to nine tables, that Strava is parked by design) and served
   * none of them, because none of those notes' subject matter is expressible as
   * a path the prompt happens to contain.
   *
   * Deliberately BELOW the file set, not above it. Prose matching is the weaker
   * signal — it was rejected as the primary key because 29% of prompts are 25
   * characters or fewer — and this lane only runs where the sharp keys have
   * already declined. `cgqlForTopic` returns null when the text is too thin to
   * ask with, so "crack on" still plans nothing, which is the honest answer.
   */
  const topic = cgqlForTopic(input.prompt);
  if (topic) {
    // Unattributable for the same reason as a file set, and more so: no error
    // was in play, so nothing about the next gate result can credit it.
    return { query: topic, reason: 'task topic', fingerprints: [] };
  }

  return null;
}
