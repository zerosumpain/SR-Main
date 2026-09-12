import { describe, expect, it } from 'vitest';
import {
	createRecoveryEvidenceWorkspace,
	redactRecoveryEvidence,
	type RecoveryEvidenceFinding
} from '$lib/account-recovery/evidence-workspace';

const findings: RecoveryEvidenceFinding[] = [
	{
		id: 'mail-1',
		source: 'email',
		field: 'account-email',
		value: 'alex@example.com',
		verifiedAt: '2026-08-30T10:00:00Z',
		externalReference: 'gmail-message-123'
	},
	{
		id: 'payment-1',
		source: 'transaction',
		field: 'transaction-amount',
		value: '£12.99',
		verifiedAt: '2026-08-29T10:00:00Z'
	}
];

describe('createRecoveryEvidenceWorkspace', () => {
	it('builds a private, pending-review checklist from verified findings', () => {
		const workspace = createRecoveryEvidenceWorkspace({
			accountHint: 'alex@example.com',
			findings,
			generatedAt: '2026-08-30T12:00:00Z'
		});

		expect(workspace.visibility).toBe('private');
		expect(workspace.checklist).toEqual([
			expect.objectContaining({
				prompt: 'Account email address',
				answer: 'a•••@example.com',
				reviewState: 'pending',
				evidenceId: 'mail-1'
			}),
			expect.objectContaining({
				prompt: 'Amount of a related payment',
				answer: '£•••',
				evidenceId: 'payment-1'
			})
		]);
		expect(workspace.disclosure).toContain('does not contain passwords');
	});

	it('supports explicit redaction controls', () => {
		expect(redactRecoveryEvidence('alex@example.com', 'account-email', 'none')).toBe('alex@example.com');
		expect(redactRecoveryEvidence('reference-9876', 'transaction-reference', 'partial')).toBe('••••9876');
		expect(redactRecoveryEvidence('Anything', 'merchant', 'hidden')).toBe('Hidden');
	});

	it('rejects authentication secrets and card-like numbers before they enter the workspace', () => {
		expect(() =>
			createRecoveryEvidenceWorkspace({
				accountHint: 'alex@example.com',
				findings: [
					{
						...findings[0],
						value: 'My recovery code is 123456'
					}
				]
			})
		).toThrow(/recovery code/i);

		expect(() =>
			createRecoveryEvidenceWorkspace({
				accountHint: 'alex@example.com',
				findings: [
					{
						...findings[1],
						value: '4111 1111 1111 1111'
					}
				]
			})
		).toThrow(/card-like number/i);
	});

	it('requires a field that matches the evidence source', () => {
		expect(() =>
			createRecoveryEvidenceWorkspace({
				accountHint: 'alex@example.com',
				findings: [{ ...findings[0], field: 'merchant' }]
			})
		).toThrow(/not valid for email evidence/i);
	});
});
