import { and, desc, eq, gte, index, lte } from 'drizzle-orm';
import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { InferSelectModel, SQL } from 'drizzle-orm';

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| { [key: string]: JsonValue }
	| JsonValue[];

export type OutageSource = 'probe' | 'systemd' | 'scheduler' | 'workflow' | 'remediation';
export type OutageSeverity = 'info' | 'warning' | 'error' | 'critical';
export type RemediationAction = 'restart-service' | 'reregister-scheduler';

export const outageTimelineEvents = pgTable(
	'outage_timeline_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
		recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
		source: varchar('source', { length: 32 }).$type<OutageSource>().notNull(),
		kind: varchar('kind', { length: 96 }).notNull(),
		service: varchar('service', { length: 160 }).notNull(),
		severity: varchar('severity', { length: 16 }).$type<OutageSeverity>().notNull(),
		message: varchar('message', { length: 2_000 }).notNull(),
		correlationId: varchar('correlation_id', { length: 160 }),
		details: jsonb('details').$type<Record<string, JsonValue>>().notNull().default({})
	},
	(table) => [
		index('outage_timeline_events_occurred_at_idx').on(table.occurredAt),
		index('outage_timeline_events_service_occurred_at_idx').on(table.service, table.occurredAt),
		index('outage_timeline_events_source_occurred_at_idx').on(table.source, table.occurredAt)
	]
);

export type TimelineEvent = Omit<InferSelectModel<typeof outageTimelineEvents>, 'id' | 'recordedAt'> & {
	id?: string;
	recordedAt?: Date;
};
export type TimelineEventRow = InferSelectModel<typeof outageTimelineEvents>;

export interface TimelineQuery {
	service?: string;
	source?: OutageSource;
	from?: Date;
	to?: Date;
	limit?: number;
	offset?: number;
}

export interface ServiceProbeInput {
	service: string;
	occurredAt: Date;
	healthy: boolean;
	latencyMs?: number;
	message?: string;
	correlationId?: string;
}

export interface SystemdAvailabilityInput {
	service: string;
	occurredAt: Date;
	available: boolean;
	unitState?: string;
	message?: string;
	correlationId?: string;
}

export interface SchedulerRegistrationInput {
	service: string;
	occurredAt: Date;
	scheduleId: string;
	registered: boolean;
	message?: string;
	correlationId?: string;
}

export interface WorkflowErrorInput {
	service: string;
	occurredAt: Date;
	workflowId: string;
	runId?: string;
	error: string;
	correlationId?: string;
}

export function serviceProbeEvent(input: ServiceProbeInput): TimelineEvent {
	return {
		occurredAt: input.occurredAt,
		source: 'probe',
		kind: input.healthy ? 'service.probe.healthy' : 'service.probe.failed',
		service: input.service,
		severity: input.healthy ? 'info' : 'critical',
		message: input.message ?? (input.healthy ? 'Service probe succeeded' : 'Service probe failed'),
		correlationId: input.correlationId ?? null,
		details: { healthy: input.healthy, latencyMs: input.latencyMs ?? null }
	};
}

export function systemdAvailabilityEvent(input: SystemdAvailabilityInput): TimelineEvent {
	return {
		occurredAt: input.occurredAt,
		source: 'systemd',
		kind: input.available ? 'systemd.available' : 'systemd.unavailable',
		service: input.service,
		severity: input.available ? 'info' : 'critical',
		message: input.message ?? (input.available ? 'systemd unit is available' : 'systemd unit is unavailable'),
		correlationId: input.correlationId ?? null,
		details: { available: input.available, unitState: input.unitState ?? null }
	};
}

export function schedulerRegistrationEvent(input: SchedulerRegistrationInput): TimelineEvent {
	return {
		occurredAt: input.occurredAt,
		source: 'scheduler',
		kind: input.registered ? 'scheduler.registered' : 'scheduler.unregistered',
		service: input.service,
		severity: input.registered ? 'info' : 'error',
		message: input.message ?? (input.registered ? 'Schedule registered' : 'Schedule is not registered'),
		correlationId: input.correlationId ?? null,
		details: { scheduleId: input.scheduleId, registered: input.registered }
	};
}

export function workflowErrorEvent(input: WorkflowErrorInput): TimelineEvent {
	return {
		occurredAt: input.occurredAt,
		source: 'workflow',
		kind: 'workflow.error',
		service: input.service,
		severity: 'error',
		message: input.error,
		correlationId: input.correlationId ?? input.runId ?? null,
		details: { workflowId: input.workflowId, runId: input.runId ?? null }
	};
}

export interface RemediationRequest {
	action: RemediationAction;
	service: string;
	reason: string;
	requestedBy: string;
	approval: string;
	correlationId?: string;
	activeOutage: boolean;
}

export type RemediationDecision =
	| { allowed: true; command: 'restart-service' | 'reregister-scheduler' }
	| { allowed: false; reason: string };

const safeServiceName = /^[a-zA-Z0-9_.@-]+$/;

/**
 * Evaluates, but does not perform, a remediation. The caller must provide an
 * explicit approval matching `REMEDIATE <action> <service>` exactly.
 */
export function guardRemediation(request: RemediationRequest): RemediationDecision {
	if (!safeServiceName.test(request.service)) {
		return { allowed: false, reason: 'Service name contains unsafe characters.' };
	}
	if (!request.activeOutage) {
		return { allowed: false, reason: 'No active outage is recorded for this service.' };
	}
	if (request.reason.trim().length < 10) {
		return { allowed: false, reason: 'A remediation reason of at least 10 characters is required.' };
	}
	if (request.requestedBy.trim().length === 0) {
		return { allowed: false, reason: 'An authenticated requester is required.' };
	}
	const expectedApproval = `REMEDIATE ${request.action} ${request.service}`;
	if (request.approval !== expectedApproval) {
		return { allowed: false, reason: `Explicit approval must equal: ${expectedApproval}` };
	}
	return { allowed: true, command: request.action };
}

function assertEvent(event: TimelineEvent): Omit<TimelineEvent, 'id' | 'recordedAt'> {
	if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
		throw new Error('Timeline event occurredAt must be a valid Date.');
	}
	if (event.service.trim().length === 0 || event.message.trim().length === 0) {
		throw new Error('Timeline event service and message are required.');
	}
	return {
		occurredAt: event.occurredAt,
		source: event.source,
		kind: event.kind,
		service: event.service,
		severity: event.severity,
		message: event.message,
		correlationId: event.correlationId ?? null,
		details: event.details
	};
}

export interface RemediationExecutor {
	execute(input: Pick<RemediationRequest, 'action' | 'service' | 'reason' | 'requestedBy'>): Promise<Record<string, JsonValue> | void>;
}

/** A small adapter intentionally accepts the application's existing Drizzle db instance. */
export function createOutageTimelineRepository(db: any) {
	async function record(event: TimelineEvent): Promise<TimelineEventRow> {
		const [created] = await db.insert(outageTimelineEvents).values(assertEvent(event)).returning();
		return created as TimelineEventRow;
	}

	async function query(filter: TimelineQuery = {}): Promise<TimelineEventRow[]> {
		let condition: SQL | undefined;
		const append = (next: SQL): void => {
			condition = condition === undefined ? next : and(condition, next);
		};
		if (filter.service !== undefined) append(eq(outageTimelineEvents.service, filter.service));
		if (filter.source !== undefined) append(eq(outageTimelineEvents.source, filter.source));
		if (filter.from !== undefined) append(gte(outageTimelineEvents.occurredAt, filter.from));
		if (filter.to !== undefined) append(lte(outageTimelineEvents.occurredAt, filter.to));
		const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
		const offset = Math.max(filter.offset ?? 0, 0);
		return (await db
			.select()
			.from(outageTimelineEvents)
			.where(condition)
			.orderBy(desc(outageTimelineEvents.occurredAt))
			.limit(limit)
			.offset(offset)) as TimelineEventRow[];
	}

	async function executeRemediation(request: RemediationRequest, executor: RemediationExecutor): Promise<RemediationDecision> {
		const decision = guardRemediation(request);
		await record({
			occurredAt: new Date(),
			source: 'remediation',
			kind: decision.allowed ? 'remediation.approved' : 'remediation.denied',
			service: request.service,
			severity: decision.allowed ? 'warning' : 'info',
			message: decision.allowed ? `Approved ${request.action}` : decision.reason,
			correlationId: request.correlationId ?? null,
			details: { action: request.action, requestedBy: request.requestedBy, reason: request.reason }
		});
		if (!decision.allowed) return decision;
		try {
			const output = await executor.execute(request);
			await record({
				occurredAt: new Date(), source: 'remediation', kind: 'remediation.completed', service: request.service,
				severity: 'info', message: `${request.action} completed`, correlationId: request.correlationId ?? null,
				details: { action: request.action, output: output ?? null }
			});
			return decision;
		} catch (error) {
			await record({
				occurredAt: new Date(), source: 'remediation', kind: 'remediation.failed', service: request.service,
				severity: 'error', message: `${request.action} failed`, correlationId: request.correlationId ?? null,
				details: { action: request.action, error: error instanceof Error ? error.message : String(error) }
			});
			throw error;
		}
	}

	return { record, query, executeRemediation };
}
