import { describe, it, expect } from 'vitest';
import { interruptedBuildFrom, MAX_BUILD_ATTEMPTS, BUILD_RESUME_WINDOW_MS } from '$lib/workflows/build-state.server';

const BOOT = Date.parse('2026-09-25T09:50:58Z');
const NOW = BOOT + 60_000;

function row(over: Partial<{ workflowId: string | null; content: string; metadata: unknown; createdAt: Date }> = {}) {
  return {
    workflowId: 'wf-1',
    // The exact marker the 09:50:58 deploy stranded — written before the prompt was stored.
    content: 'Building this workflow from your description: “send me a funny / rude joke every hour to my whatsapp. Only run that till 6pm today”',
    metadata: { nativeBuild: { status: 'building' } },
    createdAt: new Date('2026-09-25T09:46:15Z'),
    ...over,
  };
}

describe('interruptedBuildFrom', () => {
  it('recovers a build stranded by a deploy, prompt taken from the quoted chat line', () => {
    expect(interruptedBuildFrom(row(), BOOT, NOW)).toEqual({
      workflowId: 'wf-1',
      prompt: 'send me a funny / rude joke every hour to my whatsapp. Only run that till 6pm today',
      title: null,
      attempt: 1,
    });
  });

  it('prefers the stored prompt and title', () => {
    const r = row({ metadata: { nativeBuild: { status: 'building', resume: { prompt: 'full prompt', title: 'Jokes', attempt: 1 } } } });
    expect(interruptedBuildFrom(r, BOOT, NOW)).toMatchObject({ prompt: 'full prompt', title: 'Jokes', attempt: 1 });
  });

  it('never touches a build THIS process started', () => {
    expect(interruptedBuildFrom(row({ createdAt: new Date(BOOT + 1000) }), BOOT, NOW)).toBeNull();
  });

  it('gives up after the attempt budget, so a build that kills the process cannot loop', () => {
    const r = row({ metadata: { nativeBuild: { status: 'building', resume: { prompt: 'p', title: null, attempt: MAX_BUILD_ATTEMPTS } } } });
    expect(interruptedBuildFrom(r, BOOT, NOW)).toBeNull();
  });

  it('ignores finished, failed and ancient builds', () => {
    expect(interruptedBuildFrom(row({ metadata: { nativeBuild: { status: 'done' } } }), BOOT, NOW)).toBeNull();
    expect(interruptedBuildFrom(row({ metadata: { nativeBuild: { status: 'failed', error: 'x' } } }), BOOT, NOW)).toBeNull();
    expect(interruptedBuildFrom(row({ createdAt: new Date(NOW - BUILD_RESUME_WINDOW_MS - 1) }), BOOT, NOW)).toBeNull();
  });

  it('cannot resume without a prompt', () => {
    expect(interruptedBuildFrom(row({ content: 'Building…' }), BOOT, NOW)).toBeNull();
  });
});
