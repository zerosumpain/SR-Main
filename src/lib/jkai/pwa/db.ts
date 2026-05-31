import { openDB, type IDBPDatabase } from 'idb';

export const JKAI_DB_NAME = 'jkai-pwa';
export const JKAI_DB_VERSION = 1;

export const CONVERSATION_BUDGET = 50;
export const BUILDS_BUDGET = 30;

export interface ConversationCacheRecord {
	id: string;
	title: string;
	modelProvider?: string;
	modelId?: string;
	updatedAt: string;
	summary?: string;
}

export interface MessageCacheRecord {
	id: string;
	conversationId: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	body: string;
	attachments?: unknown;
	createdAt: string;
}

export interface BuildCacheRecord {
	id: string;
	title: string;
	status: string;
	createdAt: string;
	planSummary?: string;
}

export interface BuildDetailCacheRecord {
	id: string;
	plan?: unknown;
	logs?: unknown;
	outputs?: unknown;
	fetchedAt: string;
}

export type OutboxType = 'sendMessage';

export interface OutboxRecord<T = unknown> {
	id: string;
	type: OutboxType;
	payload: T;
	createdAt: string;
	attempts: number;
	lastError?: string;
}

export interface DraftRecord {
	id: string;
	body: string;
	sourceConversationId?: string;
	updatedAt: string;
}

export interface MetaRecord {
	key: string;
	value: unknown;
	updatedAt: string;
}

export async function openJkaiDB(): Promise<IDBPDatabase> {
	return openDB(JKAI_DB_NAME, JKAI_DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('conversations')) {
				const s = db.createObjectStore('conversations', { keyPath: 'id' });
				s.createIndex('updatedAt', 'updatedAt');
			}
			if (!db.objectStoreNames.contains('messages')) {
				const s = db.createObjectStore('messages', { keyPath: ['conversationId', 'id'] });
				s.createIndex('byConversation', 'conversationId');
			}
			if (!db.objectStoreNames.contains('builds')) {
				const s = db.createObjectStore('builds', { keyPath: 'id' });
				s.createIndex('createdAt', 'createdAt');
			}
			if (!db.objectStoreNames.contains('buildDetail')) {
				db.createObjectStore('buildDetail', { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains('outbox')) {
				const s = db.createObjectStore('outbox', { keyPath: 'id' });
				s.createIndex('createdAt', 'createdAt');
			}
			if (!db.objectStoreNames.contains('drafts')) {
				const s = db.createObjectStore('drafts', { keyPath: 'id' });
				s.createIndex('updatedAt', 'updatedAt');
			}
			if (!db.objectStoreNames.contains('meta')) {
				db.createObjectStore('meta', { keyPath: 'key' });
			}
		},
	});
}

export async function putConversation(r: ConversationCacheRecord): Promise<void> {
	const db = await openJkaiDB();
	await db.put('conversations', r);
	db.close();
}

export async function listConversations(): Promise<ConversationCacheRecord[]> {
	const db = await openJkaiDB();
	const all = await db.getAllFromIndex('conversations', 'updatedAt');
	db.close();
	return all.reverse() as ConversationCacheRecord[];
}

export async function evictConversations(): Promise<void> {
	const db = await openJkaiDB();
	const tx = db.transaction(['conversations', 'messages'], 'readwrite');
	const idx = tx.objectStore('conversations').index('updatedAt');
	const all = (await idx.getAll()).reverse() as ConversationCacheRecord[];
	const keep = new Set(all.slice(0, CONVERSATION_BUDGET).map((c) => c.id));
	for (const c of all) {
		if (keep.has(c.id)) continue;
		await tx.objectStore('conversations').delete(c.id);
		const msgIdx = tx.objectStore('messages').index('byConversation');
		let cursor = await msgIdx.openCursor(IDBKeyRange.only(c.id));
		while (cursor) {
			await cursor.delete();
			cursor = await cursor.continue();
		}
	}
	await tx.done;
	db.close();
}

export async function putBuild(r: BuildCacheRecord): Promise<void> {
	const db = await openJkaiDB();
	await db.put('builds', r);
	db.close();
}

export async function listBuilds(): Promise<BuildCacheRecord[]> {
	const db = await openJkaiDB();
	const all = await db.getAllFromIndex('builds', 'createdAt');
	db.close();
	return all.reverse() as BuildCacheRecord[];
}

export async function evictBuilds(): Promise<void> {
	const db = await openJkaiDB();
	const tx = db.transaction(['builds', 'buildDetail'], 'readwrite');
	const idx = tx.objectStore('builds').index('createdAt');
	const all = (await idx.getAll()).reverse() as BuildCacheRecord[];
	const keep = new Set(all.slice(0, BUILDS_BUDGET).map((b) => b.id));
	for (const b of all) {
		if (keep.has(b.id)) continue;
		await tx.objectStore('builds').delete(b.id);
		await tx.objectStore('buildDetail').delete(b.id);
	}
	await tx.done;
	db.close();
}
