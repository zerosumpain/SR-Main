export const CARMEL_COLLEGE_TERM_DATES_URL =
	'https://www.carmelcollege.co.uk/term-dates/';

const OFFICIAL_HOSTS = new Set(['carmelcollege.co.uk', 'www.carmelcollege.co.uk']);
const MONTHS: Record<string, number> = {
	january: 0,
	february: 1,
	march: 2,
	april: 3,
	may: 4,
	june: 5,
	july: 6,
	august: 7,
	september: 8,
	october: 9,
	november: 10,
	december: 11
};
const MONTH_PATTERN = Object.keys(MONTHS).join('|');
const WEEKDAY_PATTERN = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const DATE_PATTERN = `(?:(?:${WEEKDAY_PATTERN})\\s*,?\\s*)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_PATTERN})(?:\\s+\\d{4})?`;
const RANGE_PATTERN = new RegExp(
	`(${DATE_PATTERN})\\s*(?:–|—|-|\\bto\\b)\\s*(${DATE_PATTERN})`,
	'gi'
);

export interface CarmelCollegeCalendarEvent {
	/** Stable identifier derived from the published term range. */
	id: string;
	title: string;
	/** ISO local date, inclusive. */
	startDate: string;
	/** ISO local date, exclusive, suitable for iCalendar-style all-day events. */
	endDate: string;
	allDay: true;
	sourceUrl: string;
}

export interface CarmelCollegeTermCalendar {
	schoolName: 'Carmel College, Darlington';
	sourceUrl: string;
	fetchedAt: string;
	events: CarmelCollegeCalendarEvent[];
}

export interface TermDatesHttpResponse {
	ok: boolean;
	status: number;
	url: string;
	text(): Promise<string>;
}

export type TermDatesFetch = (
	url: string,
	init?: { headers?: Record<string, string> }
) => Promise<TermDatesHttpResponse>;

export class CarmelCollegeSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CarmelCollegeSourceError';
	}
}

/**
 * Confirms that a fetched document is still hosted by Carmel College and names
 * the school and its Darlington location. This deliberately does not trust a
 * search result, GIAS record, or a redirect to a third-party calendar host.
 */
export function isOfficialCarmelCollegeTermPage(url: string, html: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== 'https:' || !OFFICIAL_HOSTS.has(parsed.hostname.toLowerCase())) {
		return false;
	}

	const text = htmlToText(html).toLowerCase();
	return text.includes('carmel college') && text.includes('darlington');
}

/** Extracts published term date ranges into normalised, all-day calendar events. */
export function extractCarmelCollegeTermEvents(
	html: string,
	sourceUrl: string
): CarmelCollegeCalendarEvent[] {
	const text = htmlToText(html);
	const events: CarmelCollegeCalendarEvent[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(RANGE_PATTERN)) {
		const startRaw = match[1];
		const endRaw = match[2];
		if (!startRaw || !endRaw || match.index === undefined) continue;

		const range = parseRange(startRaw, endRaw);
		if (!range || range.end.getTime() < range.start.getTime()) continue;

		const title = findTermLabel(text, match.index);
		const startDate = formatDate(range.start);
		const endDate = formatDate(addDays(range.end, 1));
		const id = `carmel-college-${startDate}-${endDate}`;
		if (seen.has(id)) continue;
		seen.add(id);

		events.push({
			id,
			title,
			startDate,
			endDate,
			allDay: true,
			sourceUrl
		});
	}

	return events.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function fetchCarmelCollegeTermCalendar(options: {
	fetch: TermDatesFetch;
	now?: () => Date;
	url?: string;
}): Promise<CarmelCollegeTermCalendar> {
	const sourceUrl = options.url ?? CARMEL_COLLEGE_TERM_DATES_URL;
	const response = await options.fetch(sourceUrl, {
		headers: { accept: 'text/html,application/xhtml+xml' }
	});

	if (!response.ok) {
		throw new CarmelCollegeSourceError(
			`Carmel College term-date page returned HTTP ${response.status}`
		);
	}

	const html = await response.text();
	if (!isOfficialCarmelCollegeTermPage(response.url, html)) {
		throw new CarmelCollegeSourceError(
			'Carmel College term-date page failed official-school verification'
		);
	}

	const events = extractCarmelCollegeTermEvents(html, response.url);
	if (events.length === 0) {
		throw new CarmelCollegeSourceError(
			'Carmel College term-date page contained no complete dated ranges'
		);
	}

	return {
		schoolName: 'Carmel College, Darlington',
		sourceUrl: response.url,
		fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
		events
	};
}

function htmlToText(html: string): string {
	return html
		.replace(/<script[\\s\\S]*?<\\/script>|<style[\\s\\S]*?<\\/style>/gi, ' ')
		.replace(/<\\/(?:p|div|li|tr|h[1-6]|br|section|article)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&ndash;|&#8211;/gi, '–')
		.replace(/&mdash;|&#8212;/gi, '—')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&[a-z]+;|&#\d+;/gi, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.trim();
}

function parseRange(startRaw: string, endRaw: string): { start: Date; end: Date } | undefined {
	const startParts = parseDateParts(startRaw);
	const endParts = parseDateParts(endRaw);
	if (!startParts || !endParts) return undefined;

	let startYear = startParts.year;
	let endYear = endParts.year;
	if (startYear === undefined && endYear === undefined) return undefined;
	if (startYear === undefined) {
		startYear = endYear! - (startParts.month > endParts.month ? 1 : 0);
	}
	if (endYear === undefined) {
		endYear = startYear + (endParts.month < startParts.month ? 1 : 0);
	}

	const start = new Date(Date.UTC(startYear, startParts.month, startParts.day));
	const end = new Date(Date.UTC(endYear, endParts.month, endParts.day));
	if (start.getUTCMonth() !== startParts.month || end.getUTCMonth() !== endParts.month) return undefined;
	return { start, end };
}

function parseDateParts(value: string): { day: number; month: number; year?: number } | undefined {
	const match = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?`, 'i').exec(value);
	if (!match) return undefined;
	const day = Number(match[1]);
	const month = MONTHS[match[2].toLowerCase()];
	const year = match[3] ? Number(match[3]) : undefined;
	if (!Number.isInteger(day) || day < 1 || day > 31 || month === undefined) return undefined;
	return { day, month, year };
}

function findTermLabel(text: string, rangeStart: number): string {
	const preceding = text.slice(Math.max(0, rangeStart - 500), rangeStart);
	const lines = preceding.split('\n').map((line) => line.trim()).filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (/\\b(?:autumn|spring|summer|term)\\b/i.test(lines[index])) {
			return lines[index].replace(/\s+/g, ' ').slice(0, 120);
		}
	}
	return 'Carmel College term dates';
}

function addDays(date: Date, days: number): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
