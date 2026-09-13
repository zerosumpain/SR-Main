/**
 * The handful of presentation helpers that are not about health.
 *
 * They were in $lib/components/health/v2/utils.ts alongside the pulse ramps and
 * the recovery/HRV row keys, which was fine while /health was the only place
 * that used them. It is not: the ECG animation, its signal generator and Drive's
 * vitals tile all reach into the health directory for one function each, and
 * that directory is due to leave with the health application.
 *
 * $lib/components/health/v2/utils.ts re-exports these, so health code is
 * unchanged and there is one implementation rather than two.
 */

/** Constrain a value to a range. */
export function clamp(v: number, a: number, b: number): number {
	return Math.max(a, Math.min(b, v));
}

/** "3m", "2h", "4d" — a compact age for a timestamp tile. */
export function fmtAgo(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	return `${Math.round(seconds / 86400)}d`;
}

/** Honour the operating system's reduce-motion setting before animating. */
export function prefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
