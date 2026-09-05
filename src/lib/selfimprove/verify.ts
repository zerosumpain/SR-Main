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
export { staticScan } from '$lib/security/authored-scan';
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
