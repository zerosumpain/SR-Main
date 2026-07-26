import { describe, it, expect, vi, beforeEach } from 'vitest';

// The deck-build executor dynamic-imports the site-tools registry; mock it so no
// server-only domain tool tree is loaded. `presentationTool` is the single tool
// the node looks up.
const { presentationTool } = vi.hoisted(() => ({
  presentationTool: {
    name: 'presentation_build_from_spec',
    destructive: false,
    handler: vi.fn(),
  } as { name: string; destructive: boolean; handler: ReturnType<typeof vi.fn> },
}));

vi.mock('$lib/workflows/site-tools/registry', () => ({
  getTool: (name: string) => (name === 'presentation_build_from_spec' ? presentationTool : undefined),
}));

import { deckBuildExecutor } from '$lib/workflows/nodes/deck-build';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return makeExecutionContext({
    runId: 'r1',
    workflowId: 'w1',
    workspaceDir: '/tmp',
    _currentNodeId: 'deck-1',
    ...overrides,
  });
}

const SPEC = [{ title: 'One', layout: 'default', blocks: [{ type: 'heading', text: 'Hi' }] }];

const okResult = {
  success: true,
  data: {
    deckId: 'd1',
    slug: 'weekly-briefing',
    url: 'https://strangeramblings.com/decks/weekly-briefing',
    shareUrl: 'https://strangeramblings.com/decks/weekly-briefing?t=tok',
    slideCount: 1,
    summaryMarkdown: '**[Weekly Briefing](…)** — 1 slides',
  },
};

beforeEach(() => {
  presentationTool.handler.mockReset();
  presentationTool.handler.mockResolvedValue(okResult);
});

describe('deck-build executor', () => {
  it('missing title → throws', async () => {
    await expect(deckBuildExecutor.execute({}, { title: '', spec: JSON.stringify(SPEC) }, makeCtx())).rejects.toThrow(
      /title is required/i,
    );
  });

  it('empty / invalid spec → throws before invoking the tool', async () => {
    await expect(deckBuildExecutor.execute({}, { title: 'X', spec: '' }, makeCtx())).rejects.toThrow(/spec is empty/i);
    await expect(deckBuildExecutor.execute({}, { title: 'X', spec: '{not json' }, makeCtx())).rejects.toThrow(
      /not valid JSON/i,
    );
    await expect(deckBuildExecutor.execute({}, { title: 'X', spec: '[]' }, makeCtx())).rejects.toThrow(
      /non-empty array of slides/i,
    );
    expect(presentationTool.handler).not.toHaveBeenCalled();
  });

  it('dryRun → does NOT invoke the tool, returns simulated output', async () => {
    const res = await deckBuildExecutor.execute(
      {},
      { title: 'Weekly Briefing', spec: JSON.stringify(SPEC) },
      makeCtx({ dryRun: true }),
    );
    expect(presentationTool.handler).not.toHaveBeenCalled();
    expect(res.output).toMatchObject({
      dryRun: true,
      deckId: 'dry-run',
      slug: 'weekly-briefing',
      url: 'https://strangeramblings.com/decks/weekly-briefing',
      shareUrl: 'https://strangeramblings.com/decks/weekly-briefing?t=dry-run',
      slideCount: 1,
    });
  });

  it('success → invokes tool with parsed slides and maps the data envelope', async () => {
    const res = await deckBuildExecutor.execute(
      {},
      { title: 'Weekly Briefing', description: 'desc', spec: JSON.stringify(SPEC), isPublic: true },
      makeCtx(),
    );
    expect(presentationTool.handler).toHaveBeenCalledWith(
      { title: 'Weekly Briefing', description: 'desc', is_public: true, slides: SPEC },
      expect.anything(),
    );
    expect(res.output).toEqual({
      deckId: 'd1',
      slug: 'weekly-briefing',
      url: 'https://strangeramblings.com/decks/weekly-briefing',
      shareUrl: 'https://strangeramblings.com/decks/weekly-briefing?t=tok',
      slideCount: 1,
      summaryMarkdown: '**[Weekly Briefing](…)** — 1 slides',
    });
  });

  it('accepts an object spec with a `slides` array and interpolates string leaves', async () => {
    await deckBuildExecutor.execute(
      { headline: 'Big News' },
      {
        title: 'T',
        spec: { slides: [{ title: '{{input.headline}}', blocks: [{ type: 'heading', text: '{{input.headline}}' }] }] },
      },
      makeCtx(),
    );
    const call = presentationTool.handler.mock.calls[0][0] as { slides: { title: string }[] };
    expect(call.slides[0].title).toBe('Big News');
    expect((call.slides[0] as unknown as { blocks: { text: string }[] }).blocks[0].text).toBe('Big News');
  });

  it('share=false omits shareUrl from the output', async () => {
    const res = await deckBuildExecutor.execute(
      {},
      { title: 'T', spec: JSON.stringify(SPEC), share: false },
      makeCtx(),
    );
    expect(res.output).not.toHaveProperty('shareUrl');
    expect(res.output).toMatchObject({ deckId: 'd1', slug: 'weekly-briefing' });
  });

  it('tool { success:false } → throws (routes to _onError)', async () => {
    presentationTool.handler.mockResolvedValueOnce({ success: false, error: 'spec failed validation — slide 0 overfull' });
    await expect(
      deckBuildExecutor.execute({}, { title: 'T', spec: JSON.stringify(SPEC) }, makeCtx()),
    ).rejects.toThrow(/overfull/);
  });
});
