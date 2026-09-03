import { describe, expect, it } from 'vitest';
import {
  buildDeployedCapabilities,
  jkaiTestPromptFor,
  pickPromotionCandidate,
  runLiveToolTest,
} from './deployment';
import type { CustomToolHealth } from './context';
import type { AttemptEvidenceRow } from './deployment';

const tool: CustomToolHealth = {
  name: 'current_school_data',
  description: 'Reads current school data from an official source',
  toolset: 'self-improve',
  enabled: true,
  runCount: 3,
  errorCount: 0,
  errorRate: 0,
  createdAt: '2026-09-03T10:00:00.000Z',
};

const attempt: AttemptEvidenceRow = {
  key: 'run:current_school_data',
  createdAt: '2026-09-03T10:00:00.000Z',
  data: {
    runId: 'run',
    name: tool.name,
    description: tool.description,
    toolset: 'self-improve',
    status: 'created',
    shipped: true,
    handlerCode: 'return { success: true };',
    parameters: { type: 'object', properties: {} },
    sampleArgs: { urn: '100000' },
    attemptedAt: '2026-09-03T10:00:00.000Z',
    liveTests: [
      {
        testedAt: '2026-09-03T11:00:00.000Z',
        args: { urn: '100000' },
        success: true,
        ms: 12,
      },
    ],
  },
};

describe('deployed capability acceptance', () => {
  it('subtracts harness runs and makes repeatedly used, accepted tools promotable', () => {
    const [capability] = buildDeployedCapabilities([attempt], [tool]);
    expect(capability.jkaiRuns).toBe(2);
    expect(capability.promotionReady).toBe(true);
    expect(pickPromotionCandidate([capability])?.name).toBe(tool.name);
  });

  it('never promotes a tool without a successful deployed test', () => {
    const untested = { ...attempt, data: { ...attempt.data, liveTests: [] } };
    const [capability] = buildDeployedCapabilities([untested], [tool]);
    expect(capability.promotionReady).toBe(false);
  });

  it('recognises an already-promoted tool', () => {
    const [capability] = buildDeployedCapabilities([attempt], [tool], [tool.name]);
    expect(capability.promoted).toBe(true);
    expect(capability.promotionReady).toBe(false);
  });

  it('distinguishes a running promotion trial from a kept promotion', () => {
    const [capability] = buildDeployedCapabilities(
      [attempt],
      [tool],
      [tool.name],
      tool.name,
    );
    expect(capability.promoted).toBe(false);
    expect(capability.promotionTrial).toBe(true);
    expect(capability.promotionReady).toBe(false);
  });

  it('builds an outcome-led JKAI prompt without leaking the tool name', () => {
    const prompt = jkaiTestPromptFor({
      serves: 'You could not ask what the current school roll is',
      description: tool.description,
    });
    expect(prompt).toContain('Tell me what the current school roll is');
    expect(prompt).toContain('current live data');
    expect(prompt).not.toContain(tool.name);
  });

  it('runs against the supplied live registry seam and records the result', async () => {
    const result = await runLiveToolTest({ urn: '100000' }, async (args) => ({
      success: true,
      data: { urn: args.urn, pupils: 300 },
    }));
    expect(result.result.success).toBe(true);
    expect(result.test).toMatchObject({ success: true, args: { urn: '100000' } });
    expect(result.test.resultSummary).toContain('pupils');
  });

  it('turns a timeout into failed acceptance evidence', async () => {
    const result = await runLiveToolTest(
      {},
      async () => new Promise(() => undefined),
      5,
    );
    expect(result.test.success).toBe(false);
    expect(result.test.error).toMatch(/timed out/);
  });
});
