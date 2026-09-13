/**
 * The sports a route can be planned for, and the cap ORS puts on a round trip.
 *
 * These are a contract between two repositories rather than an implementation
 * detail of either. SR-Health's planner accepts exactly these keys; SR-Main's
 * `route_plan` tool builds its `sport` enum and its distance-cap wording from
 * them at REGISTRATION time, before any call is made.
 *
 * That timing is the whole reason this file exists. If the two lists drift, the
 * model is offered a sport the planner will reject, and the failure arrives as a
 * 400 inside a tool call — which reads to the model as "the route service is
 * broken" rather than "that sport does not exist". Nothing fails a build.
 *
 * Constants only, and no imports, so both repositories can hold it byte for byte
 * and their drift manifests can guard it.
 */

/** ORS profiles we expose. Each maps to one of John's sports. */
export const ORS_PROFILES = {
	run: 'foot-hiking',
	trail_run: 'foot-hiking',
	walk: 'foot-walking',
	hike: 'foot-hiking',
	ride: 'cycling-road',
	mtb: 'cycling-mountain',
} as const;

export type PlannerSport = keyof typeof ORS_PROFILES;

/** Round-trip and alternative routes are capped by ORS at 100 km. */
export const ORS_ROUND_TRIP_MAX_M = 100_000;
