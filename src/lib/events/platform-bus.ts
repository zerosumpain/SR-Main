import { EventEmitter } from 'events';

/**
 * The in-process platform event channel: types, an emitter, and nothing else.
 *
 * This used to live inside `$lib/workflows/event-bus`, alongside the code that
 * reacts to an event by starting a workflow. Publishing and dispatching are not
 * the same job, and joining them made the cheap half expensive: `event-bus`
 * imports `engine` from the `$lib/workflows` barrel, so anything that merely
 * wanted to SAY "a Strava activity synced" pulled in the entire node registry
 * behind it. Measured from `$lib/health`, that one edge took the module's import
 * closure from 308 files to 1,007.
 *
 * A publisher should not have to depend on its subscribers. Emitting is now free:
 * this file imports one Node builtin.
 *
 * The dispatcher still lives in `$lib/workflows/event-bus`, subscribes to this
 * emitter, and is loaded at boot through hooks.server.ts. Both halves share this
 * one emitter instance, so an event emitted here still reaches it.
 */

/**
 * The array is the declaration and the union is derived from it, rather than the
 * two being written out separately and kept in step by hand.
 *
 * That pairing is what the dispatcher's bug was: event-bus.ts listed the three
 * names in the union and then listed them again at the bottom of the file to
 * subscribe. A fourth member added to the union and not to that list would be
 * publishable and silently never dispatched — and a test that loops over the
 * list cannot catch it, because it is looping over the half that is wrong.
 */
export const PLATFORM_EVENT_TYPES = [
	'strava_activity_synced',
	'whoop_recovery_updated',
	'workflow_completed'
] as const;

export type PlatformEventType = (typeof PLATFORM_EVENT_TYPES)[number];

export interface PlatformEvent {
	type: PlatformEventType;
	payload?: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emit(type: PlatformEventType, payload?: Record<string, unknown>): void {
	emitter.emit(type, { type, payload });
}

export function on(
	type: PlatformEventType,
	handler: (event: PlatformEvent) => void
): () => void {
	emitter.on(type, handler);
	return () => emitter.off(type, handler);
}

/** For the dispatcher, which subscribes to every type at boot. */
export function onAll(handler: (event: PlatformEvent) => void): () => void {
	const offs = PLATFORM_EVENT_TYPES.map((type) => on(type, handler));
	return () => offs.forEach((off) => off());
}
