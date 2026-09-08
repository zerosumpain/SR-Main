import { listOutbox, markOutboxFailure, deleteOutboxEntry, MAX_OUTBOX_ATTEMPTS, type SendMessagePayload } from './outbox';
import {
	putConversation,
	evictConversations,
	evictBuilds,
	type OutboxRecord,
	type ConversationCacheRecord,
} from './db';

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
		const res = await fetchImpl(`/api/workflows/orchestrator/chat`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				message: payload.body,
				conversationId: payload.conversationId,
				attachmentIds: payload.attachments ?? [],
				useIntelContext: false,
			}),
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

export interface SyncAllOpts {
	fetchImpl?: typeof fetch;
}

async function refreshConversations(fetchImpl: typeof fetch): Promise<number> {
	const res = await fetchImpl('/api/jkai/conversations', { credentials: 'include' });
	if (!res.ok) throw new Error(`conversations HTTP ${res.status}`);
	const list = (await res.json()) as ConversationCacheRecord[];
	for (const c of list) await putConversation(c);
	return list.length;
}

/**
 * The builds LIST cache is no longer refreshed here.
 *
 * Its only reader was `/jkai/builds`, which folded into `/jkai/develop` on
 * 2026-09-08. The archive that replaced it is server-rendered, so nothing reads
 * this store any more — and pulling every build over the wire on each
 * visibility change, online event and sixty-second tick was paying for an
 * offline promise the surface no longer makes. `buildDetail` still has a live
 * reader (the archive console) and is untouched, as is `putBuild` itself, so a
 * cached client path can be restored without re-plumbing the store.
 */
const BUILD_LIST_CACHE_RETIRED = 0;

export async function syncAll(opts: SyncAllOpts = {}): Promise<SyncReport> {
	const started = Date.now();
	const fetchImpl = opts.fetchImpl ?? fetch;
	const outboxStats = await flushOutbox({ fetchImpl });
	let conversations = 0;
	let builds = 0;
	try { conversations = await refreshConversations(fetchImpl); } catch { /* offline / 401 surfaces via banner */ }
	builds = BUILD_LIST_CACHE_RETIRED;
	await evictConversations();
	await evictBuilds();
	return {
		flushed: outboxStats.flushed,
		failed: outboxStats.failed,
		skipped: outboxStats.skipped,
		refreshed: { conversations, builds },
		durationMs: Date.now() - started,
	};
}

export interface AutoSyncOpts extends SyncAllOpts {
	debounceMs?: number;
	intervalMs?: number;
}

export function startAutoSync(opts: AutoSyncOpts = {}): () => void {
	const { fetchImpl, debounceMs = 2000, intervalMs = 60_000 } = opts;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let interval: ReturnType<typeof setInterval> | undefined;
	let active = true;

	const trigger = () => {
		if (!active) return;
		clearTimeout(debounce);
		debounce = setTimeout(() => { void syncAll({ fetchImpl }); }, debounceMs);
	};

	const onVisibility = () => { if (document.visibilityState === 'visible') trigger(); };
	const onOnline = () => trigger();

	window.addEventListener('online', onOnline);
	document.addEventListener('visibilitychange', onVisibility);
	if (intervalMs > 0) {
		interval = setInterval(() => {
			if (document.visibilityState === 'visible') void syncAll({ fetchImpl });
		}, intervalMs);
	}

	return () => {
		active = false;
		clearTimeout(debounce);
		if (interval) clearInterval(interval);
		window.removeEventListener('online', onOnline);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
