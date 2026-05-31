import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('web-push', () => ({
	default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
	setVapidDetails: vi.fn(),
	sendNotification: vi.fn(),
}));

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		select: vi.fn(),
		delete: vi.fn(),
	},
}));
// Adjust mock paths if your db / schema import paths differ.
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({
	pushSubscriptions: { userId: 'userId', endpoint: 'endpoint' },
}));

import webpush from 'web-push';
import { notifyUser } from '../push';

beforeEach(() => {
	vi.clearAllMocks();
	process.env.VAPID_PUBLIC_KEY = 'pub';
	process.env.VAPID_PRIVATE_KEY = 'priv';
	process.env.VAPID_SUBJECT = 'mailto:test@example.com';
});

describe('notifyUser', () => {
	it('sends to every subscription for the user', async () => {
		dbMock.select.mockReturnValue({
			from: () => ({
				where: () => Promise.resolve([
					{ endpoint: 'https://push/a', p256dh: 'a', auth: 'b' },
					{ endpoint: 'https://push/b', p256dh: 'c', auth: 'd' },
				]),
			}),
		});
		(webpush.sendNotification as ReturnType<typeof vi.fn>).mockResolvedValue({ statusCode: 201 });

		await notifyUser('user-1', { title: 'hi', body: 'there' });
		expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
	});

	it('deletes subscriptions that 404/410', async () => {
		dbMock.select.mockReturnValue({
			from: () => ({
				where: () => Promise.resolve([{ endpoint: 'https://push/dead', p256dh: 'a', auth: 'b' }]),
			}),
		});
		const deleteWhere = vi.fn().mockResolvedValue(undefined);
		dbMock.delete.mockReturnValue({ where: deleteWhere });
		const err: { statusCode: number } = { statusCode: 410 };
		(webpush.sendNotification as ReturnType<typeof vi.fn>).mockRejectedValue(err);

		await notifyUser('user-1', { title: 'hi', body: 'there' });
		expect(deleteWhere).toHaveBeenCalled();
	});
});
