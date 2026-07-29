// src/lib/selfimprove/verify.ts
//
// The gate that lets the engine SHIP unattended. Tools it authors are enabled
// automatically (owner decision, 2026-07-29) — which is only defensible because
// nothing reaches the registry without clearing both checks here:
//
//   1. staticScan  — a deny-list over the handler source. The handler is compiled
//                    with `new AsyncFunction(...)` in full Node scope, so the
//                    only thing standing between an LLM-authored string and
//                    `process.env` is this scan. Deny beats allow: an unknown
//                    construct is refused, not permitted.
//   2. smokeTest   — EVERY provided case must return success within a timeout.
//                    The old code tested one `sample_args` and shipped on that;
//                    a single happy path is not evidence a tool works.
//
// Both are pure/side-effect-free apart from the tool invocation itself, so the
// build and repair phases can share them.

import type { ToolResult } from '$lib/workflows/site-tools/registry-internal';
import { errMsg } from './types';

/** Per-case wall clock. Short on purpose — a nightly tool must be fast. */
export const CASE_TIMEOUT_MS = 12_000;

/**
 * Constructs a handler may never contain. These are matched against the raw
 * source before compilation, so an LLM cannot talk its way past them.
 *
 * `process` covers env/exit/argv in one; `require`/`import(` cover module
 * loading; `constructor` blocks the classic
 * `''.constructor.constructor('return process')()` sandbox escape.
 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bprocess\b/, why: 'accesses `process` (env vars, exit, argv)' },
  { pattern: /\brequire\s*\(/, why: 'uses require() to load modules' },
  { pattern: /\bimport\s*\(/, why: 'uses dynamic import()' },
  { pattern: /\beval\s*\(/, why: 'uses eval()' },
  { pattern: /\bFunction\s*\(/, why: 'constructs a Function from a string' },
  { pattern: /\.constructor\s*[([]/, why: 'reaches for .constructor (sandbox escape)' },
  { pattern: /\bglobalThis\b/, why: 'touches globalThis' },
  { pattern: /\bchild_process\b/, why: 'references child_process' },
  { pattern: /\bfs\s*\./, why: 'references the filesystem' },
  { pattern: /\breadFile|writeFile\b/, why: 'reads or writes files' },
  { pattern: /\b__dirname|__filename\b/, why: 'references module paths' },
  { pattern: /\bBuffer\s*\.\s*from\s*\([^)]*base64/i, why: 'decodes base64 (obfuscation risk)' },
  { pattern: /\bnew\s+Worker\b/, why: 'spawns a worker thread' },
  { pattern: /\bsetInterval\b/, why: 'schedules recurring work that outlives the call' },
];

export interface StaticScanResult {
  ok: boolean;
  /** Human-readable reasons, safe to show in the ledger and to feed back to the model. */
  violations: string[];
}

/**
 * Deny-list scan of a handler body. Returns every violation rather than the
 * first, so one repair round can fix them all instead of playing whack-a-mole.
 */
export function staticScan(code: string): StaticScanResult {
  const violations: string[] = [];
  if (!code || !code.trim()) {
    return { ok: false, violations: ['handler code is empty'] };
  }
  if (code.length > 20_000) {
    violations.push('handler code exceeds 20k characters');
  }
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(code)) violations.push(why);
  }
  return { ok: violations.length === 0, violations };
}

/** One smoke case: args in, pass/fail out. */
export interface SmokeCase {
  args: Record<string, unknown>;
  /** Optional label for the ledger. */
  label?: string;
}

export interface CaseOutcome {
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  ms?: number;
}

export interface SmokeResult {
  ok: boolean;
  outcomes: CaseOutcome[];
  /** First failure, formatted for feeding back into the next author call. */
  failureSummary?: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Invoke `name` once per case. ALL cases must succeed. `invoke` is injected so
 * repair can A/B the same cases against two different handlers.
 */
export async function smokeTest(
  cases: SmokeCase[],
  invoke: (args: Record<string, unknown>) => Promise<ToolResult>,
  timeoutMs = CASE_TIMEOUT_MS,
): Promise<SmokeResult> {
  if (cases.length === 0) {
    return { ok: false, outcomes: [], failureSummary: 'no smoke cases supplied' };
  }
  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const result = await withTimeout(invoke(c.args), timeoutMs);
      // A handler that returns nothing (or a non-object) is a bug, not a pass —
      // `calculate_route_eta` died on exactly this shape on 24 Jul.
      const ok = !!result && typeof result === 'object' && result.success === true;
      outcomes.push({
        args: c.args,
        ok,
        error: ok ? undefined : (result?.error ?? 'handler did not return { success: true }'),
        ms: Date.now() - t0,
      });
    } catch (err) {
      outcomes.push({ args: c.args, ok: false, error: errMsg(err), ms: Date.now() - t0 });
    }
  }
  const failed = outcomes.filter((o) => !o.ok);
  return {
    ok: failed.length === 0,
    outcomes,
    failureSummary: failed.length
      ? `${failed.length}/${outcomes.length} case(s) failed. First failure: args=${JSON.stringify(
          failed[0].args,
        ).slice(0, 300)} error=${(failed[0].error ?? '').slice(0, 400)}`
      : undefined,
  };
}

/** Pass count — the comparison metric for repair A/B. */
export function passCount(result: SmokeResult): number {
  return result.outcomes.filter((o) => o.ok).length;
}
