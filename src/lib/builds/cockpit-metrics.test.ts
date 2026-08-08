import { describe, it, expect } from 'vitest';
import {
  buildCockpitMetrics,
  packagesFromCommand,
  failingTestsFromGateOutput,
} from './cockpit-metrics';

const build = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  status: 'running',
  tokensUsed: 900,
  costUsd: '0.0123',
  iterationsCompleted: 3,
  activeMinutesUsed: 12,
  modelId: 'deepseek/deepseek-v4-flash',
  modelProvider: 'openrouter',
  thinkingLevel: 'medium',
  budgetConfig: { maxIterations: 25, maxTotalMinutes: 120, maxTokensPerIteration: 400 },
  createdAt: new Date('2026-08-08T10:00:00Z'),
  updatedAt: new Date('2026-08-08T10:30:00Z'),
  ...over,
});

const iteration = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  status: 'completed',
  tokensUsed: 300,
  durationMs: 60_000,
  actions: [],
  createdAt: new Date('2026-08-08T10:05:00Z'),
  ...over,
});

describe('packagesFromCommand', () => {
  it('picks packages out of installs', () => {
    expect(packagesFromCommand('npm install lodash zod')).toEqual(['lodash', 'zod']);
    expect(packagesFromCommand('pip3 install requests')).toEqual(['requests']);
  });
  it('ignores flags and bare restores', () => {
    expect(packagesFromCommand('npm install --include=dev')).toEqual([]);
    expect(packagesFromCommand('npm install')).toEqual([]);
  });
  it('ignores commands that are not installs', () => {
    expect(packagesFromCommand('npm run gate')).toEqual([]);
  });
});

describe('failingTestsFromGateOutput', () => {
  it('names the failing test files vitest reported', () => {
    const out = ' ❯ tests/lib/workflows/scheduler-boot.test.ts (1 test | 1 failed) 5335ms';
    expect(failingTestsFromGateOutput(out)).toEqual(['tests/lib/workflows/scheduler-boot.test.ts']);
  });
  it('returns nothing when the run was clean', () => {
    expect(failingTestsFromGateOutput('Tests 400 passed')).toEqual([]);
  });
});

describe('buildCockpitMetrics', () => {
  it('summarises the headline from the build row', () => {
    const m = buildCockpitMetrics(build(), [iteration(1), iteration(2), iteration(3)], []);
    expect(m.headline.tokens).toBe(900);
    expect(m.headline.iterations).toBe(3);
    expect(m.headline.costUsd).toBeCloseTo(0.0123);
    expect(m.headline.tokensPerIteration).toBe(300);
  });

  it('measures the per-iteration cap against the LATEST iteration, not the total', () => {
    // A running total against a per-iteration ceiling would read as permanently
    // over budget and the meter would be meaningless.
    const m = buildCockpitMetrics(build(), [iteration(1), iteration(2, { tokensUsed: 380 })], []);
    const tokenMeter = m.meters.find((x) => x.label === 'Tokens, latest iteration')!;
    expect(tokenMeter.used).toBe(380);
    expect(tokenMeter.state).toBe('near');
  });

  it('flags a meter as over only at the limit', () => {
    const m = buildCockpitMetrics(build(), [iteration(1, { tokensUsed: 400 })], []);
    expect(m.meters.find((x) => x.label === 'Tokens, latest iteration')!.state).toBe('over');
  });

  it('leaves a meter unbounded when the budget has no such cap', () => {
    const m = buildCockpitMetrics(build({ budgetConfig: {} }), [iteration(1)], []);
    for (const x of m.meters) {
      expect(x.limit).toBeNull();
      expect(x.fraction).toBeNull();
    }
  });

  it('counts the command mix and its errors', () => {
    const actions = [
      { lang: 'bash', code: 'npm install zod', exitCode: 0 },
      { lang: 'bash', code: 'ls', exitCode: 1 },
      { lang: 'read', code: 'a.ts', exitCode: 0 },
    ];
    const m = buildCockpitMetrics(build(), [iteration(1, { actions })], []);
    expect(m.commands[0]).toEqual({ name: 'bash', count: 2, errors: 1 });
    expect(m.libraries).toEqual(['zod']);
  });

  it('reads tool-bridge health out of the log stream', () => {
    const m = buildCockpitMetrics(build(), [iteration(1)], [
      { type: 'system', content: 'Tool bridge OK — 157 site tools available to the agent.' },
    ]);
    expect(m.tooling.siteTools).toBe(157);
    expect(m.tooling.healthy).toBe(true);
    expect(m.signals.find((s) => /no site tools/.test(s.text))).toBeUndefined();
  });

  it('raises a critical signal when the bridge was down', () => {
    const m = buildCockpitMetrics(build(), [iteration(1)], [
      { type: 'error', content: 'Tool bridge unavailable — returned 401.' },
    ]);
    expect(m.tooling.healthy).toBe(false);
    expect(m.signals[0].level).toBe('critical');
  });

  it('says nothing about tooling when nothing was reported', () => {
    // An older build predates the preflight. Silence beats a confident guess.
    const m = buildCockpitMetrics(build(), [iteration(1)], []);
    expect(m.tooling.healthy).toBeNull();
    expect(m.tooling.siteTools).toBeNull();
  });

  it('warns about a model id the runtime cannot resolve', () => {
    const m = buildCockpitMetrics(build({ modelId: '~deepseek/deepseek-v4-flash-latest' }), [], []);
    expect(m.model.unresolvableAlias).toBe(true);
    expect(m.signals.some((s) => /alias prefix/.test(s.text))).toBe(true);
  });

  it('spots iterations that changed nothing', () => {
    const m = buildCockpitMetrics(build(), [iteration(1), iteration(2), iteration(3)], []);
    expect(m.signals.some((s) => /changed no files/.test(s.text))).toBe(true);
  });

  it('does not cry no-progress when the agent was writing', () => {
    const actions = [{ lang: 'write', code: 'a.ts', exitCode: 0 }];
    const its = [iteration(1, { actions }), iteration(2, { actions }), iteration(3, { actions })];
    const m = buildCockpitMetrics(build(), its, []);
    expect(m.signals.some((s) => /changed no files/.test(s.text))).toBe(false);
  });

  it('reports the gate verdict and the failing files', () => {
    const m = buildCockpitMetrics(build(), [iteration(1)], [
      { type: 'system', content: 'Running gate: npm run gate ...' },
      { type: 'error', content: 'FAIL Tests: 0/1 passed\n ❯ tests/a.test.ts (1 test | 1 failed)' },
    ]);
    expect(m.gate.ran).toBe(true);
    expect(m.gate.passed).toBe(false);
    expect(m.gate.failingTests).toEqual(['tests/a.test.ts']);
  });

  it('orders signals with the most severe first', () => {
    const m = buildCockpitMetrics(
      build({ modelId: '~x/y', status: 'failed', failure: { kind: 'stalled', message: 'quiet' } }),
      [iteration(1)],
      [{ type: 'error', content: 'Tool bridge unreachable at http://x' }],
    );
    expect(m.signals[0].level).toBe('critical');
  });
});
