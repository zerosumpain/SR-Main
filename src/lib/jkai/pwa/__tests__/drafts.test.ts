// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { JKAI_DB_NAME } from '../db';
import { saveDraft, listDrafts, deleteDraft, getDraft } from '../drafts';

beforeEach(() => indexedDB.deleteDatabase(JKAI_DB_NAME));

describe('drafts', () => {
	it('saves, lists newest-first, retrieves, and deletes', async () => {
		const a = await saveDraft({ body: 'first' });
		await new Promise((r) => setTimeout(r, 5));
		const b = await saveDraft({ body: 'second', sourceConversationId: 'c1' });

		const all = await listDrafts();
		expect(all.map((d) => d.id)).toEqual([b, a]);

		expect((await getDraft(a))?.body).toBe('first');

		await deleteDraft(a);
		expect(await listDrafts()).toHaveLength(1);
	});

	it('saveDraft with id updates existing', async () => {
		const id = await saveDraft({ body: 'one' });
		await saveDraft({ id, body: 'two' });
		expect((await getDraft(id))?.body).toBe('two');
		expect(await listDrafts()).toHaveLength(1);
	});
});
