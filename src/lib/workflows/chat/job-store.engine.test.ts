import { describe, it, expect } from 'vitest';
import { createJob, getJob } from './job-store';

/**
 * `scope.engine` records which engine ran a turn, on the job itself.
 *
 * There is one engine now, so the field is a constant — but the property it
 * encodes is not academic. It exists because a setting describes the NEXT turn,
 * not this one, and the two diverged the moment chat failed over. A `clarify_ack`
 * routed by the setting rather than by this field was posted at an engine that
 * could not receive it.
 *
 * Kept, and tested, because the failure returns the day a second engine does:
 * the ack must route by what the job recorded at creation, never by what the
 * system currently prefers.
 */
describe('OrchestratorJob scope.engine', () => {
  it('records the engine the job was created with', () => {
    const { jobId } = createJob('hi', { conversationId: 'c2', engine: 'loop' });
    expect(getJob(jobId)?.scope.engine).toBe('loop');
  });

  it('defaults to loop when the caller does not say', () => {
    const { jobId } = createJob('hi', { conversationId: 'c3' });
    expect(getJob(jobId)?.scope.engine).toBe('loop');
  });

  it('survives on the job so a later ack can route by it', () => {
    const { jobId } = createJob('hi', { conversationId: 'c4', engine: 'loop' });
    // The ack arrives on a separate request; only the stored job knows the truth.
    const later = getJob(jobId);
    expect(later).not.toBeNull();
    expect(later?.scope.engine).toBe('loop');
  });
});
