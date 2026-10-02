import type { JobPhase, PulseEvent } from './job-store';

/**
 * What is running in chat right now — the one thing other domains ask the job
 * store, and the only part of it that survives chat becoming its own process.
 *
 * Twenty-two modules outside `$lib/workflows/chat` import the job store, but
 * they go through exactly three read functions and every one is observability:
 * `listJobs` (ten callers — seven heartbeat activities asking "is a chat running,
 * should I hold off?", plus hub-status and the admin pulse),
 * `listRunningJobsByConversation` (three, one of them the PUBLIC
 * /api/landing/vitals) and `getRecentPulses` (one). Every MUTATING call —
 * createJob, cancelJob, publishJobEvent, respondToWaiter, the seven timeout
 * ladders — is already inside this directory.
 *
 * So the job store is not entangled. It is one writer with a read-only window,
 * and this module is that window.
 *
 * ## Why these are async when the implementation is synchronous
 *
 * Because the implementation will not stay synchronous. When chat moves to its
 * own application the Map moves with it — it has to, since the waiters and the
 * SSE streams are shared memory by nature — and the thirteen readers left behind
 * need an answer from another process. Being async now means that day is a
 * change to THIS FILE and nothing else.
 *
 * ## Why a call and not a table
 *
 * A durable projection was the obvious alternative and it is worse. A Map dies
 * with the process that owns it, which is exactly right: if chat is not running,
 * nothing is running. A table has to be taught that by hand, with a heartbeat
 * column and a staleness window and a reaper, and it gets it wrong on the one
 * occasion it matters — a crashed process leaves rows insisting they are alive.
 * It would also mean a new table on the shared production database, and a write
 * every five seconds per job to keep it honest.
 */

export type ChatJobActivity = {
	id: string;
	status: string;
	message: string;
	startedAt: number;
	progressCount: number;
	elapsed: number;
	phase: JobPhase;
	currentStep?: string;
	lastEventAt: number;
	lastHeartbeatAt: number;
	workflowId?: string | null;
	conversationId?: string | null;
	chatNodeId?: string | null;
	queuedBehind?: string | null;
};

export type { PulseEvent };

/**
 * One shared promise, not three imports.
 *
 * Concurrent `import()` of the same module while its graph is still settling
 * fails a Node build outright with ERR_INTERNAL_ASSERTION — it happened on this
 * repository the same day, inverting the tool registry. The three reads below
 * can easily be called in the same tick (a heartbeat activity checks what is
 * running while a route renders the pulse table), so they await one load.
 */
let pending: Promise<typeof import('./job-store')> | null = null;
const store = () => (pending ??= import('./job-store'));

/** Every job chat currently knows about, running or recently finished. */
export async function listChatJobs(): Promise<ChatJobActivity[]> {
	const { listJobs } = await store();
	return listJobs();
}

/** Conversation id → the job running on it. Only genuinely running jobs. */
export async function runningJobsByConversation(): Promise<Map<string, string>> {
	const { listRunningJobsByConversation } = await store();
	return listRunningJobsByConversation();
}

/** The rolling pulse buffer, newest first. Admin observability only. */
export async function recentChatPulses(): Promise<PulseEvent[]> {
	const { getRecentPulses } = await store();
	return getRecentPulses();
}
