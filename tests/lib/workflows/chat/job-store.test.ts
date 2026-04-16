import { describe, it, expect, beforeEach } from 'vitest';
import { createJob, getJob, cancelJob, cancelAllRunning, cleanOldJobs } from '$lib/workflows/chat/job-store';

describe('job-store', () => {
  beforeEach(() => {
    cancelAllRunning('test cleanup');
    cleanOldJobs(0);
  });

  it('creates a job with running status', () => {
    const { jobId, job } = createJob('hello');
    expect(jobId).toBeTruthy();
    expect(job.status).toBe('running');
    expect(job.message).toBe('hello');
  });

  it('retrieves a job by ID', () => {
    const { jobId } = createJob('test');
    const job = getJob(jobId);
    expect(job).toBeTruthy();
    expect(job!.status).toBe('running');
  });

  it('returns null for unknown job', () => {
    expect(getJob('nonexistent')).toBeNull();
  });

  it('cancels a running job', () => {
    const { jobId, job } = createJob('test');
    cancelJob(jobId);
    expect(job.status).toBe('cancelled');
    expect(job.error).toBe('Cancelled by user');
  });

  it('cancelAllRunning cancels all running jobs', () => {
    const { job: job1 } = createJob('a');
    const { job: job2 } = createJob('b');
    cancelAllRunning('superseded');
    expect(job1.status).toBe('cancelled');
    expect(job2.status).toBe('cancelled');
  });
});
