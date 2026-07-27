import { openJkaiDB, type OutboxRecord } from './db';

export const MAX_OUTBOX_ATTEMPTS = 5;

export interface SendMessagePayload {
	conversationId: string;
	body: string;
	attachments?: unknown;
}

function uuid(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A strictly increasing ISO timestamp.
 *
 * `listOutbox` reads through the `createdAt` index, and `Date.now()` only has
 * millisecond resolution — two messages queued in the same millisecond get
 * identical index keys, at which point IndexedDB falls back to primary-key
 * order. The primary key is a random uuid, so the queue would flush out of
 * order: type two messages quickly offline and they could send back to front.
 *
 * Nudging forward on collision keeps ordering deterministic without a schema
 * change. Only monotonic within a session, which is all the index needs — a
 * later session's wall clock is already ahead of an earlier one's.
 */
let lastQueuedAt = 0;
function nextCreatedAt(): string {
	lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1);
	return new Date(lastQueuedAt).toISOString();
}

export async function enqueueMessage(
	conversationId: string,
	body: string,
	attachments?: unknown,
): Promise<string> {
	const db = await openJkaiDB();
	const record: OutboxRecord<SendMessagePayload> = {
		id: uuid(),
		type: 'sendMessage',
		payload: { conversationId, body, attachments },
		createdAt: nextCreatedAt(),
		attempts: 0,
	};
	await db.put('outbox', record);
	db.close();
	return record.id;
}

export async function listOutbox(): Promise<OutboxRecord[]> {
	const db = await openJkaiDB();
	const all = (await db.getAllFromIndex('outbox', 'createdAt')) as OutboxRecord[];
	db.close();
	return all;
}

export async function markOutboxFailure(id: string, error: string): Promise<void> {
	const db = await openJkaiDB();
	const tx = db.transaction('outbox', 'readwrite');
	const record = (await tx.store.get(id)) as OutboxRecord | undefined;
	if (record) {
		record.attempts += 1;
		record.lastError = error;
		await tx.store.put(record);
	}
	await tx.done;
	db.close();
}

export async function deleteOutboxEntry(id: string): Promise<void> {
	const db = await openJkaiDB();
	await db.delete('outbox', id);
	db.close();
}
