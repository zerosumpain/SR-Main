// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { JKAI_DB_NAME } from '../db';
import {
	enqueueMessage,
	listOutbox,
	markOutboxFailure,
	deleteOutboxEntry,
	MAX_OUTBOX_ATTEMPTS,
} from '../outbox';

beforeEach(() => indexedDB.deleteDatabase(JKAI_DB_NAME));

describe('outbox', () => {
	it('enqueueMessage writes a sendMessage entry', async () => {
		const id = await enqueueMessage('c1', 'hello');
		const entries = await listOutbox();
		expect(entries).toHaveLength(1);
		expect(entries[0].id).toBe(id);
		expect(entries[0].type).toBe('sendMessage');
		expect(entries[0].payload).toMatchObject({ conversationId: 'c1', body: 'hello' });
		expect(entries[0].attempts).toBe(0);
	});

	it('orders entries by createdAt', async () => {
		const a = await enqueueMessage('c1', 'a');
		await new Promise((r) => setTimeout(r, 5));
		const b = await enqueueMessage('c1', 'b');
		const entries = await listOutbox();
		expect(entries.map((e) => e.id)).toEqual([a, b]);
	});

	it('markOutboxFailure increments attempts and records error', async () => {
		const id = await enqueueMessage('c1', 'x');
		await markOutboxFailure(id, 'network down');
		await markOutboxFailure(id, 'still down');
		const entries = await listOutbox();
		expect(entries[0].attempts).toBe(2);
		expect(entries[0].lastError).toBe('still down');
	});

	it('deleteOutboxEntry removes the entry', async () => {
		const id = await enqueueMessage('c1', 'x');
		await deleteOutboxEntry(id);
		expect(await listOutbox()).toHaveLength(0);
	});

	it('MAX_OUTBOX_ATTEMPTS is 5', () => {
		expect(MAX_OUTBOX_ATTEMPTS).toBe(5);
	});
});
