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
  | { ran: true; passed: boolean; findings: GateFinding[] }
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
  return { ran: true, passed: r.passed === true, findings };
}

export function describeGate(outcome: GateOutcome): string {
  if (!outcome.ran) return `Studio gate skipped — ${outcome.reason}`;
  if (outcome.passed) return 'Studio gate passed — every chapter is reachable, visual, interactive and cited.';
  const lines = outcome.findings.map(
    (f) => `  ✗ [${f.rule}] ${f.message}\n     → ${f.remedy}`,
  );
  return `Studio gate FAILED — ${outcome.findings.length} finding(s):\n${lines.join('\n')}`;
}

export async function runStudioGate(opts: {
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
    sourceUrls: opts.sourceUrls,
    kitFiles: opts.kitFiles ?? [],
  });
  const encoded = Buffer.from(payload, 'utf-8').toString('base64');
  const cmd =
    `cd ${JSON.stringify(process.cwd())} && ` +
    `echo ${encoded} | base64 -d | node scripts/studio-gate.mjs ${JSON.stringify(opts.baseUrl)}`;
  try {
    const res = await execInSandbox(cmd, 180_000);
    return parseGateOutput(res.stdout, res.stderr);
  } catch (err) {
    return {
      ran: false,
      reason: `could not run the studio gate: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
