/**
 * Does the explainer actually teach?
 *
 * Four checks per chapter, driven in a real browser: reachable, has a visual,
 * has a control that moves an outcome, cites the brief. Plus one project-level
 * check: did the explainer kit actually mount (see `kitFiles` below). The
 * runner is scripts/studio-gate.mjs — a subprocess for the same reason
 * scripts/smoke-static-app.mjs is one: `import('playwright')` resolves from the
 * script's own directory, so the file must live in the repo.
 *
 * Contract: a harness that could not run reports `ran: false`, never
 * `passed: false`.
 */
import { execInSandbox } from './sandbox';

export interface GateFinding {
  chapter: number;
  rule: string;
  message: string;
  /** What to change, named concretely. A finding with no remedy is a trap. */
  remedy: string;
}

export type GateOutcome =
  | { ran: true; passed: boolean; findings: GateFinding[]; notYetDue?: number[] }
  | { ran: false; reason: string };

export function parseGateOutput(stdout: string, stderr: string): GateOutcome {
  const line = (stdout ?? '').trim();
  if (!line) {
    return { ran: false, reason: stderr?.trim().slice(0, 300) || 'the studio gate printed nothing' };
  }
  const start = line.indexOf('{');
  if (start === -1) return { ran: false, reason: line.slice(0, 300) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(start));
  } catch {
    return { ran: false, reason: line.slice(0, 300) };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ran: false, reason: 'studio gate output was not an object' };
  }
  const r = parsed as Record<string, unknown>;
  if (r.ran !== true) {
    return { ran: false, reason: typeof r.reason === 'string' ? r.reason : 'the studio gate did not run' };
  }
  const findings = Array.isArray(r.findings) ? (r.findings as GateFinding[]) : [];
  const notYetDue = Array.isArray(r.notYetDue) ? (r.notYetDue as number[]) : [];
  return { ran: true, passed: r.passed === true, findings, notYetDue };
}

export function describeGate(outcome: GateOutcome): string {
  if (!outcome.ran) return `Studio gate skipped — ${outcome.reason}`;
  const pending = outcome.notYetDue?.length
    ? ` (${outcome.notYetDue.length} chapter(s) not yet due: ${outcome.notYetDue.join(', ')})`
    : '';
  if (outcome.passed) return `Studio gate passed — every chapter due so far is reachable, visual, interactive and cited.${pending}`;
  const lines = outcome.findings.map(
    (f) => `  ✗ [${f.rule}] ${f.message}\n     → ${f.remedy}`,
  );
  return `Studio gate FAILED — ${outcome.findings.length} finding(s)${pending}:\n${lines.join('\n')}`;
}

/**
 * Why the gate cannot be run at all, or null when it can.
 *
 * The orchestrator's studio-gate call was guarded on
 * `chapterPlan.length > 0 && serve?.port`, and when either was falsy it did
 * nothing and said nothing — not even the "skipped" line the `ran: false`
 * contract produces via describeGate. That is how an empty chapter spine (a
 * plan that emitted no Chapter Plan table) stayed invisible: the build simply
 * had no guardrail, and the log looked healthy.
 *
 * Both conditions are errors, not asides, so the message says what is missing
 * and what stops being checked as a result.
 */
export function describeGateSkip(chapterCount: number, port: number | null | undefined): string | null {
  const noSpine = chapterCount <= 0;
  const noPort = !port;
  if (!noSpine && !noPort) return null;
  const missing = noSpine && noPort
    ? 'the chapter spine is empty AND no serving port is recorded'
    : noSpine
    ? 'the chapter spine is empty — the plan produced no Chapter Plan table'
    : 'no serving port is recorded — the preview server never came up healthy';
  return (
    `Studio gate SKIPPED — ${missing}. Nothing is checking this build's chapters: ` +
    `no reachability, interactivity, citation or kit-usage findings will be produced.`
  );
}

export async function runStudioGate(opts: {
  /** Chapters the plan says should be FINISHED by now; later ones are skipped as not-yet-due. */
  chaptersDue?: number;
  baseUrl: string;
  chapters: Array<{ n: number; title: string; path: string; leverId: string; outcomeId: string }>;
  sourceUrls: string[];
  /**
   * Paths relative to the served root that the explainer-kit sync
   * (`syncExplainerKit` in ./sandbox) should have put there — e.g.
   * "explainer-kit/tokens.css". Checked by scripts/studio-gate.mjs's chapter-0
   * `kit-missing` check. Absent or empty skips that check entirely — this
   * function is the one place that knows which files the sync was supposed to
   * mount (see design-assets.ts EXPLAINER_FILES), so it is the only place that
   * should ever populate this list.
   */
  kitFiles?: string[];
}): Promise<GateOutcome> {
  if (opts.chapters.length === 0) {
    return { ran: false, reason: 'no chapter plan on the build — nothing to check' };
  }
  const payload = JSON.stringify({
    chapters: opts.chapters,
    // Chapters the plan says should be FINISHED by now. Omitting this makes the
    // runner check every chapter including unbuilt placeholders — which is what
    // happened between 2026-08-10 PR #193 and #195: the parameter was accepted
    // here and silently dropped from the payload, so `still-placeholder` fired
    // for every chapter the agent had not reached yet, on every iteration.
    chaptersDue: opts.chaptersDue ?? 0,
    sourceUrls: opts.sourceUrls,
    kitFiles: opts.kitFiles ?? [],
  });
  const encoded = Buffer.from(payload, 'utf-8').toString('base64');
  // NOT `| base64 -d |` before node: unlike static-smoke.ts's runner, which
  // reads plain JSON off stdin (the shell decodes for it),
  // scripts/studio-gate.mjs decodes the base64 itself (see its own
  // `Buffer.from(stdin.trim(), 'base64')`) — its docstring's usage line is
  // `echo '<base64 spec>' | node scripts/studio-gate.mjs <baseUrl>`, base64
  // going straight in. A pre-decode here fed it double-decoded garbage and
  // it reported `ran:false, reason:'could not parse the spec on stdin'` on
  // every call — confirmed by actually running this command, not just
  // reading it, during fix-round-1 verification.
  const cmd =
    `cd ${JSON.stringify(process.cwd())} && ` +
    `echo ${encoded} | node scripts/studio-gate.mjs ${JSON.stringify(opts.baseUrl)}`;
  try {
    // 300s, not 180s: each chapter now probes up to 4 candidate paths (up to
    // 20s navigation timeout each) before falling back to unreachable, plus
    // up to 2s of outcome-polling per lever-drive attempt. A 10-chapter
    // build with several genuinely inert levers is the case most likely to
    // need the headroom, and it runs outside the agent's own budget, so the
    // extra wall-clock costs nothing but wall-clock.
    const res = await execInSandbox(cmd, 300_000);
    return parseGateOutput(res.stdout, res.stderr);
  } catch (err) {
    return {
      ran: false,
      reason: `could not run the studio gate: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
