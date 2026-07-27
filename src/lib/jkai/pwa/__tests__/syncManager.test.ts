// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { JKAI_DB_NAME } from '../db';
import { enqueueMessage, listOutbox } from '../outbox';
import { flushOutbox, syncAll, startAutoSync } from '../syncManager';
import { putConversation, listConversations, listBuilds } from '../db';

beforeEach(() => indexedDB.deleteDatabase(JKAI_DB_NAME));

describe('outbox ordering', () => {
	it('flushes in enqueue order even when queued within one millisecond', async () => {
		// Regression: createdAt was Date.now() at millisecond resolution, so a
		// burst of messages shared an index key and IndexedDB fell back to
		// primary-key (random uuid) order. This failed on CI, where the enqueues
		// are fast enough to collide, while passing on a slower machine.
		const sent = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
		for (const body of sent) await enqueueMessage('c1', body);

		const queued = (await listOutbox()).map((r) => (r.payload as { body: string }).body);
		expect(queued).toEqual(sent);

		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'm' }) });
		await flushOutbox({ fetchImpl: fetchMock });
		const flushed = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).message);
		expect(flushed).toEqual(sent);
	});
});

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
		expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/workflows\/orchestrator\/chat/);
		const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(sentBody).toMatchObject({
			message: 'one',
			conversationId: 'c1',
			attachmentIds: [],
			useIntelContext: false,
		});
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

describe('syncAll', () => {
	beforeEach(() => indexedDB.deleteDatabase(JKAI_DB_NAME));

	it('refreshes conversations and builds and runs eviction', async () => {
		for (let i = 0; i < 60; i++) {
			await putConversation({ id: `c${i}`, title: `c${i}`, updatedAt: new Date(2026, 0, 1, 0, i).toISOString() });
		}
		const fresh = [
			{ id: 'c100', title: 'fresh', updatedAt: new Date(2026, 0, 2).toISOString() },
		];
		const freshBuilds = [
			{ id: 'b1', title: 'b1', status: 'done', createdAt: '2026-01-01T00:00:00Z' },
		];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/jkai/conversations')) return { ok: true, json: async () => fresh } as Response;
			if (url.includes('/api/jkai/builds')) return { ok: true, json: async () => freshBuilds } as Response;
			throw new Error(`unexpected ${url}`);
		});
		const report = await syncAll({ fetchImpl });
		expect(report.refreshed.conversations).toBe(1);
		expect(report.refreshed.builds).toBe(1);
		expect((await listConversations()).length).toBeLessThanOrEqual(50);
		expect(await listBuilds()).toHaveLength(1);
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
	});
});

describe('startAutoSync', () => {
	beforeEach(() => indexedDB.deleteDatabase(JKAI_DB_NAME));

	it('runs syncAll on visibilitychange visible and returns a dispose function', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
		const dispose = startAutoSync({ fetchImpl, debounceMs: 0, intervalMs: 0 });
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		await new Promise((r) => setTimeout(r, 20));
		expect(fetchImpl).toHaveBeenCalled();
		dispose();
	});
});
