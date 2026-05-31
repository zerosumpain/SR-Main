// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { JKAI_DB_NAME } from '../db';
import { enqueueMessage, listOutbox } from '../outbox';
import { flushOutbox } from '../syncManager';

beforeEach(() => indexedDB.deleteDatabase(JKAI_DB_NAME));

describe('flushOutbox', () => {
	it('sends each entry and deletes on success', async () => {
		await enqueueMessage('c1', 'one');
		await enqueueMessage('c1', 'two');
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'm1' }) });
		const report = await flushOutbox({ fetchImpl: fetchMock });
		expect(report.flushed).toBe(2);
		expect(report.failed).toBe(0);
		expect(await listOutbox()).toHaveLength(0);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/jkai\/messages/);
	});

	it('keeps entry and increments attempts on failure', async () => {
		await enqueueMessage('c1', 'x');
		const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
		const report = await flushOutbox({ fetchImpl: fetchMock });
		expect(report.flushed).toBe(0);
		expect(report.failed).toBe(1);
		const left = await listOutbox();
		expect(left).toHaveLength(1);
		expect(left[0].attempts).toBe(1);
		expect(left[0].lastError).toBe('offline');
	});

	it('drops entry that exceeded MAX_OUTBOX_ATTEMPTS', async () => {
		await enqueueMessage('c1', 'x');
		const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
		for (let i = 0; i < 5; i++) {
			await flushOutbox({ fetchImpl: fetchMock });
		}
		const left = await listOutbox();
		expect(left[0].attempts).toBe(5);
		expect(left[0].lastError).toBe('boom');
		const report = await flushOutbox({ fetchImpl: fetchMock });
		expect(report.flushed).toBe(0);
		expect(report.skipped).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(5);
	});
});
