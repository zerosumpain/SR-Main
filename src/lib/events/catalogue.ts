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
 * Names are `<domain>.<what>`. The old `workflow_completed` is kept as an ALIAS
 * of `workflow.completed`: a stored schedule naming it still fires (production
 * had no event schedules when this changed, so the alias is cheap insurance
 * rather than a migration).
 *
 * Every entry has a producer in this repo. `intel.alert` and
 * `whoop_recovery_updated` were listed here with none — the intel engine and
 * the Whoop sync run in other applications and never raised them — so they
 * were removed rather than left pickable and silent. A stored schedule that
 * still names one keeps resolving (`canonicalEventType` passes an unknown name
 * through) and waits for an event that never comes, exactly as it did before.
 *
 * The feature events below (`family.alert` onward) build their payloads in
 * `./payloads`, which is the allow-list: names and ids, never a position, an
 * address, an email, a phone number or a visitor's network.
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
    type: 'health.summary_changed',
    label: 'Health figures moved',
    description: 'The health watcher saw your headline figures change (checked every 15 minutes).',
    source: 'health watcher',
    payloadExample: { fingerprint: 'a1b2…', title: 'Readiness 72 · Good', body: 'Recovery: 64% (was 58%) ↑', readiness: 72 },
  },
  {
    type: 'connector.broken',
    label: 'A connection needs you',
    description: 'The connector watcher saw an account or service stop working — a lapsed sign-in (status auth_expired) or an outage (broken). Checked every 30 minutes.',
    source: 'connector watcher',
    payloadExample: {
      key: 'gmail:1',
      label: 'Gmail · me@example.com',
      group: 'Email',
      status: 'auth_expired',
      title: 'Gmail · me@example.com needs re-authorising',
      detail: 'Gmail token refresh failed: invalid_grant',
      fixUrl: 'https://strangeramblings.com/api/gmail/connect',
      since: '2026-09-25T07:40:00.000Z',
    },
  },
  {
    type: 'connector.recovered',
    label: 'A connection is working again',
    description: 'A connection the watcher had reported as needing you is working again.',
    source: 'connector watcher',
    payloadExample: {
      key: 'gmail:1',
      label: 'Gmail · me@example.com',
      group: 'Email',
      status: 'auth_expired',
      title: 'Gmail · me@example.com needs re-authorising',
      detail: 'Gmail token refresh failed: invalid_grant',
      fixUrl: 'https://strangeramblings.com/api/gmail/connect',
      since: '2026-09-25T07:40:00.000Z',
    },
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
    type: 'family.alert',
    label: 'A family alert went out',
    description: 'A family alert was delivered: someone arrived at or left a place, stopped somewhere new, is late for school, finished a journey, has a low phone battery, or raised the alarm. Filter on kind or person. Carries names only, never a position.',
    source: 'family alerts',
    payloadExample: { kind: 'arrive', person: 'Sam', place: 'School', title: 'Sam arrived at School' },
  },
  {
    type: 'wishlist.offer',
    label: 'A wishlist offer was found',
    description: 'The wishlist sweep found something worth telling you about for a wish: a first offer, a better price, or a price under your target.',
    source: 'wishlist sweep',
    payloadExample: { wishId: 'uuid', title: 'Example kettle 1.7L', price: 24.99, currency: 'GBP', url: 'https://shop.example.com/kettle' },
  },
  {
    type: 'trip.needs_you',
    label: 'A trip needs a decision',
    description: 'A trip plan is waiting on you: a planning question only you can answer (reason question) or a suggestion from the family to approve (reason suggestion).',
    source: 'trips',
    payloadExample: { tripId: 'uuid', title: 'Summer week away', reason: 'question' },
  },
  {
    type: 'share.opened',
    label: 'A share link was opened',
    description: 'Somebody opened a page through one of your project share links. At most one event per link every ten minutes; says which link, never who.',
    source: 'project shares',
    payloadExample: { shareId: 'uuid', project: 'example-project', label: 'For the review group' },
  },
  {
    type: 'capture.ready',
    label: 'A capture is ready',
    description: 'A recording or photo you captured has been analysed and filed. followUps is how many follow-up actions it found; the transcript is not carried.',
    source: 'captures',
    payloadExample: { captureId: 'uuid', title: 'Planning call', followUps: 2 },
  },
  {
    type: 'release.live',
    label: 'A release went live',
    description: 'A production release of one of the site\'s applications was recorded as live (reported by its release pipeline after the public check).',
    source: 'release ledger',
    payloadExample: { app: 'example-app', sha: '0123abc' },
  },
  {
    type: 'pull.opened',
    label: 'A pull request was opened',
    description: 'The site opened a pull request on GitHub (a build, a change request or a repair). Pull requests opened by hand elsewhere are not seen.',
    source: 'GitHub client',
    payloadExample: { repo: 'example-org/example-repo', number: 123, title: 'Add the example feature' },
  },
  {
    type: 'game.finished',
    label: 'A game round finished',
    description: 'A round of one of the multiplayer games was scored. winner is the display name of whoever won, and is absent when nobody did.',
    source: 'game results',
    payloadExample: { game: 'example-game', roomId: 'ABCD', winner: 'Sam' },
  },
  {
    type: 'daydream.acted',
    label: 'A daydream note was acted on',
    description: 'An action was carried out from a daydream note: its proposed action was done, or a worked solution was applied. action names what was done.',
    source: 'daydream',
    payloadExample: { daydreamId: 'uuid', title: 'Tidy the example backlog', action: 'reminder' },
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
