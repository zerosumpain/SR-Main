/**
 * The two health figures SR-Main's daydream signals sample each day.
 *
 * Both are read by code that indexes named fields — the signal builders turn
 * each one into a `Reading` with a fixed key — so unlike the agent tools, which
 * hand their JSON to a language model unexamined, these genuinely are a contract
 * and both repositories hold this file byte for byte.
 *
 * What makes them worth a contract rather than a duplicated implementation is
 * the ratio. `HealthSegmentTaxonomy` is seven integers, and computing them
 * reaches about 1,880 lines of segment derivation. `HealthDerived` is nine
 * figures over the readiness, monotony, recovery-debt, autonomic, circadian,
 * VO2 max and polarised analyses. Reimplementing either in Main would duplicate
 * the half that is genuinely Health's.
 *
 * Types only, no imports.
 */

/** Shape of `GET /api/health/derived`. */
export type HealthDerived = {
	today: string;
	readinessScore: number | null;
	moves: number;
	tripwiresTripped: number;
	tripwiresClose: number;
	experimentLive: number;
	experimentsQueued: number;
	/** Projected change in ACWR over the forecast horizon, if a forecast exists. */
	acwrForecastDelta: number | null;
	volumeWeekKm: number | null;
};

/** Shape of `GET /api/health/segment-taxonomy`. */
export type HealthSegmentTaxonomy = {
	improving: number;
	holding: number;
	slipping: number;
	/** Under the six-effort floor, or too few in the earlier window to read. */
	noRead: number;
	total: number;
	/** Rows with any direction at all — the denominator the three states share. */
	withForm: number;
	/** Improving AND inside the gettable gap of the record. */
	gettable: number;
};
