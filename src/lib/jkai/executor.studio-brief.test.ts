import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResearchBrief } from './research-brief';

/**
 * SEAM-2 regression.
 *
 * The research brief had exactly two readers — the planner, and the studio
 * gate's `sourceUrls` list. It was never placed in any iteration's context.
 * Meanwhile STUDIO_SYSTEM_PROMPT told the agent "Your research brief is in the
 * context below" (false on every iteration) and chapter contract point 4
 * required an `<a data-citation>` pointing at one of the brief's sources, which
 * studio-gate then checked against the brief's fact hosts. The agent was graded
 * on citing a document it had never been shown, so `uncited` fired on every
 * chapter forever with a remedy naming something not in context.
 *
 * Nothing failed when the brief was absent. That is what these assertions fix:
 * they read the system prompt actually handed to pi.
 */

const runPi = vi.fn(async (_opts: { systemPrompt: string }) => ({
  actions: [],
  messages: [],
  tokensUsed: 0,
  failure: null,
  finalAssistantText: '## Evaluation\nok\n\n## Next Steps\nnext',
  errorMessage: null,
}));

vi.mock('./pi-runner', () => ({ runPi }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./log-emitter', () => ({ emitLog: vi.fn(async () => {}), emitLive: vi.fn(() => {}) }));
vi.mock('./tool-bridge', () => ({ signBridgeToken: () => 'tok' }));
vi.mock('./workflow-deliveries', () => ({ consumePendingDeliveries: async () => [] }));
vi.mock('./workflow-grounding', () => ({
  buildAttachedWorkflowGrounding: async () => '',
  buildDeliveriesBlock: () => '',
}));
vi.mock('./build-notes', () => ({
  listNotes: async () => [],
  formatNotesForPrompt: () => '--- PINNED NOTE ---',
}));
vi.mock('./pending-messages', () => ({
  drainPendingMessages: async () => [],
  formatPendingForPrompt: () => '--- PENDING MESSAGE ---',
}));
vi.mock('./codebase-digest', () => ({ buildCodebaseDigest: async () => '' }));
vi.mock('./sandbox', () => ({
  listWorkspaceFiles: async () => '',
  listDevFiles: async () => [],
  allocatePort: async () => 8123,
  ensureSandboxRunning: async () => {},
  ensureWorkspace: async () => {},
  ensureDepsInstalled: async () => false,
  syncDesignAssets: async () => '/ds',
  syncJkaiExtension: async () => '/ext',
  syncExplainerKit: async () => '/kit',
}));

// preflightToolBridge fetches the manifest; it swallows every error, but a real
// socket attempt in a unit test is noise.
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ tools: [] }) })));

const { executeIteration } = await import('./executor');

const BRIEF: ResearchBrief = {
  topic: 'school funding',
  facts: [
    { claim: 'The basic entitlement is per-pupil', sourceUrl: 'https://gov.uk/nff-basic-entitlement' },
    { claim: 'Deprivation uplift uses FSM6', sourceUrl: 'https://gov.uk/nff-deprivation' },
  ],
  concepts: [{ name: 'Basic entitlement', whyHard: 'per-pupil but not per-pupil-equal' }],
  causalMap: [{ from: 'roll', to: 'budget', relationship: 'scales' }],
  liveData: [{ name: 'NFF tables', url: 'https://gov.uk/nff-tables', what: 'per-school allocations' }],
  misconceptions: ['Funding follows need linearly.'],
  gaps: ['No public figure for in-year adjustments.'],
  sessionId: 'rs_1',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function build(over: Record<string, unknown> = {}): any {
  return {
    id: 'b1',
    prompt: 'Explain how the National Funding Formula decides what a school receives.',
    origin: 'studio',
    researchBrief: BRIEF,
    chapterPlan: [{ n: 1, title: 'What a budget is', leverId: 'roll', outcomeId: 'total' }],
    gitTargetConfig: null,
    enforceDesignSystem: true,
    attachedWorkflowIds: [],
    thinkingLevel: 'medium',
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iteration: any = { id: 'it1', number: 2 };

async function systemPromptFor(b: unknown): Promise<string> {
  runPi.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await executeIteration(b as any, iteration, null, 'the plan', 2, () => false);
  expect(runPi).toHaveBeenCalledTimes(1);
  return runPi.mock.calls[0][0].systemPrompt;
}

describe('studio research brief injection', () => {
  beforeEach(() => runPi.mockClear());

  it('puts the brief in the system prompt the agent actually receives', async () => {
    const p = await systemPromptFor(build());
    expect(p).toContain('# Research Brief — school funding');
    expect(p).toContain('## FACTS');
    expect(p).toContain('The basic entitlement is per-pupil');
  });

  it('makes the prompt\'s "your research brief is in the context below" claim true', async () => {
    // The claim and the brief must travel together. Before this fix the
    // sentence shipped on every studio iteration and was never once accurate.
    const p = await systemPromptFor(build());
    expect(p).toMatch(/Your research brief is in the context below/);
    expect(p).toContain('# Research Brief —');
  });

  it('gives the agent the source URLs the gate grades its citations against', async () => {
    // studio-gate resolves each chapter's <a data-citation href> against
    // brief.facts[].sourceUrl. An agent that has not seen them cannot pass.
    const p = await systemPromptFor(build());
    for (const f of BRIEF.facts) expect(p).toContain(f.sourceUrl);
  });

  it('keeps the brief ahead of the notes and pending-message blocks', async () => {
    // A user's later instruction must still have the last word.
    const p = await systemPromptFor(build());
    expect(p.indexOf('# Research Brief —')).toBeGreaterThan(-1);
    expect(p.indexOf('# Research Brief —')).toBeLessThan(p.indexOf('--- PINNED NOTE ---'));
    expect(p.indexOf('--- PINNED NOTE ---')).toBeLessThan(p.indexOf('--- PENDING MESSAGE ---'));
  });

  it('does not inject a brief into a non-studio build', async () => {
    // Non-studio behaviour must be untouched, even in the unreachable case
    // where an app build somehow carries a brief.
    const p = await systemPromptFor(build({ origin: 'app', researchBrief: BRIEF }));
    expect(p).not.toContain('# Research Brief —');
  });

  it('does not inject a brief into a git-target build, which is repo mode', async () => {
    const p = await systemPromptFor(
      build({ origin: 'studio', gitTargetConfig: { gateCommand: 'npm run gate' } }),
    );
    expect(p).not.toContain('# Research Brief —');
  });

  it('survives a studio build with no brief instead of throwing', async () => {
    const p = await systemPromptFor(build({ researchBrief: null }));
    expect(p).not.toContain('# Research Brief —');
    expect(p).toContain('THE CHAPTER CONTRACT');
  });

  it('says so loudly when a studio build has no brief', async () => {
    const { emitLog } = await import('./log-emitter');
    (emitLog as unknown as ReturnType<typeof vi.fn>).mockClear();
    await systemPromptFor(build({ researchBrief: null }));
    const errors = (emitLog as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1] === 'error' && String(c[2]).includes('no research brief'),
    );
    expect(errors).toHaveLength(1);
  });
});
