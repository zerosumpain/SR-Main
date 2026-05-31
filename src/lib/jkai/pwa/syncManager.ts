import { listOutbox, markOutboxFailure, deleteOutboxEntry, MAX_OUTBOX_ATTEMPTS, type SendMessagePayload } from './outbox';
import type { OutboxRecord } from './db';

export interface SyncReport {
	flushed: number;
	failed: number;
	skipped: number;
	refreshed: { conversations: number; builds: number };
	durationMs: number;
}

export interface FlushOpts {
	fetchImpl?: typeof fetch;
}

async function flushOne(entry: OutboxRecord, fetchImpl: typeof fetch): Promise<void> {
	if (entry.type === 'sendMessage') {
		const payload = entry.payload as SendMessagePayload;
		const res = await fetchImpl(`/api/jkai/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify(payload),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return;
	}
	throw new Error(`Unknown outbox type: ${entry.type}`);
}

export async function flushOutbox(opts: FlushOpts = {}): Promise<Pick<SyncReport, 'flushed' | 'failed' | 'skipped'>> {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const entries = await listOutbox();
	let flushed = 0;
	let failed = 0;
	let skipped = 0;
	for (const entry of entries) {
		if (entry.attempts >= MAX_OUTBOX_ATTEMPTS) {
			skipped += 1;
			continue;
		}
		try {
			await flushOne(entry, fetchImpl);
			await deleteOutboxEntry(entry.id);
			flushed += 1;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await markOutboxFailure(entry.id, message);
			failed += 1;
		}
	}
	return { flushed, failed, skipped };
}
