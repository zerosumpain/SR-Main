/**
 * Everything the site can say happened, named once.
 *
 * This replaces the two-entry `PLATFORM_EVENT_TYPES` array that used to sit in
 * `platform-bus.ts`, and the `<option>` list hard-coded into the canvas trigger
 * menu that had to be kept in step with it by hand. The canvas event picker, the
 * iPhone's `GET /api/native/workflows/event-types`, the dispatcher's
 * subscription and the `emit()` type all read this array, so an event added here
 * is publishable, dispatchable and pickable at once — and one missing here is
 * none of the three.
 *
 * Pure data and client-safe: the canvas imports it directly.
 *
 * `payloadExample` is not decoration. A trigger hands its event to the run as
 * `{{input.event.<key>}}`, and the example is the only place a person building a
 * workflow can see which keys exist. It is also what the filter's key picker
 * offers — filters match TOP-LEVEL keys only, so an example with its interesting
 * fields buried in an object is an example nobody can filter on.
 *
 * Names are `<domain>.<what>`, except `whoop_recovery_updated`, which predates
 * the convention and has a producer outside this repo's control. The old
 * `workflow_completed` is kept as an ALIAS of `workflow.completed`: a stored
 * schedule naming it still fires (production had no event schedules when this
 * changed, so the alias is cheap insurance rather than a migration).
 */

export interface EventCatalogueEntry {
  type: string;
  label: string;
  description: string;
  /** Where it is raised, for a reader deciding whether to trust it. */
  source: string;
  payloadExample: Record<string, unknown>;
  /** Older names a stored schedule may still carry. */
  aliases?: readonly string[];
}

export const EVENT_CATALOGUE = [
  {
    type: 'workflow.completed',
    label: 'A workflow finished',
    description: 'Another workflow completed (with or without node errors). Pin a source canvas to follow one workflow.',
    source: 'run-finalise',
    payloadExample: { workflowId: 'wf_…', runId: 'run_…', status: 'completed' },
    aliases: ['workflow_completed'],
  },
  {
    type: 'notification.raised',
    label: 'A notification was raised',
    description: 'The site raised an owner notification (after the ledger row is written). A workflow never re-triggers itself off its own notifications.',
    source: 'notifyOwner',
    payloadExample: {
      id: 'uuid',
      category: 'build',
      title: 'Build shipped',
      body: 'PR #123 merged',
      severity: 'info',
      url: '/jkai/builds',
      whatsapp: true,
      native: true,
    },
  },
  {
    type: 'whatsapp.inbound',
    label: 'WhatsApp message from you',
    description: 'You sent the site a WhatsApp message. Filter on text, e.g. text contains "lights".',
    source: 'WhatsApp inbound',
    payloadExample: { from: '+44…', text: 'lights off downstairs' },
  },
  {
    type: 'gmail.inbound',
    label: 'Email arrived on a watch',
    description: 'A Gmail watch saw a new message. Filter on from, subject or watchLabel.',
    source: 'Gmail watcher',
    payloadExample: {
      accountEmail: 'me@example.com',
      watchLabel: 'Inbox',
      from: 'someone@example.com',
      subject: 'Invoice',
      snippet: 'Please find attached…',
      messageId: '18f…',
      threadId: '18f…',
    },
  },
  {
    type: 'news.item',
    label: 'New stories on the news desk',
    description: 'The desk stored stories it had never seen. One event per gather, carrying every new story, not one event per story.',
    source: 'news desk',
    payloadExample: {
      count: 2,
      sources: ['hn'],
      titles: 'Story one | Story two',
      items: [{ key: 'hn:1', source: 'hn', title: 'Story one', url: 'https://…', domain: 'example.com' }],
    },
  },
  {
    type: 'intel.alert',
    label: 'High-significance intel alert',
    description: 'The intelligence engine raised a high-significance alert inside your scope.',
    source: 'intel engine',
    payloadExample: { alertId: 'uuid', noteId: 'uuid', type: 'risk_change', title: 'Risk moved', content: '…' },
  },
  {
    type: 'health.summary_changed',
    label: 'Health figures moved',
    description: 'The health watcher saw your headline figures change (checked every 15 minutes).',
    source: 'health watcher',
    payloadExample: { fingerprint: 'a1b2…', title: 'Readiness 72 · Good', body: 'Recovery: 64% (was 58%) ↑', readiness: 72 },
  },
  {
    type: 'alexa.utterance',
    label: 'Something was said to Alexa',
    description: 'A new utterance reached the voice log (synced every 5 minutes). Filter on command, device or room.',
    source: 'Alexa voice log',
    payloadExample: {
      id: 'event.kitchen_voice_event|…',
      device: 'Kitchen Echo',
      room: 'Kitchen',
      command: 'turn on the lights',
      reply: 'OK',
      person: 'John',
      occurredAt: '2026-09-25T07:00:00.000Z',
    },
  },
  {
    type: 'whoop_recovery_updated',
    label: 'Whoop recovery synced',
    description: 'A health sync stored new Whoop recovery records.',
    source: 'health sync',
    payloadExample: { recordsSynced: 1, syncedAt: '2026-09-25T07:00:00.000Z' },
  },
] as const satisfies readonly EventCatalogueEntry[];

export type PlatformEventType = (typeof EVENT_CATALOGUE)[number]['type'];
/** A name `emit`/`on` accept: a catalogue type or one of its aliases. */
export type PlatformEventName = PlatformEventType | 'workflow_completed';

export const PLATFORM_EVENT_TYPES: readonly PlatformEventType[] = EVENT_CATALOGUE.map((e) => e.type);

const BY_NAME = new Map<string, EventCatalogueEntry>();
for (const e of EVENT_CATALOGUE as readonly EventCatalogueEntry[]) {
  BY_NAME.set(e.type, e);
  for (const alias of e.aliases ?? []) BY_NAME.set(alias, e);
}

/** The catalogue entry for a type or alias, or null. */
export function eventEntry(name: string): EventCatalogueEntry | null {
  return BY_NAME.get(name) ?? null;
}

/** The canonical type for a name; an unknown name passes through unchanged. */
export function canonicalEventType(name: string): string {
  return BY_NAME.get(name)?.type ?? name;
}

export function isKnownEventType(name: string): boolean {
  return BY_NAME.has(name);
}

/** The catalogue as the phone and the canvas read it: keys a filter can target. */
export function eventCatalogueDTO() {
  return (EVENT_CATALOGUE as readonly EventCatalogueEntry[]).map((e) => ({
    type: e.type,
    label: e.label,
    description: e.description,
    source: e.source,
    payloadExample: e.payloadExample,
    filterKeys: Object.keys(e.payloadExample),
  }));
}
