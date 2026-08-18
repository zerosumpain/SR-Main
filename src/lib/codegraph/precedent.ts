/**
 * The precedent channel: showing a build what this repo's code actually looks
 * like, rather than telling it to go and find out.
 *
 * WHAT THIS FIXES
 *
 * Across 275 production repo iterations, discovery — read, grep, find, ls — is
 * 2,797 of 5,546 recorded actions. Half of everything a build does is looking
 * for things, against 764 edits and writes. The same 363 files are opened 2,342
 * times: 6.45 reads each. And the files opened by SEVEN OR EIGHT unrelated
 * builds are not anyone's task — `registry-internal.ts`, `registry.ts`, the
 * apple-calendar family — they are agents repeatedly asking the same question:
 * how does this codebase do this?
 *
 * The system prompt already answers that with an instruction: "read two existing
 * files of the same shape … copy their structure, naming, error handling and
 * helpers". This is the same instruction with the files attached.
 *
 * THE SPLIT THAT MAKES IT SAFE
 *
 * codegraph picks the PATHS — it holds the family attribute, the import
 * centrality and, critically, the one loader where a merged node or a suppressed
 * edge is honoured. The bytes come from the BUILD'S OWN WORKSPACE, never from
 * the graph: the graph stores no source, and a path this build's clone does not
 * have simply drops out instead of being injected as a file the agent cannot
 * open.
 */
import { cgqlForSiblings } from './query';

/** Chars of each exemplar that reach the prompt. */
export const PRECEDENT_CHARS_PER_FILE = 2400;

/** How many exemplars in total, across all targets. */
export const PRECEDENT_MAX_FILES = 2;

/**
 * Which files is this build about to write?
 *
 * Deliberately the same signals `planBuildQuery` uses, in the same order — what
 * the last iteration edited, then what the task names — because a build whose
 * retrieval and precedent disagree about its own subject is worse than one with
 * neither.
 *
 * The paths need NOT exist yet. That is the point: a build creating
 * `src/routes/api/foo/+server.ts` has no file to read and every reason to want
 * the other 358.
 */
export function precedentTargets(
  editedPaths: string[],
  promptPaths: string[],
  namedFiles: string[],
  max = 2,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...editedPaths, ...promptPaths, ...namedFiles]) {
    const clean = String(p ?? '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/** The CGQL asked per target. Exported so the ledger records what was asked. */
export function precedentQuery(target: string, limit: number): string | null {
  return cgqlForSiblings(target, limit);
}

/**
 * The head of a file, cut at a line boundary.
 *
 * The head is where the shape lives: the imports that say which helpers this
 * repo reaches for, the module comment that says why, the first exported symbol
 * with its signature and its error handling. Taking the middle would be an
 * arbitrary window into an implementation nobody asked about.
 *
 * Cut at a newline so the excerpt never ends mid-token — a truncated identifier
 * reads as a real name and is the kind of thing an agent will faithfully copy.
 */
export function skeleton(source: string, maxChars = PRECEDENT_CHARS_PER_FILE): string {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  if (text.length <= maxChars) return text.trimEnd();
  const cut = text.slice(0, maxChars);
  const lastNewline = cut.lastIndexOf('\n');
  const body = (lastNewline > maxChars * 0.5 ? cut.slice(0, lastNewline) : cut).trimEnd();
  const droppedLines = text.slice(body.length).split('\n').length - 1;
  return `${body}\n… ${droppedLines} more line(s) — open the file if you need them.`;
}

export interface PrecedentFile {
  target: string;
  path: string;
  source: string;
}

/**
 * Render the block. Absence is INFORMATIVE, exactly as it is for the codegraph
 * push: an empty section is indistinguishable from a channel that never ran,
 * which is precisely how the tool bridge stayed broken for sixty days while
 * logging that it was fine.
 */
export function buildPrecedentBlock(files: PrecedentFile[]): string {
  if (!files.length) return '';

  const lines: string[] = [
    '## How this repo writes files like this',
    '',
    'Closest precedents for what you are about to change, chosen by shape and by how',
    'much of the repo imports them. Copy their structure, naming, error handling and',
    'helpers. Where they disagree with a habit you have, they win.',
  ];

  for (const f of files) {
    const ext = f.path.slice(f.path.lastIndexOf('.') + 1);
    const lang = ext === 'svelte' ? 'svelte' : ext === 'mjs' || ext === 'js' ? 'js' : ext;
    lines.push(
      '',
      `### \`${f.path}\``,
      `Precedent for \`${f.target}\`.`,
      '',
      '```' + lang,
      f.source,
      '```',
    );
  }
  return lines.join('\n');
}
