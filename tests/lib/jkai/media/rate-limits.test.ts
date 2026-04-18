import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: async () => [{ count: '5' }],
			}),
		}),
	},
}));
vi.mock('$lib/db/schema', () => ({ jkaiAttachments: {} }));

describe('checkImageQuota', () => {
	it('allows when under limit', async () => {
		const { checkImageQuota } = await import('$lib/jkai/media/rate-limits');
		const r = await checkImageQuota('conv-1', 1);
		expect(r.allowed).toBe(true);
	});
	it('rejects when count would exceed', async () => {
		const { checkImageQuota } = await import('$lib/jkai/media/rate-limits');
		const r = await checkImageQuota('conv-1', 20);
		expect(r.allowed).toBe(false);
		expect(r.reason).toMatch(/limit/i);
	});
});
