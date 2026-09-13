/**
 * The health rail of the chat context panel, as agreed between two repositories.
 *
 * SR-Health's /api/health/context returns exactly this; SR-Main's context panel
 * renders exactly this. It is deliberately NOT either side's internal type — if
 * it were, the contract would be one repository's internals and every refactor
 * there would be a breaking change here.
 *
 * Types only, and no imports, so the file can be byte-identical in both
 * repositories and guarded by their shared-module manifests. Changing it on one
 * side alone is a red test rather than a field that silently arrives undefined.
 */
export type HealthContext = {
	/** With no real day in the window the whole series is a demonstration, and the
	 *  caller must not present it as measurement. */
	seriesIsMock: boolean;
	strap: string;
	today: { rec: number; hrv: number; rhr: number; slept: number };
	todayDeltas: { hrvDeltaPct: number; rhrDelta: number; sleepDelta: number };
	/** Days carrying at least one measurement. Filtered by the server, because an
	 *  empty day plots as a hole in every chart drawn from this. */
	days: Array<{
		date: string;
		rec: number;
		hrv: number;
		rhr: number;
		slept: number;
		/** null, never absent: undefined disappears through JSON.stringify and the
		 *  caller then cannot tell "no score" from "field gone". */
		sleepScore: number | null;
	}>;
	/** Absent when readiness could not be computed; the caller falls back to the
	 *  series' own recovery figure. */
	readiness: { score: number; label: string; recommendation: string } | null;
};
