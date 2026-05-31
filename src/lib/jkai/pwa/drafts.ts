import { openJkaiDB, type DraftRecord } from './db';

function uuid(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface DraftInput {
	id?: string;
	body: string;
	sourceConversationId?: string;
}

export async function saveDraft(input: DraftInput): Promise<string> {
	const db = await openJkaiDB();
	const record: DraftRecord = {
		id: input.id ?? uuid(),
		body: input.body,
		sourceConversationId: input.sourceConversationId,
		updatedAt: new Date().toISOString(),
	};
	await db.put('drafts', record);
	db.close();
	return record.id;
}

export async function listDrafts(): Promise<DraftRecord[]> {
	const db = await openJkaiDB();
	const all = (await db.getAllFromIndex('drafts', 'updatedAt')) as DraftRecord[];
	db.close();
	return all.reverse();
}

export async function getDraft(id: string): Promise<DraftRecord | undefined> {
	const db = await openJkaiDB();
	const r = (await db.get('drafts', id)) as DraftRecord | undefined;
	db.close();
	return r;
}

export async function deleteDraft(id: string): Promise<void> {
	const db = await openJkaiDB();
	await db.delete('drafts', id);
	db.close();
}
