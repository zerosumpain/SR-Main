export type ActivityKind = 'indoor' | 'outdoor' | 'mixed';

export interface TimeWindow {
	start: string;
	end: string;
}

export interface OpeningHours {
	weekday: number;
	windows: TimeWindow[];
}

export interface ActivityListing {
	id: string;
	title: string;
	venue: string;
	kind: ActivityKind;
	minimumAge?: number;
	maximumAge?: number;
	date?: string;
	startsAt?: string;
	endsAt?: string;
	distanceKm?: number;
	tags: string[];
	openingHours?: OpeningHours[];
	listingConfidence?: number;
	url?: string;
}

export interface WeatherForecast {
	precipitationProbability: number;
	precipitationMm?: number;
}

export interface BookingEvidence {
	activityId: string;
	confirmed: boolean;
	source: string;
	url?: string;
}

export interface PriorActivity {
	activityId: string;
	date: string;
}

export interface PlannerInput {
	targetDate: string;
	weather: WeatherForecast;
	activities: ActivityListing[];
	familyAges: number[];
	preferredTags: string[];
	availableWindows?: TimeWindow[];
	priorActivities?: PriorActivity[];
	bookingEvidence?: BookingEvidence[];
}

export interface RankedSuggestion {
	activity: ActivityListing;
	score: number;
	reasons: string[];
	bookingEvidence: BookingEvidence[];
}

export interface RejectedActivity {
	activity: ActivityListing;
	reason: string;
}

export interface PlanningResult {
	suggestions: RankedSuggestion[];
	rejected: RejectedActivity[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function weekday(date: string): number {
	return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function minutes(time: string): number | undefined {
	const match = /^(\d{2}):(\d{2})$/.exec(time);
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) return undefined;
	return hour * 60 + minute;
}

function overlaps(left: TimeWindow, right: TimeWindow): boolean {
	const leftStart = minutes(left.start);
	const leftEnd = minutes(left.end);
	const rightStart = minutes(right.start);
	const rightEnd = minutes(right.end);
	return leftStart !== undefined && leftEnd !== undefined && rightStart !== undefined && rightEnd !== undefined && leftStart < rightEnd && rightStart < leftEnd;
}

function activityWindow(activity: ActivityListing): TimeWindow | undefined {
	if (!activity.startsAt) return undefined;
	return { start: activity.startsAt, end: activity.endsAt ?? '23:59' };
}

function isOpenAndAvailable(activity: ActivityListing, targetDate: string, availability: TimeWindow[] | undefined): boolean | undefined {
	if (!activity.openingHours) return undefined;
	const hours = activity.openingHours.find((entry) => entry.weekday === weekday(targetDate));
	if (!hours || hours.windows.length === 0) return false;
	const scheduled = activityWindow(activity);
	const usableWindows = availability ?? [{ start: '00:00', end: '23:59' }];
	return hours.windows.some((open) => usableWindows.some((available) => overlaps(open, available) && (!scheduled || overlaps(open, scheduled) && overlaps(available, scheduled))));
}

function daysBetween(from: string, to: string): number | undefined {
	const fromMs = Date.parse(`${from}T00:00:00Z`);
	const toMs = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return undefined;
	return Math.floor((toMs - fromMs) / DAY_MS);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** Ranks already-normalised listings; callers own all network and database access. */
export function rankNextDayActivities(input: PlannerInput): PlanningResult {
	const preferredTags = new Set(input.preferredTags.map((tag) => tag.toLowerCase()));
	const evidenceByActivity = new Map<string, BookingEvidence[]>();
	for (const evidence of input.bookingEvidence ?? []) {
		const current = evidenceByActivity.get(evidence.activityId) ?? [];
		current.push(evidence);
		evidenceByActivity.set(evidence.activityId, current);
	}

	const suggestions: RankedSuggestion[] = [];
	const rejected: RejectedActivity[] = [];
	const wet = clamp(input.weather.precipitationProbability, 0, 100) >= 40;

	for (const activity of input.activities) {
		if (activity.date && activity.date !== input.targetDate) {
			rejected.push({ activity, reason: 'Not listed for the target day.' });
			continue;
		}
		if (input.familyAges.some((age) => (activity.minimumAge !== undefined && age < activity.minimumAge) || (activity.maximumAge !== undefined && age > activity.maximumAge))) {
			rejected.push({ activity, reason: 'Does not suit every supplied family age.' });
			continue;
		}
		const open = isOpenAndAvailable(activity, input.targetDate, input.availableWindows);
		if (open === false) {
			rejected.push({ activity, reason: 'Closed or outside the supplied available hours.' });
			continue;
		}

		let score = 20;
		const reasons: string[] = [];
		if (wet && activity.kind === 'indoor') {
			score += 30;
			reasons.push('Indoor option is well suited to the wet forecast.');
		} else if (wet && activity.kind === 'mixed') {
			score += 10;
			reasons.push('Has indoor cover for the wet forecast.');
		} else if (wet && activity.kind === 'outdoor') {
			score -= 30;
			reasons.push('Outdoor activity is less suitable for the wet forecast.');
		}
		if (open === true) {
			score += 12;
			reasons.push('Opening hours overlap with family availability.');
		} else {
			score -= 6;
			reasons.push('Opening hours were not supplied.');
		}
		if (activity.distanceKm !== undefined) {
			const distanceScore = Math.max(0, 20 - activity.distanceKm * 1.5);
			score += distanceScore;
			reasons.push(`${activity.distanceKm.toFixed(1)} km away.`);
		}
		const matchedTags = activity.tags.filter((tag) => preferredTags.has(tag.toLowerCase()));
		if (matchedTags.length > 0) {
			score += Math.min(16, matchedTags.length * 8);
			reasons.push(`Matches preferences: ${matchedTags.join(', ')}.`);
		}
		const recentVisits = (input.priorActivities ?? []).filter((prior) => prior.activityId === activity.id && (daysBetween(prior.date, input.targetDate) ?? Infinity) >= 0 && (daysBetween(prior.date, input.targetDate) ?? Infinity) <= 28).length;
		if (recentVisits > 0) {
			score -= Math.min(21, recentVisits * 7);
			reasons.push(`Visited ${recentVisits} time${recentVisits === 1 ? '' : 's'} in the last 28 days.`);
		}
		const evidence = evidenceByActivity.get(activity.id) ?? [];
		if (evidence.some((item) => item.confirmed)) {
			score += 25;
			reasons.push('Confirmed booking evidence found.');
		} else if (evidence.length > 0) {
			score += 4;
			reasons.push('Possible booking evidence found; confirmation is still needed.');
		}
		const confidence = activity.listingConfidence ?? 0.5;
		score += clamp(confidence, 0, 1) * 10;
		suggestions.push({ activity, score: Math.round(score * 10) / 10, reasons, bookingEvidence: evidence });
	}

	suggestions.sort((a, b) => b.score - a.score || a.activity.title.localeCompare(b.activity.title));
	return { suggestions, rejected };
}
