import { describe, expect, it } from 'vitest';
import { EventMemoryService, type ConsentGrant, type EventMemoryRepository, type PersonalEvent, type ProactivePrompt } from './event-memory';

class MemoryRepository implements EventMemoryRepository {
	events: PersonalEvent[] = [];
	prompts: ProactivePrompt[] = [];

	async createEvent(event: PersonalEvent): Promise<void> { this.events.push(event); }
	async listEvents(userId: string): Promise<readonly PersonalEvent[]> { return this.events.filter((event) => event.userId === userId); }
	async listPrompts(userId: string, statuses?: readonly ProactivePrompt['status'][]): Promise<readonly ProactivePrompt[]> {
		return this.prompts.filter((prompt) => prompt.userId === userId && (!statuses || statuses.includes(prompt.status)));
	}
	async createPrompt(prompt: ProactivePrompt): Promise<void> { this.prompts.push(prompt); }
	async updatePromptReview(userId: string, promptId: string, review: Pick<ProactivePrompt, 'status' | 'reviewedAt' | 'reviewedBy'>): Promise<ProactivePrompt | undefined> {
		const prompt = this.prompts.find((candidate) => candidate.userId === userId && candidate.id === promptId && candidate.status === 'pending');
		if (!prompt) return undefined;
		Object.assign(prompt, review);
		return prompt;
	}
}

const now = new Date('2026-09-01T09:00:00.000Z');
const consent: ConsentGrant = {
	id: 'consent-1', userId: 'user-1', sources: ['calendar', 'mail', 'location', 'health', 'explicit_action'], purposes: ['record', 'recommend'], grantedAt: new Date('2026-08-01T00:00:00.000Z')
};

function service(repository: MemoryRepository): EventMemoryService {
	let sequence = 0;
	return new EventMemoryService(repository, { now: () => now, newId: () => `id-${++sequence}` });
}

describe('EventMemoryService', () => {
	it('requires active source-specific consent and provenance before recording an inferred fact', async () => {
		const repository = new MemoryRepository();
		const memory = service(repository);
		await expect(memory.ingest({
			userId: 'user-1', occurredAt: now, confidence: 0.8,
			fact: { subject: 'user-1', predicate: 'mail.action_required', value: { subject: 'Invoice' }, inferred: true },
			provenance: [{ source: 'mail', reference: 'message-1', observedAt: now }], consent
		})).rejects.toThrow('rationale');
		expect(repository.events).toHaveLength(0);
	});

	it('creates one reviewable calendar prompt and never duplicates it', async () => {
		const repository = new MemoryRepository();
		const memory = service(repository);
		await memory.ingest({
			userId: 'user-1', occurredAt: now, confidence: 0.9,
			fact: { subject: 'user-1', predicate: 'calendar.event', value: { title: 'Dentist', start: '2026-09-01T15:00:00.000Z' }, inferred: true, rationale: 'Calendar event is scheduled.' },
			provenance: [{ source: 'calendar', reference: 'calendar-event-1', observedAt: now }], consent
		});
		const first = await memory.recommend('user-1');
		const second = await memory.recommend('user-1');
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(0);
		expect(first[0]).toMatchObject({ kind: 'calendar_preparation', requiresReview: true, status: 'pending', evidenceEventIds: ['id-1'] });
		expect(first[0].body).toContain('not saved as a fact');
	});

	it('records a human review decision without turning a prompt into a fact', async () => {
		const repository = new MemoryRepository();
		const memory = service(repository);
		repository.prompts.push({ id: 'prompt-1', userId: 'user-1', dedupeKey: 'key', kind: 'mail_follow_up', title: 'Review', body: 'Review evidence.', evidenceEventIds: ['event-1'], status: 'pending', requiresReview: true, createdAt: now, expiresAt: new Date('2026-09-02T09:00:00.000Z') });
		const reviewed = await memory.reviewPrompt('user-1', 'prompt-1', 'dismissed', 'user-1');
		expect(reviewed.status).toBe('dismissed');
		expect(reviewed.reviewedBy).toBe('user-1');
		expect(repository.events).toHaveLength(0);
	});
});
