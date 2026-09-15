import { createHash, randomUUID } from 'node:crypto';

export type PayPalAction =
	| {
			kind: 'cancel_subscription';
			subscriptionId: string;
			reason: string;
		}
	| {
			kind: 'capture_order';
			orderId: string;
		};

export type PreparedPayPalRequest = {
	method: 'POST';
	path: string;
	body?: Record<string, string>;
};

export type PaymentActionState = 'prepared' | 'approved' | 'submitting' | 'succeeded' | 'failed';

export type PreparedPaymentAction = {
	id: string;
	action: PayPalAction;
	actionFingerprint: string;
	state: PaymentActionState;
	preparedAt: Date;
	approvedAt: Date | null;
	approvedBy: string | null;
	approvalExpiresAt: Date | null;
	submittedAt: Date | null;
	completedAt: Date | null;
	failureReason: string | null;
};

/**
 * Persistence implementations must make approvePrepared and claimApproved
 * conditional atomic updates. This prevents two concurrent requests from
 * spending the same approval.
 */
export interface PaymentActionStore {
	create(action: PreparedPaymentAction): Promise<void>;
	get(id: string): Promise<PreparedPaymentAction | null>;
	approvePrepared(input: {
		id: string;
		ownerId: string;
		now: Date;
		expiresAt: Date;
	}): Promise<PreparedPaymentAction | null>;
	claimApproved(id: string, now: Date): Promise<PreparedPaymentAction | null>;
	markSucceeded(id: string, now: Date): Promise<void>;
	markFailed(id: string, now: Date, reason: string): Promise<void>;
}

export class PaymentApprovalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PaymentApprovalError';
	}
}

export class PaymentSubmissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PaymentSubmissionError';
	}
}

export type ApprovedPaymentWorkflowOptions = {
	store: PaymentActionStore;
	/** Immutable ID of the account that is allowed to approve payments. */
	ownerId: string;
	approvalTtlMs?: number;
	now?: () => Date;
};

export class ApprovedPaymentWorkflow {
	private readonly approvalTtlMs: number;
	private readonly now: () => Date;

	constructor(private readonly options: ApprovedPaymentWorkflowOptions) {
		if (!options.ownerId) {
			throw new Error('ownerId is required');
		}

		this.approvalTtlMs = options.approvalTtlMs ?? 5 * 60 * 1000;
		if (!Number.isFinite(this.approvalTtlMs) || this.approvalTtlMs <= 0) {
			throw new Error('approvalTtlMs must be a positive number');
		}
		this.now = options.now ?? (() => new Date());
	}

	async prepare(action: PayPalAction): Promise<PreparedPaymentAction> {
		const normalizedAction = normalizeAction(action);
		const preparedAt = this.now();
		const record: PreparedPaymentAction = {
			id: randomUUID(),
			action: normalizedAction,
			actionFingerprint: fingerprint(normalizedAction),
			state: 'prepared',
			preparedAt,
			approvedAt: null,
			approvedBy: null,
			approvalExpiresAt: null,
			submittedAt: null,
			completedAt: null,
			failureReason: null
		};

		await this.options.store.create(record);
		return record;
	}

	/**
	 * actorId must come from a server-verified authenticated session, never a
	 * browser supplied form field.
	 */
	async approve(id: string, actorId: string): Promise<PreparedPaymentAction> {
		if (actorId !== this.options.ownerId) {
			throw new PaymentApprovalError('Only the configured owner can approve a payment action');
		}

		const now = this.now();
		const approved = await this.options.store.approvePrepared({
			id,
			ownerId: actorId,
			now,
			expiresAt: new Date(now.getTime() + this.approvalTtlMs)
		});

		if (!approved) {
			throw new PaymentApprovalError('Payment action is not available for approval');
		}
		return approved;
	}

	/**
	 * Claims the approval before invoking the executor, so a second concurrent
	 * request cannot submit the same PayPal action.
	 */
	async submit<TResult>(
		id: string,
		execute: (request: PreparedPayPalRequest) => Promise<TResult>
	): Promise<TResult> {
		const claimed = await this.options.store.claimApproved(id, this.now());
		if (!claimed) {
			throw new PaymentSubmissionError('Payment action is unapproved, expired, or has already been submitted');
		}

		try {
			const result = await execute(toPayPalRequest(claimed.action));
			await this.options.store.markSucceeded(id, this.now());
			return result;
		} catch (error) {
			const reason = error instanceof Error ? error.message : 'Unknown submission failure';
			await this.options.store.markFailed(id, this.now(), reason.slice(0, 500));
			throw error;
		}
	}
}

/** A non-persistent implementation intended for tests and local development. */
export class InMemoryPaymentActionStore implements PaymentActionStore {
	private readonly actions = new Map<string, PreparedPaymentAction>();

	async create(action: PreparedPaymentAction): Promise<void> {
		if (this.actions.has(action.id)) throw new Error('Duplicate payment action ID');
		this.actions.set(action.id, copy(action));
	}

	async get(id: string): Promise<PreparedPaymentAction | null> {
		const action = this.actions.get(id);
		return action ? copy(action) : null;
	}

	async approvePrepared(input: {
		id: string;
		ownerId: string;
		now: Date;
		expiresAt: Date;
	}): Promise<PreparedPaymentAction | null> {
		const action = this.actions.get(input.id);
		if (!action || action.state !== 'prepared') return null;

		action.state = 'approved';
		action.approvedAt = new Date(input.now);
		action.approvedBy = input.ownerId;
		action.approvalExpiresAt = new Date(input.expiresAt);
		return copy(action);
	}

	async claimApproved(id: string, now: Date): Promise<PreparedPaymentAction | null> {
		const action = this.actions.get(id);
		if (
			!action ||
			action.state !== 'approved' ||
			!action.approvalExpiresAt ||
			action.approvalExpiresAt.getTime() <= now.getTime()
		) {
			return null;
		}

		action.state = 'submitting';
		action.submittedAt = new Date(now);
		return copy(action);
	}

	async markSucceeded(id: string, now: Date): Promise<void> {
		const action = this.actions.get(id);
		if (!action || action.state !== 'submitting') throw new Error('Payment action is not submitting');
		action.state = 'succeeded';
		action.completedAt = new Date(now);
	}

	async markFailed(id: string, now: Date, reason: string): Promise<void> {
		const action = this.actions.get(id);
		if (!action || action.state !== 'submitting') throw new Error('Payment action is not submitting');
		action.state = 'failed';
		action.completedAt = new Date(now);
		action.failureReason = reason;
	}
}

export function toPayPalRequest(action: PayPalAction): PreparedPayPalRequest {
	switch (action.kind) {
		case 'cancel_subscription':
			return {
				method: 'POST',
				path: `/v1/billing/subscriptions/${encodeURIComponent(action.subscriptionId)}/cancel`,
				body: { reason: action.reason }
			};
		case 'capture_order':
			return {
				method: 'POST',
				path: `/v2/checkout/orders/${encodeURIComponent(action.orderId)}/capture`
			};
	}
}

function normalizeAction(action: PayPalAction): PayPalAction {
	const id = action.kind === 'cancel_subscription' ? action.subscriptionId : action.orderId;
	if (!/^[A-Za-z0-9-]{1,127}$/.test(id)) {
		throw new Error('PayPal resource ID must contain only letters, numbers, and hyphens');
	}

	if (action.kind === 'capture_order') {
		return { kind: 'capture_order', orderId: id };
	}

	const reason = action.reason.trim();
	if (!reason || reason.length > 128) {
		throw new Error('Cancellation reason must contain between 1 and 128 characters');
	}
	return { kind: 'cancel_subscription', subscriptionId: id, reason };
}

function fingerprint(action: PayPalAction): string {
	return createHash('sha256').update(JSON.stringify(action)).digest('hex');
}

function copy(action: PreparedPaymentAction): PreparedPaymentAction {
	return {
		...action,
		action: { ...action.action },
		preparedAt: new Date(action.preparedAt),
		approvedAt: action.approvedAt ? new Date(action.approvedAt) : null,
		approvalExpiresAt: action.approvalExpiresAt ? new Date(action.approvalExpiresAt) : null,
		submittedAt: action.submittedAt ? new Date(action.submittedAt) : null,
		completedAt: action.completedAt ? new Date(action.completedAt) : null
	};
}
