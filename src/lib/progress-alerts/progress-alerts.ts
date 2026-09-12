export type TaskKind = 'build' | 'research' | 'workflow' | 'delegated-task';
export type TaskStatus =
	| 'pending'
	| 'running'
	| 'paused'
	| 'completed'
	| 'failed'
	| 'cancelled'
	| 'requires-intervention';

export interface TrackedTask {
	id: string;
	kind: TaskKind;
	title: string;
	status: TaskStatus;
	startedAt: Date;
	updatedAt: Date;
	progressPercent?: number;
	outcome?: string;
}

export interface ProgressMilestone {
	/** A stable, task-policy-local identifier, such as `halfway`. */
	id: string;
	/** The minimum progress percentage at which this milestone is reached. */
	percent: number;
	message?: string;
}

export interface ProgressAlertPolicy {
	milestones?: readonly ProgressMilestone[];
	/** Emit an intervention alert once a running task has not updated for this duration. */
	staleAfterMs?: number;
}

export type ProgressAlertType = 'milestone' | 'completed' | 'failed' | 'intervention';

export interface ProgressAlert {
	deduplicationKey: string;
	taskId: string;
	taskKind: TaskKind;
	type: ProgressAlertType;
	title: string;
	message: string;
	createdAt: Date;
	milestoneId?: string;
}

export interface EvaluateProgressAlertsInput {
	task: TrackedTask;
	policy?: ProgressAlertPolicy;
	/** Keys that have already been durably delivered or queued for delivery. */
	deliveredDeduplicationKeys: ReadonlySet<string>;
	now: Date;
}

const DEFAULT_MILESTONES: readonly ProgressMilestone[] = [
	{ id: 'quarter', percent: 25 },
	{ id: 'halfway', percent: 50 },
	{ id: 'three-quarters', percent: 75 }
];

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

function key(task: TrackedTask, event: string): string {
	return `progress-alert:${task.kind}:${task.id}:${event}`;
}

function addIfUndelivered(
	alerts: ProgressAlert[],
	delivered: ReadonlySet<string>,
	alert: ProgressAlert
): void {
	if (!delivered.has(alert.deduplicationKey)) {
		alerts.push(alert);
	}
}

function taskLabel(task: TrackedTask): string {
	return `${task.kind.replace('-', ' ')} “${task.title}”`;
}

function validateTask(task: TrackedTask): void {
	if (!task.id.trim()) throw new Error('Tracked task id must not be empty.');
	if (!task.title.trim()) throw new Error('Tracked task title must not be empty.');
	if (Number.isNaN(task.startedAt.getTime()) || Number.isNaN(task.updatedAt.getTime())) {
		throw new Error('Tracked task dates must be valid.');
	}
	if (
		task.progressPercent !== undefined &&
		(!Number.isFinite(task.progressPercent) || task.progressPercent < 0 || task.progressPercent > 100)
	) {
		throw new Error('Tracked task progressPercent must be between 0 and 100.');
	}
}

/**
 * Produces notification candidates without performing I/O. Persist each candidate's
 * deduplication key under a database uniqueness constraint before delivering it.
 */
export function evaluateProgressAlerts(input: EvaluateProgressAlertsInput): ProgressAlert[] {
	const { task, deliveredDeduplicationKeys, now } = input;
	validateTask(task);
	if (Number.isNaN(now.getTime())) throw new Error('Evaluation time must be valid.');

	const alerts: ProgressAlert[] = [];
	const label = taskLabel(task);

	if (task.status === 'completed') {
		const deduplicationKey = key(task, 'completed');
		addIfUndelivered(alerts, deliveredDeduplicationKeys, {
			deduplicationKey,
			taskId: task.id,
			taskKind: task.kind,
			type: 'completed',
			title: `${label} completed`,
			message: task.outcome?.trim()
				? `${label} has completed. ${task.outcome.trim()}`
				: `${label} has completed.`,
			createdAt: now
		});
		return alerts;
	}

	if (task.status === 'failed') {
		const deduplicationKey = key(task, 'failed');
		addIfUndelivered(alerts, deliveredDeduplicationKeys, {
			deduplicationKey,
			taskId: task.id,
			taskKind: task.kind,
			type: 'failed',
			title: `${label} failed`,
			message: task.outcome?.trim()
				? `${label} failed and requires intervention. ${task.outcome.trim()}`
				: `${label} failed and requires intervention.`,
			createdAt: now
		});
		return alerts;
	}

	if (task.status === 'requires-intervention') {
		const deduplicationKey = key(task, 'requires-intervention');
		addIfUndelivered(alerts, deliveredDeduplicationKeys, {
			deduplicationKey,
			taskId: task.id,
			taskKind: task.kind,
			type: 'intervention',
			title: `${label} needs attention`,
			message: task.outcome?.trim()
				? `${label} requires intervention. ${task.outcome.trim()}`
				: `${label} requires intervention.`,
			createdAt: now
		});
		return alerts;
	}

	if (task.status !== 'running') return alerts;

	const milestones = input.policy?.milestones ?? DEFAULT_MILESTONES;
	for (const milestone of milestones) {
		if (!milestone.id.trim() || !Number.isFinite(milestone.percent) || milestone.percent < 0 || milestone.percent > 100) {
			throw new Error('Milestones need a non-empty id and a percentage between 0 and 100.');
		}
		if ((task.progressPercent ?? 0) < milestone.percent) continue;

		const deduplicationKey = key(task, `milestone:${milestone.id}`);
		addIfUndelivered(alerts, deliveredDeduplicationKeys, {
			deduplicationKey,
			taskId: task.id,
			taskKind: task.kind,
			type: 'milestone',
			title: `${label} reached ${milestone.percent}%`,
			message: milestone.message?.trim() || `${label} has reached ${milestone.percent}% progress.`,
			createdAt: now,
			milestoneId: milestone.id
		});
	}

	const staleAfterMs = input.policy?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
	if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
		throw new Error('staleAfterMs must be a non-negative finite number.');
	}
	if (now.getTime() - task.updatedAt.getTime() >= staleAfterMs) {
		const deduplicationKey = key(task, 'stalled');
		addIfUndelivered(alerts, deliveredDeduplicationKeys, {
			deduplicationKey,
			taskId: task.id,
			taskKind: task.kind,
			type: 'intervention',
			title: `${label} may be stalled`,
			message: `${label} has not reported progress since ${task.updatedAt.toISOString()} and may require intervention.`,
			createdAt: now
		});
	}

	return alerts;
}
