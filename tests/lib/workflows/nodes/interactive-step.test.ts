import { describe, it, expect, vi } from 'vitest';

const { startInteractiveSession, createInteraction } = vi.hoisted(() => ({
  startInteractiveSession: vi.fn(),
  createInteraction: vi.fn(),
}));

vi.mock('$lib/workflows/scraper/interactive', () => ({
  startInteractiveSession: (...a: any[]) => startInteractiveSession(...a),
}));
vi.mock('$lib/workflows/engine-interactions', () => ({
  createInteraction: (...a: any[]) => createInteraction(...a),
}));

import { interactiveStepExecutor } from '$lib/workflows/nodes/interactive-step';

const ctx: any = { runId: 'run-uuid-1', workflowId: 'wf-1', emit: vi.fn() };

describe('interactiveStepExecutor', () => {
  it('vnc mode: launches session, creates interaction, returns pause sentinel', async () => {
    startInteractiveSession.mockResolvedValue({
      sessionId: 'vnc-1', wsPort: 7900, vncUrl: '/vnc.html', expiresAt: '2026-01-01T00:00:00Z',
    });
    createInteraction.mockResolvedValue(42);

    const result = await interactiveStepExecutor.execute(
      { someUpstream: 'data' },
      {
        mode: 'vnc',
        profile: 'csj',
        url: 'https://example.com',
        prompt: 'Solve the CAPTCHA',
        timeoutMinutes: 30,
      },
      ctx,
    );

    expect(startInteractiveSession).toHaveBeenCalledWith('csj', 'https://example.com');
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-uuid-1',
      mode: 'vnc',
      vncSessionId: 'vnc-1',
      timeoutMinutes: 30,
    }));
    expect(result.pause?.reason).toBe('awaiting_human');
    expect(result.pause?.interactionId).toBe(42);
  });

  it('confirm mode: no vnc launch, just persists interaction', async () => {
    createInteraction.mockResolvedValue(43);
    startInteractiveSession.mockClear();

    const result = await interactiveStepExecutor.execute(
      {},
      {
        mode: 'confirm',
        prompt: 'Review and approve',
        fields: [{ name: 'notes', type: 'text', label: 'Notes' }],
      },
      ctx,
    );

    expect(startInteractiveSession).not.toHaveBeenCalled();
    expect(createInteraction).toHaveBeenCalledWith(expect.objectContaining({ mode: 'confirm' }));
    expect(result.pause?.interactionId).toBe(43);
  });

  it('interpolates url from input for vnc mode', async () => {
    startInteractiveSession.mockResolvedValue({ sessionId: 's', wsPort: 7900, vncUrl: '/', expiresAt: '' });
    createInteraction.mockResolvedValue(44);

    await interactiveStepExecutor.execute(
      { target: 'https://news.ycombinator.com/' },
      {
        mode: 'vnc',
        profile: 'p',
        url: '{{input.target}}',
      },
      ctx,
    );
    expect(startInteractiveSession).toHaveBeenCalledWith('p', 'https://news.ycombinator.com/');
  });
});
