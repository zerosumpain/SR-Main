// Derived metrics for the build cockpit.
//
// Pure functions over rows the page already loads — no DB access, no fetching,
// so the whole thing is unit-testable and the component stays a renderer.
//
// Everything here is DERIVED, never invented: if the data cannot answer a
// question the field comes back null and the UI says nothing rather than
// guessing. A cockpit that displays a confident wrong number is worse than one
// that admits a gap — this system spent a day on a confident wrong number
// (2026-08-07).

import type { BudgetConfig, FailureEnvelope } from '$lib/jkai/types';

/** One recorded agent action. `lang` is the tool name (bash/read/edit/…). */
interface RawAction {
  lang?: string;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface RawIteration {
  number: number;
  status: string;
  tokensUsed?: number | null;
  durationMs?: number | null;
  actions?: unknown;
  evaluation?: string | null;
  nextSteps?: string | null;
  failure?: unknown;
  createdAt?: Date | string | null;
}

interface RawBuild {
  id: string;
  status: string;
  title?: string | null;
  tokensUsed?: number | null;
  costUsd?: string | number | null;
  iterationsCompleted?: number | null;
  activeMinutesUsed?: number | null;
  modelId?: string | null;
  modelProvider?: string | null;
  thinkingLevel?: string | null;
  budgetConfig?: unknown;
  failure?: unknown;
  origin?: string | null;
  gitTargetConfig?: unknown;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

interface RawLog {
  type: string;
  content: string;
  createdAt?: Date | string | null;
}

export interface Meter {
  label: string;
  used: number;
  limit: number | null;
  /** 0–1, or null when there is no limit to be a fraction of. */
  fraction: number | null;
  unit: 'tokens' | 'minutes' | 'iterations' | 'usd';
  /** 'ok' | 'near' (>=75%) | 'over' (>=100%) — status, not decoration. */
  state: 'ok' | 'near' | 'over';
}

export interface IterationPoint {
  number: number;
  status: string;
  tokens: number;
  durationMs: number;
  actionCount: number;
  errorCount: number;
  writeCount: number;
  failureKind: string | null;
}

export interface CommandUse {
  name: string;
  count: number;
  errors: number;
}

export interface CockpitMetrics {
  headline: {
    status: string;
    iterations: number;
    tokens: number;
    costUsd: number | null;
    elapsedMs: number | null;
    activeMinutes: number | null;
    tokensPerIteration: number | null;
  };
  meters: Meter[];
  iterations: IterationPoint[];
  commands: CommandUse[];
  /** Packages the agent installed, from bash npm/pip/apt invocations. */
  libraries: string[];
  model: {
    id: string | null;
    provider: string | null;
    thinkingLevel: string | null;
    /** A `~`/`@` alias prefix pi cannot resolve — no context-window metadata. */
    unresolvableAlias: boolean;
  };
  tooling: {
    /** Site tools the bridge handed the agent, or null when never reported. */
    siteTools: number | null;
    healthy: boolean | null;
    detail: string | null;
  };
  gate: {
    ran: boolean;
    passed: boolean | null;
    failingTests: string[];
  };
  /** Things worth a human's attention, most severe first. */
  signals: Array<{ level: 'critical' | 'warn' | 'info'; text: string }>;
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

function meterState(fraction: number | null): Meter['state'] {
  if (fraction === null) return 'ok';
  if (fraction >= 1) return 'over';
  if (fraction >= 0.75) return 'near';
  return 'ok';
}

function meter(label: string, used: number, limit: number | null, unit: Meter['unit']): Meter {
  const fraction = limit && limit > 0 ? used / limit : null;
  return { label, used, limit, fraction, unit, state: meterState(fraction) };
}

/** Package names from a shell command, when it is an install. */
export function packagesFromCommand(cmd: string): string[] {
  const out: string[] = [];
  const re = /\b(?:npm\s+(?:i|install|add)|pnpm\s+add|yarn\s+add|pip3?\s+install|apt-get\s+install)\s+([^\n&|;]+)/g;
  for (const m of cmd.matchAll(re)) {
    for (const raw of m[1].split(/\s+/)) {
      const tok = raw.trim();
      // Skip flags, and skip a bare `npm install` (no package = a restore).
      if (!tok || tok.startsWith('-')) continue;
      out.push(tok);
    }
  }
  return out;
}

/** Failing test files named in a vitest run, from the gate's captured output. */
export function failingTestsFromGateOutput(output: string): string[] {
  const found = new Set<string>();
  // vitest prints `❯ path/to/file.test.ts (1 test | 1 failed)` for each file.
  for (const m of output.matchAll(/[❯>]\s+(\S+\.test\.[tj]sx?)\s/g)) found.add(m[1]);
  return [...found];
}

export function buildCockpitMetrics(
  build: RawBuild,
  iterations: RawIteration[],
  logs: RawLog[],
): CockpitMetrics {
  const budget = (build.budgetConfig ?? {}) as BudgetConfig;

  // --- Per-iteration series -------------------------------------------------
  const points: IterationPoint[] = iterations.map((it) => {
    const actions = Array.isArray(it.actions) ? (it.actions as RawAction[]) : [];
    const failure = (it.failure ?? null) as FailureEnvelope | null;
    return {
      number: it.number,
      status: it.status,
      tokens: toNum(it.tokensUsed),
      durationMs: toNum(it.durationMs),
      actionCount: actions.length,
      errorCount: actions.filter((a) => toNum(a.exitCode) !== 0).length,
      writeCount: actions.filter((a) => a.lang === 'write' || a.lang === 'edit').length,
      failureKind: failure?.kind ?? null,
    };
  });

  // --- Command mix ----------------------------------------------------------
  const cmdMap = new Map<string, CommandUse>();
  const libs = new Set<string>();
  for (const it of iterations) {
    const actions = Array.isArray(it.actions) ? (it.actions as RawAction[]) : [];
    for (const a of actions) {
      const name = (a.lang ?? 'unknown').trim() || 'unknown';
      const entry = cmdMap.get(name) ?? { name, count: 0, errors: 0 };
      entry.count += 1;
      if (toNum(a.exitCode) !== 0) entry.errors += 1;
      cmdMap.set(name, entry);
      if (name === 'bash' && typeof a.code === 'string') {
        for (const p of packagesFromCommand(a.code)) libs.add(p);
      }
    }
  }
  const commands = [...cmdMap.values()].sort((a, b) => b.count - a.count);

  // --- Headline -------------------------------------------------------------
  const started = toDate(build.createdAt);
  const ended = toDate(build.updatedAt);
  const terminal = build.status === 'completed' || build.status === 'failed';
  const elapsedMs = started ? ((terminal && ended ? ended.getTime() : Date.now()) - started.getTime()) : null;

  const tokens = toNum(build.tokensUsed);
  const iterationsDone = toNum(build.iterationsCompleted);
  const costRaw = build.costUsd == null ? null : toNum(build.costUsd);

  // --- Meters ---------------------------------------------------------------
  // The per-iteration cap applies to the CURRENT iteration, so show the latest
  // one rather than the total — a total against a per-iteration cap would read
  // as permanently over budget.
  const latest = points.length ? points[points.length - 1] : null;
  const meters: Meter[] = [
    meter('Iterations', iterationsDone, budget.maxIterations ?? null, 'iterations'),
    meter('Active minutes', toNum(build.activeMinutesUsed), budget.maxTotalMinutes ?? null, 'minutes'),
    meter(
      'Tokens, latest iteration',
      latest?.tokens ?? 0,
      budget.maxTokensPerIteration ?? null,
      'tokens',
    ),
    meter('Tokens, last hour', tokensInLastHour(iterations), budget.maxTokensPerHour ?? null, 'tokens'),
  ];

  // --- Tooling + gate, read from the log stream -----------------------------
  let siteTools: number | null = null;
  let toolingHealthy: boolean | null = null;
  let toolingDetail: string | null = null;
  let gateRan = false;
  let gatePassed: boolean | null = null;
  let failingTests: string[] = [];

  for (const l of logs) {
    const c = l.content ?? '';
    const okMatch = c.match(/Tool bridge OK — (\d+) site tools/);
    if (okMatch) {
      siteTools = Number.parseInt(okMatch[1], 10);
      toolingHealthy = true;
      toolingDetail = null;
      continue;
    }
    if (/Tool bridge (unavailable|unreachable)/.test(c)) {
      toolingHealthy = false;
      siteTools = 0;
      toolingDetail = c.slice(0, 240);
      continue;
    }
    if (/^Running gate:/.test(c)) gateRan = true;
    if (/^PASS Tests:/.test(c)) {
      gatePassed = true;
      failingTests = [];
    }
    if (/^FAIL Tests:/.test(c)) {
      gatePassed = false;
      failingTests = failingTestsFromGateOutput(c);
    }
  }

  // --- Signals --------------------------------------------------------------
  const modelId = build.modelId ?? null;
  const unresolvableAlias = !!modelId && /^[~@]/.test(modelId);
  const signals: CockpitMetrics['signals'] = [];

  if (toolingHealthy === false) {
    signals.push({
      level: 'critical',
      text: 'The tool bridge did not load — this build ran with no site tools.',
    });
  }
  if (unresolvableAlias) {
    signals.push({
      level: 'warn',
      text: `Model id "${modelId}" carries an alias prefix the agent runtime cannot resolve, so it has no context-window metadata.`,
    });
  }
  const buildFailure = (build.failure ?? null) as FailureEnvelope | null;
  if (buildFailure?.kind) {
    signals.push({
      level: build.status === 'failed' ? 'critical' : 'warn',
      text: `Last failure: ${buildFailure.kind} — ${buildFailure.message ?? ''}`.trim(),
    });
  }
  if (gatePassed === false && failingTests.length) {
    signals.push({
      level: 'warn',
      text: `Gate failing on ${failingTests.length} test file${failingTests.length === 1 ? '' : 's'}: ${failingTests.join(', ')}`,
    });
  }
  const idle = points.filter((p) => p.writeCount === 0).length;
  if (idle >= 2) {
    signals.push({
      level: 'warn',
      text: `${idle} iterations changed no files — the agent may be looping on verification rather than making progress.`,
    });
  }
  const capped = points.filter((p) => p.failureKind === 'iteration_token_cap').length;
  if (capped >= 2) {
    signals.push({
      level: 'warn',
      text: `${capped} iterations hit the per-iteration token ceiling — consider a narrower request or a larger cap.`,
    });
  }

  const order = { critical: 0, warn: 1, info: 2 } as const;
  signals.sort((a, b) => order[a.level] - order[b.level]);

  return {
    headline: {
      status: build.status,
      iterations: iterationsDone,
      tokens,
      costUsd: costRaw,
      elapsedMs,
      activeMinutes: build.activeMinutesUsed == null ? null : toNum(build.activeMinutesUsed),
      tokensPerIteration: points.length ? Math.round(tokens / points.length) : null,
    },
    meters,
    iterations: points,
    commands,
    libraries: [...libs].sort(),
    model: {
      id: modelId,
      provider: build.modelProvider ?? null,
      thinkingLevel: build.thinkingLevel ?? null,
      unresolvableAlias,
    },
    tooling: { siteTools, healthy: toolingHealthy, detail: toolingDetail },
    gate: { ran: gateRan, passed: gatePassed, failingTests },
    signals,
  };
}

/** Tokens across iterations started in the last hour — mirrors checkBudget's window. */
function tokensInLastHour(iterations: RawIteration[]): number {
  const cutoff = Date.now() - 60 * 60 * 1000;
  return iterations.reduce((sum, it) => {
    const at = toDate(it.createdAt);
    if (!at || at.getTime() < cutoff) return sum;
    return sum + toNum(it.tokensUsed);
  }, 0);
}
