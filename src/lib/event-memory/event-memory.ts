export type EventSource = 'calendar' | 'mail' | 'location' | 'health' | 'explicit_action';
export type MemoryPurpose = 'record' | 'recommend';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ConsentGrant {
	id: string;
	userId: string;
	sources: readonly EventSource[];
	purposes: readonly MemoryPurpose[];
	grantedAt: Date;
	expiresAt?: Date;
	revokedAt?: Date;
}

export interface Provenance {
	source: EventSource;
	reference: string;
	observedAt: Date;
	description?: string;
}

export interface MemoryFact {
	subject: string;
	predicate: string;
	value: JsonValue;
	inferred: boolean;
	rationale?: string;
}

export interface PersonalEvent {
	id: string;
	userId: string;
	occurredAt: Date;
	recordedAt: Date;
	fact: MemoryFact;
	confidence: number;
	provenance: readonly Provenance[];
	consentId: string;
}

export type PromptStatus = 'pending' | 'accepted' | 'dismissed' | 'expired';

export interface ProactivePrompt {
	id: string;
	userId: string;
	dedupeKey: string;
	kind: 'calendar_preparation' | 'mail_follow_up' | 'location_follow_up' | 'health_recovery' | 'action_follow_up';
	title: string;
	body: string;
	evidenceEventIds: readonly string[];
	status: PromptStatus;
	requiresReview: true;
	createdAt: Date;
	expiresAt: Date;
	reviewedAt?: Date;
	reviewedBy?: string;
}

export interface EventMemoryRepository {
	createEvent(event: PersonalEvent): Promise<void>;
	listEvents(userId: string, since: Date): Promise<readonly PersonalEvent[]>;
	listPrompts(userId: string, statuses?: readonly PromptStatus[]): Promise<readonly ProactivePrompt[]>;
	createPrompt(prompt: ProactivePrompt): Promise<void>;
	updatePromptReview(
		userId: string,
		promptId: string,
		review: Pick<ProactivePrompt, 'status' | 'reviewedAt' | 'reviewedBy'>
	): Promise<ProactivePrompt | undefined>;
}

export interface IngestEventInput {
	userId: string;
	occurredAt: Date;
	fact: MemoryFact;
	confidence: number;
	provenance: readonly Provenance[];
	consent: ConsentGrant;
}

export interface EventMemoryServiceOptions {
	now?: () => Date;
	newId?: () => string;
}

const dayInMilliseconds = 24 * 60 * 60 * 1000;

function defaultId(): string {
	return crypto.randomUUID();
}

function isActiveConsent(consent: ConsentGrant, now: Date): boolean {
	return !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > now) && consent.grantedAt <= now;
}

function objectValue(value: JsonValue): Record<string, JsonValue> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function stringField(value: JsonValue, field: string): string | undefined {
	const object = objectValue(value);
	const candidate = object?.[field];
	return typeof candidate === 'string' ? candidate : undefined;
}

function numberField(value: JsonValue): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sourceLabel(source: EventSource): string {
	return source === 'explicit_action' ? 'an action you recorded' : `your ${source.replace('_', ' ')}`;
}

export class EventMemoryService {
	private readonly now: () => Date;
	private readonly newId: () => string;

	constructor(
		private readonly repository: EventMemoryRepository,
		options: EventMemoryServiceOptions = {}
	) {
		this.now = options.now ?? (() => new Date());
		this.newId = options.newId ?? defaultId;
	}

	async ingest(input: IngestEventInput): Promise<PersonalEvent> {
		const now = this.now();
		this.assertIngestible(input, now);

		const event: PersonalEvent = {
			id: this.newId(),
			userId: input.userId,
			occurredAt: input.occurredAt,
			recordedAt: now,
			fact: input.fact,
			confidence: input.confidence,
			provenance: input.provenance,
			consentId: input.consent.id
		};
		await this.repository.createEvent(event);
		return event;
	}

	async recommend(userId: string): Promise<readonly ProactivePrompt[]> {
		const now = this.now();
		const events = await this.repository.listEvents(userId, new Date(now.getTime() - 7 * dayInMilliseconds));
		const existing = await this.repository.listPrompts(userId, ['pending']);
		const existingKeys = new Set(existing.filter((prompt) => prompt.expiresAt > now).map((prompt) => prompt.dedupeKey));
		const prompts: ProactivePrompt[] = [];

		for (const event of events) {
			const candidate = this.promptFor(event, now);
			if (!candidate || existingKeys.has(candidate.dedupeKey)) continue;
			await this.repository.createPrompt(candidate);
			existingKeys.add(candidate.dedupeKey);
			prompts.push(candidate);
		}
		return prompts;
	}

	async reviewPrompt(
		userId: string,
		promptId: string,
		decision: 'accepted' | 'dismissed',
		reviewedBy: string
	): Promise<ProactivePrompt> {
		if (!reviewedBy.trim()) throw new Error('A reviewer identity is required.');
		const reviewed = await this.repository.updatePromptReview(userId, promptId, {
			status: decision,
			reviewedAt: this.now(),
			reviewedBy
		});
		if (!reviewed) throw new Error('Prompt was not found or has already been reviewed.');
		return reviewed;
	}

	private assertIngestible(input: IngestEventInput, now: Date): void {
		if (!input.userId || input.consent.userId !== input.userId) throw new Error('Consent must belong to the event user.');
		if (!isActiveConsent(input.consent, now)) throw new Error('Active consent is required to record an event.');
		if (!input.consent.purposes.includes('record')) throw new Error('Consent does not permit event recording.');
		if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
			throw new Error('Confidence must be between 0 and 1.');
		}
		if (!input.fact.subject.trim() || !input.fact.predicate.trim()) throw new Error('Facts require a subject and predicate.');
		if (input.fact.inferred && !input.fact.rationale?.trim()) throw new Error('Inferred facts require a rationale.');
		if (input.provenance.length === 0) throw new Error('At least one provenance record is required.');
		for (const provenance of input.provenance) {
			if (!input.consent.sources.includes(provenance.source)) {
				throw new Error(`Consent does not permit the ${provenance.source} source.`);
			}
			if (!provenance.reference.trim()) throw new Error('Provenance requires a stable source reference.');
		}
	}

	private promptFor(event: PersonalEvent, now: Date): ProactivePrompt | undefined {
		if (event.confidence < 0.6) return undefined;
		const source = event.provenance[0]?.source;
		if (!source) return undefined;
		const prefix = `Based on ${sourceLabel(source)}, this is a suggestion to review; it is not saved as a fact.`;
		const makePrompt = (kind: ProactivePrompt['kind'], title: string, detail: string): ProactivePrompt => ({
			id: this.newId(),
			userId: event.userId,
			dedupeKey: `${event.id}:${kind}`,
			kind,
			title,
			body: `${prefix} ${detail}`,
			evidenceEventIds: [event.id],
			status: 'pending',
			requiresReview: true,
			createdAt: now,
			expiresAt: new Date(now.getTime() + dayInMilliseconds)
		});

		if (event.fact.predicate === 'calendar.event') {
			const start = stringField(event.fact.value, 'start');
			const title = stringField(event.fact.value, 'title') ?? 'an upcoming event';
			const startAt = start ? new Date(start) : undefined;
			if (startAt && !Number.isNaN(startAt.getTime()) && startAt > now && startAt.getTime() - now.getTime() <= dayInMilliseconds) {
				return makePrompt('calendar_preparation', `Prepare for ${title}?`, `Would you like to check whether anything is needed before it starts?`);
			}
		}
		if (event.fact.predicate === 'mail.action_required') {
			const subject = stringField(event.fact.value, 'subject') ?? 'an email';
			return makePrompt('mail_follow_up', `Review follow-up for ${subject}?`, 'Would you like to confirm whether a response or task is needed?');
		}
		if (event.fact.predicate === 'location.arrival') {
			const place = stringField(event.fact.value, 'place') ?? 'a recent location';
			return makePrompt('location_follow_up', `Review a follow-up for ${place}?`, 'Would you like to record or plan anything connected with this visit?');
		}
		if (event.fact.predicate === 'health.recovery_score') {
			const score = numberField(event.fact.value);
			if (score !== undefined && score <= 40) {
				return makePrompt('health_recovery', 'Review today’s activity intensity?', `The recorded recovery score was ${score}. Would you like to consider a lighter plan?`);
			}
		}
		if (event.fact.predicate === 'user.action') {
			const action = stringField(event.fact.value, 'label') ?? 'this action';
			return makePrompt('action_follow_up', `Review follow-up for ${action}?`, 'Would you like to set a reminder or take a related next step?');
		}
		return undefined;
	}
}
