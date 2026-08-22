import { describe, expect, it } from 'vitest';
import {
	type AlertNotifier,
	type CreateJobInput,
	type JobProgress,
	type JobStore,
	JobProgressTracker,
	type NotificationClaim
} from '$lib/job-alerts/job-progress';

class MemoryJobStore implements JobStore {
	jobs = new Map<string, JobProgress>();

	async create(input: CreateJobInput, now: Date): Promise<JobProgress> {
		const terminal = input.totalItems === 0;
		const job: JobProgress = {
			...input,
			completedItems: 0,
			failedItems: 0,
			status: terminal ? 'completed' : 'running',
			createdAt: now,
			finishedAt: terminal ? now : null,
			notificationState: 'pending',
			notificationLeaseToken: null,
			notificationLeaseExpiresAt: null
		};
		this.jobs.set(input.id, job);
		return job;
	}

	async advance(id: string, completed: number, failed: number, now: Date): Promise<JobProgress> {
		const job = this.mustGet(id);
		if (job.status !== 'running') throw new Error('job is already terminal');
		const completedItems = job.completedItems + completed;
		const failedItems = job.failedItems + failed;
		if (completedItems + failedItems > job.totalItems) throw new Error('job progress exceeds totalItems');
		const terminal = completedItems + failedItems === job.totalItems;
		const updated: JobProgress = {
			...job,
			completedItems,
			failedItems,
			status: terminal ? (failedItems > 0 ? 'failed' : 'completed') : 'running',
			finishedAt: terminal ? now : null
		};
		this.jobs.set(id, updated);
		return updated;
	}

	async findNotifiable(limit: number, now: Date): Promise<JobProgress[]> {
		return [...this.jobs.values()]
			.filter((job) => job.status !== 'running' && (job.notificationState === 'pending' || (job.notificationLeaseExpiresAt?.getTime() ?? Infinity) <= now.getTime()))
			.slice(0, limit);
	}

	async claimNotification(id: string, token: string, expiresAt: Date, now: Date): Promise<NotificationClaim | null> {
		const job = this.mustGet(id);
		const claimable = job.status !== 'running' && (job.notificationState === 'pending' || (job.notificationLeaseExpiresAt?.getTime() ?? Infinity) <= now.getTime());
		if (!claimable) return null;
		const claimed = { ...job, notificationState: 'sending' as const, notificationLeaseToken: token, notificationLeaseExpiresAt: expiresAt };
		this.jobs.set(id, claimed);
		return { job: claimed, leaseToken: token };
	}

	async acknowledgeNotification(id: string, token: string): Promise<void> {
		const job = this.mustGet(id);
		if (job.notificationLeaseToken !== token) throw new Error('notification lease does not match');
		this.jobs.set(id, { ...job, notificationState: 'sent', notificationLeaseToken: null, notificationLeaseExpiresAt: null });
	}

	async releaseNotification(id: string, token: string): Promise<void> {
		const job = this.mustGet(id);
		if (job.notificationLeaseToken !== token) return;
		this.jobs.set(id, { ...job, notificationState: 'pending', notificationLeaseToken: null, notificationLeaseExpiresAt: null });
	}

	private mustGet(id: string): JobProgress {
		const job = this.jobs.get(id);
		if (!job) throw new Error('job not found');
		return job;
	}
}

describe('JobProgressTracker', () => {
	it('alerts once after all successful work completes', async () => {
		const store = new MemoryJobStore();
		const alerts = [] as Parameters<AlertNotifier['send']>[0][];
		const tracker = new JobProgressTracker(store, { send: async (alert) => void alerts.push(alert) });
		await tracker.start({ id: 'import-1', name: 'Import contacts', totalItems: 2 });
		await tracker.recordSucceeded('import-1');
		const result = await tracker.recordSucceeded('import-1');

		expect(result.job.status).toBe('completed');
		expect(result.notification.delivered).toBe(true);
		expect(alerts).toEqual([{ jobId: 'import-1', jobName: 'Import contacts', status: 'completed', completedItems: 2, failedItems: 0, totalItems: 2 }]);
	});

	it('marks a terminal job failed and keeps a failed notification retryable', async () => {
		const store = new MemoryJobStore();
		let attempts = 0;
		const tracker = new JobProgressTracker(store, { send: async () => { attempts += 1; if (attempts === 1) throw new Error('provider unavailable'); } });
		await tracker.start({ id: 'import-2', name: 'Import contacts', totalItems: 1 });
		const first = await tracker.recordFailure('import-2');
		const retry = await tracker.deliverPending();

		expect(first.job.status).toBe('failed');
		expect(first.notification).toEqual({ attempted: true, delivered: false, error: 'provider unavailable' });
		expect(retry).toEqual([{ attempted: true, delivered: true, error: null }]);
		expect(store.jobs.get('import-2')?.notificationState).toBe('sent');
	});
});
