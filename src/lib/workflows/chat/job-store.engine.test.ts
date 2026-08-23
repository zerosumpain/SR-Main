import { describe, it, expect } from 'vitest';
import { createJob, getJob } from './job-store';

/**
 * `scope.engine` records which engine is running a turn. It exists because the
 * `jkai.chat.hermes_enabled` setting describes the NEXT turn, not this one —
 * and the two diverge as soon as chat fails over to the in-process loop because
 * homeserv is unreachable. A `clarify_ack` routed by the setting rather than by
 * this field gets posted to the wrong engine, which during an outage means a
 * loop job's answer is fired at a gateway that cannot receive it.
 */
describe('OrchestratorJob scope.engine', () => {
  it('records hermes when the Hermes branch creates the job', () => {
    const { jobId } = createJob('hi', { conversationId: 'c1', engine: 'hermes' });
    expect(getJob(jobId)?.scope.engine).toBe('hermes');
  });

  it('records loop when the in-process branch creates the job', () => {
    const { jobId } = createJob('hi', { conversationId: 'c2', engine: 'loop' });
    expect(getJob(jobId)?.scope.engine).toBe('loop');
  });

  it('defaults to loop when the caller does not say', () => {
    const { jobId } = createJob('hi', { conversationId: 'c3' });
    expect(getJob(jobId)?.scope.engine).toBe('loop');
  });

  it('survives on the job so a later ack can route by it', () => {
    const { jobId } = createJob('hi', { conversationId: 'c4', engine: 'hermes' });
    // The ack arrives on a separate request; only the stored job knows the truth.
    const later = getJob(jobId);
    expect(later).not.toBeNull();
    expect(later?.scope.engine).toBe('hermes');
  });
});
