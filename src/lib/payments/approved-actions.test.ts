import { describe, expect, it, vi } from 'vitest';
import {
	ApprovedPaymentWorkflow,
	InMemoryPaymentActionStore,
	PaymentApprovalError,
	PaymentSubmissionError
} from '$lib/payments/approved-actions';

describe('ApprovedPaymentWorkflow', () => {
	it('prepares a constrained PayPal action and submits it only after owner approval', async () => {
		const store = new InMemoryPaymentActionStore();
		const workflow = new ApprovedPaymentWorkflow({ store, ownerId: 'owner-1' });
		const prepared = await workflow.prepare({
			kind: 'cancel_subscription',
			subscriptionId: 'I-ABC123',
			reason: 'No longer required'
		});
		const execute = vi.fn().mockResolvedValue({ status: '204' });

		await expect(workflow.submit(prepared.id, execute)).rejects.toBeInstanceOf(PaymentSubmissionError);
		await expect(workflow.approve(prepared.id, 'another-user')).rejects.toBeInstanceOf(PaymentApprovalError);

		const approved = await workflow.approve(prepared.id, 'owner-1');
		expect(approved.state).toBe('approved');
		expect(approved.approvedBy).toBe('owner-1');

		await expect(workflow.submit(prepared.id, execute)).resolves.toEqual({ status: '204' });
		expect(execute).toHaveBeenCalledWith({
			method: 'POST',
			path: '/v1/billing/subscriptions/I-ABC123/cancel',
			body: { reason: 'No longer required' }
		});
		await expect(workflow.submit(prepared.id, execute)).rejects.toBeInstanceOf(PaymentSubmissionError);
		expect((await store.get(prepared.id))?.state).toBe('succeeded');
	});

	it('rejects an expired approval without calling PayPal', async () => {
		let time = new Date('2026-01-01T00:00:00.000Z');
		const store = new InMemoryPaymentActionStore();
		const workflow = new ApprovedPaymentWorkflow({
			store,
			ownerId: 'owner-1',
			approvalTtlMs: 1_000,
			now: () => time
		});
		const prepared = await workflow.prepare({ kind: 'capture_order', orderId: 'ORDER-123' });
		await workflow.approve(prepared.id, 'owner-1');
		time = new Date('2026-01-01T00:00:01.000Z');
		const execute = vi.fn();

		await expect(workflow.submit(prepared.id, execute)).rejects.toBeInstanceOf(PaymentSubmissionError);
		expect(execute).not.toHaveBeenCalled();
	});

	it('marks an action failed when PayPal execution fails', async () => {
		const store = new InMemoryPaymentActionStore();
		const workflow = new ApprovedPaymentWorkflow({ store, ownerId: 'owner-1' });
		const prepared = await workflow.prepare({ kind: 'capture_order', orderId: 'ORDER-123' });
		await workflow.approve(prepared.id, 'owner-1');

		await expect(workflow.submit(prepared.id, async () => {
			throw new Error('PayPal unavailable');
		})).rejects.toThrow('PayPal unavailable');
		expect((await store.get(prepared.id))?.state).toBe('failed');
	});
});
