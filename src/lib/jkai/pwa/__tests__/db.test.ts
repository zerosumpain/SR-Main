// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { openJkaiDB, JKAI_DB_NAME, JKAI_DB_VERSION } from '../db';

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
