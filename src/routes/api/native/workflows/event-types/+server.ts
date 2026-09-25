import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { eventCatalogueDTO } from '$lib/events/catalogue';

/**
 * GET /api/native/workflows/event-types — what a workflow can start on.
 *
 * → { eventTypes: [{ type, label, description, source, payloadExample, filterKeys }] }
 *
 * The same catalogue the canvas trigger picker reads. `filterKeys` are the
 * top-level payload keys a trigger filter can match; `payloadExample` shows what
 * a run receives as `{{input.event.<key>}}`.
 *
 * A static segment, so SvelteKit matches it before `[slug]`.
 */
export const GET: RequestHandler = withDevice(async () => {
  return { eventTypes: eventCatalogueDTO() };
});
