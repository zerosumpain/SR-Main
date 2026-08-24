import { describe, it, expect, beforeEach } from 'vitest';
import {
  createJob, getJob, markJobQueued, clearJobQueued,
  getRunningJobIdForConversation, whenJobSettles, cancelJob,
} from '$lib/workflows/chat/job-store';

/** How the orchestrator itself completes a turn — it mutates status directly. */
function finish(jobId: string): void {
  const j = getJob(jobId);
  if (j) j.status = 'done';
}

/**
 * A second message sent while the first is still answering must WAIT, not run
 * alongside it. The Hermes branch has queued since the cutover; the in-process
 * branch did not, so two turns streamed into the same conversation at once and
 * both appended to history — which is how an answer arrives interleaved with the
 * one before it.
 *
 * These pin the store behaviour the loop now depends on.
 */
describe('turn queueing on one conversation', () => {
  it('finds the running job for a conversation, which is what the loop queues behind', () => {
    const { jobId } = createJob('first', { conversationId: 'conv-a', engine: 'loop' });
    expect(getRunningJobIdForConversation('conv-a')).toBe(jobId);
  });

  it('does not confuse conversations', () => {
    createJob('first', { conversationId: 'conv-b', engine: 'loop' });
    expect(getRunningJobIdForConversation('conv-c')).toBeNull();
  });

  it('marks the second job queued behind the first', () => {
    const a = createJob('first', { conversationId: 'conv-d', engine: 'loop' });
    const b = createJob('second', { conversationId: 'conv-d', engine: 'loop' });
    markJobQueued(b.jobId, a.jobId);
    expect(getJob(b.jobId)?.queuedBehind).toBe(a.jobId);
  });

  it('whenJobSettles resolves only once the first job is no longer running', async () => {
    const a = createJob('first', { conversationId: 'conv-e', engine: 'loop' });
    const b = createJob('second', { conversationId: 'conv-e', engine: 'loop' });
    markJobQueued(b.jobId, a.jobId);

    let settled = false;
    const wait = whenJobSettles(a.jobId).then(() => { settled = true; });

    await new Promise((r) => setTimeout(r, 60));
    expect(settled, 'must not resolve while the first job is running').toBe(false);

    finish(a.jobId);
    await wait;
    expect(settled).toBe(true);

    clearJobQueued(b.jobId);
    expect(getJob(b.jobId)?.queuedBehind).toBeNull();
  });

  it('resolves immediately when the job it waits on is already finished', async () => {
    const a = createJob('first', { conversationId: 'conv-f', engine: 'loop' });
    finish(a.jobId);
    // No hang: a race where the first turn ends before the second even queues.
    await expect(whenJobSettles(a.jobId)).resolves.toBeUndefined();
  });

  it('resolves immediately for a job that never existed', async () => {
    await expect(whenJobSettles('no-such-job')).resolves.toBeUndefined();
  });

  it('a queued job is still cancellable while it waits', () => {
    const a = createJob('first', { conversationId: 'conv-g', engine: 'loop' });
    const b = createJob('second', { conversationId: 'conv-g', engine: 'loop' });
    markJobQueued(b.jobId, a.jobId);
    // The loop checks this after waking, so a user who gave up does not get a
    // turn they cancelled.
    getJob(b.jobId)!.abortController.abort();
    expect(getJob(b.jobId)!.abortController.signal.aborted).toBe(true);
  });

  it('a cancelled first turn releases the queued one — it must not wait for ever', async () => {
    const a = createJob('first', { conversationId: 'conv-h', engine: 'loop' });
    const b = createJob('second', { conversationId: 'conv-h', engine: 'loop' });
    markJobQueued(b.jobId, a.jobId);
    cancelJob(a.jobId);
    await expect(whenJobSettles(a.jobId)).resolves.toBeUndefined();
  });
});
