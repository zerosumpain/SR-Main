export type JobStatus = 'running' | 'completed' | 'failed';
export type NotificationState = 'pending' | 'sending' | 'sent';

export interface JobProgress {
	id: string;
	name: string;
	totalItems: number;
	completedItems: number;
	failedItems: number;
	status: JobStatus;
	createdAt: Date;
	finishedAt: Date | null;
	notificationState: NotificationState;
	notificationLeaseToken: string | null;
	notificationLeaseExpiresAt: Date | null;
}

export interface CreateJobInput {
	id: string;
	name: string;
	totalItems: number;
}

export interface NotificationClaim {
	job: JobProgress;
	leaseToken: string;
}

/**
 * Implement these operations as atomic database updates. This keeps progress and
 * notification delivery durable even when multiple workers handle one job.
 */
export interface JobStore {
	create(input: CreateJobInput, now: Date): Promise<JobProgress>;
	advance(jobId: string, completedItems: number, failedItems: number, now: Date): Promise<JobProgress>;
	findNotifiable(limit: number, now: Date): Promise<JobProgress[]>;
	claimNotification(jobId: string, leaseToken: string, leaseExpiresAt: Date, now: Date): Promise<NotificationClaim | null>;
	acknowledgeNotification(jobId: string, leaseToken: string, now: Date): Promise<void>;
	releaseNotification(jobId: string, leaseToken: string, now: Date): Promise<void>;
}

export interface JobAlert {
	jobId: string;
	jobName: string;
	status: Extract<JobStatus, 'completed' | 'failed'>;
	completedItems: number;
	failedItems: number;
	totalItems: number;
}

export interface AlertNotifier {
	send(alert: JobAlert): Promise<void>;
}

export interface NotificationAttempt {
	attempted: boolean;
	delivered: boolean;
	error: string | null;
}

export interface JobUpdateResult {
	job: JobProgress;
	notification: NotificationAttempt;
}

export interface JobProgressTrackerOptions {
	now?: () => Date;
	newLeaseToken?: () => string;
	leaseDurationMs?: number;
}

const defaultLeaseDurationMs = 60_000;

export class JobProgressTracker {
	private readonly now: () => Date;
	private readonly newLeaseToken: () => string;
	private readonly leaseDurationMs: number;

	constructor(
		private readonly store: JobStore,
		private readonly notifier: AlertNotifier,
		options: JobProgressTrackerOptions = {}
	) {
		this.now = options.now ?? (() => new Date());
		this.newLeaseToken = options.newLeaseToken ?? (() => crypto.randomUUID());
		this.leaseDurationMs = options.leaseDurationMs ?? defaultLeaseDurationMs;
		if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
			throw new Error('leaseDurationMs must be a positive safe integer');
		}
	}

	async start(input: CreateJobInput): Promise<JobUpdateResult> {
		validateCreateInput(input);
		const job = await this.store.create(input, this.now());
		return { job, notification: await this.notifyIfTerminal(job.id) };
	}

	async recordSucceeded(jobId: string, count = 1): Promise<JobUpdateResult> {
		return this.record(jobId, count, 0);
	}

	async recordFailure(jobId: string, count = 1): Promise<JobUpdateResult> {
		return this.record(jobId, 0, count);
	}

	async deliverPending(limit = 100): Promise<NotificationAttempt[]> {
		if (!Number.isSafeInteger(limit) || limit <= 0) {
			throw new Error('limit must be a positive safe integer');
		}
		const jobs = await this.store.findNotifiable(limit, this.now());
		return Promise.all(jobs.map((job) => this.notifyIfTerminal(job.id)));
	}

	private async record(jobId: string, completedItems: number, failedItems: number): Promise<JobUpdateResult> {
		validateCount(completedItems, 'completedItems');
		validateCount(failedItems, 'failedItems');
		if (completedItems + failedItems === 0) throw new Error('at least one item must be recorded');
		const job = await this.store.advance(jobId, completedItems, failedItems, this.now());
		return { job, notification: await this.notifyIfTerminal(job.id) };
	}

	private async notifyIfTerminal(jobId: string): Promise<NotificationAttempt> {
		const now = this.now();
		const leaseToken = this.newLeaseToken();
		const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
		const claim = await this.store.claimNotification(jobId, leaseToken, leaseExpiresAt, now);
		if (claim === null) return { attempted: false, delivered: false, error: null };

		try {
			await this.notifier.send(toAlert(claim.job));
			await this.store.acknowledgeNotification(jobId, leaseToken, this.now());
			return { attempted: true, delivered: true, error: null };
		} catch (error) {
			await this.store.releaseNotification(jobId, leaseToken, this.now());
			return { attempted: true, delivered: false, error: errorMessage(error) };
		}
	}
}

function toAlert(job: JobProgress): JobAlert {
	if (job.status === 'running') throw new Error('cannot notify for a running job');
	return {
		jobId: job.id,
		jobName: job.name,
		status: job.status,
		completedItems: job.completedItems,
		failedItems: job.failedItems,
		totalItems: job.totalItems
	};
}

function validateCreateInput(input: CreateJobInput): void {
	if (input.id.length === 0) throw new Error('job id is required');
	if (input.name.length === 0) throw new Error('job name is required');
	validateCount(input.totalItems, 'totalItems');
}

function validateCount(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
