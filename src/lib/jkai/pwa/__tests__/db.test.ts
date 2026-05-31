// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openJkaiDB, JKAI_DB_NAME, JKAI_DB_VERSION } from '../db';
import {
	putConversation,
	putBuild,
	listConversations,
	listBuilds,
	evictConversations,
	evictBuilds,
} from '../db';
import { putMessages, listMessages, replaceMessagesForConversation } from '../db';

describe('openJkaiDB', () => {
	beforeEach(async () => {
		indexedDB.deleteDatabase(JKAI_DB_NAME);
	});

	it('opens with the expected stores', async () => {
		const db = await openJkaiDB();
		const stores = [...db.objectStoreNames].sort();
		expect(stores).toEqual([
			'buildDetail',
			'builds',
			'conversations',
			'drafts',
			'messages',
			'meta',
			'outbox',
		]);
		expect(db.version).toBe(JKAI_DB_VERSION);
		db.close();
	});
});

describe('conversation cache', () => {
	beforeEach(async () => {
		indexedDB.deleteDatabase(JKAI_DB_NAME);
	});

	it('lists conversations newest first and evicts to budget', async () => {
		for (let i = 0; i < 60; i++) {
			await putConversation({
				id: `c${i}`,
				title: `Convo ${i}`,
				updatedAt: new Date(2026, 0, 1, 0, i).toISOString(),
			});
		}
		const before = await listConversations();
		expect(before).toHaveLength(60);
		await evictConversations();
		const after = await listConversations();
		expect(after).toHaveLength(50);
		expect(after[0].id).toBe('c59');
		expect(after[49].id).toBe('c10');
	});
});

describe('build cache', () => {
	beforeEach(async () => {
		indexedDB.deleteDatabase(JKAI_DB_NAME);
	});

	it('evicts builds to budget', async () => {
		for (let i = 0; i < 40; i++) {
			await putBuild({
				id: `b${i}`,
				title: `Build ${i}`,
				status: 'done',
				createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
			});
		}
		await evictBuilds();
		const builds = await listBuilds();
		expect(builds).toHaveLength(30);
		expect(builds[0].id).toBe('b39');
	});
});

describe('message cache', () => {
	beforeEach(async () => { indexedDB.deleteDatabase(JKAI_DB_NAME); });

	it('puts and lists messages for a conversation in createdAt order', async () => {
		await putMessages([
			{ id: 'm2', conversationId: 'c1', role: 'assistant', body: 'b', createdAt: '2026-01-01T00:00:02Z' },
			{ id: 'm1', conversationId: 'c1', role: 'user',      body: 'a', createdAt: '2026-01-01T00:00:01Z' },
		]);
		const msgs = await listMessages('c1');
		expect(msgs.map((m) => m.id)).toEqual(['m1', 'm2']);
	});

	it('replaceMessagesForConversation removes old then writes new', async () => {
		await putMessages([
			{ id: 'old', conversationId: 'c1', role: 'user', body: 'old', createdAt: '2026-01-01T00:00:00Z' },
		]);
		await replaceMessagesForConversation('c1', [
			{ id: 'new', conversationId: 'c1', role: 'user', body: 'new', createdAt: '2026-01-02T00:00:00Z' },
		]);
		const msgs = await listMessages('c1');
		expect(msgs.map((m) => m.id)).toEqual(['new']);
	});
});
