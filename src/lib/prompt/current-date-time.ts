export type PromptMessage = {
	role: string;
	content: string;
	[key: string]: unknown;
};

export type CurrentDateTimeOptions = {
	now?: Date;
	timeZone?: string;
};

const CONTEXT_START = '<current-date-time>';
const CONTEXT_END = '</current-date-time>';
const contextPattern = /\n*<current-date-time>[\s\S]*?<\/current-date-time>/g;

function createDateTimeContext(now: Date, timeZone: string): string {
	if (Number.isNaN(now.getTime())) {
		throw new TypeError('now must be a valid Date');
	}

	const localDateTime = new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'full',
		timeStyle: 'long',
		timeZone
	}).format(now);

	return `${CONTEXT_START}\nThe current date and time is ${localDateTime}.\nCanonical timestamp: ${now.toISOString()}.\n${CONTEXT_END}`;
}

/**
 * Adds a freshly generated date/time context to each system message.
 * If a prompt has no system message, one is prepended.
 */
export function injectCurrentDateTime(
	messages: readonly PromptMessage[],
	options: CurrentDateTimeOptions = {}
): PromptMessage[] {
	const now = options.now ?? new Date();
	const timeZone = options.timeZone ?? 'UTC';
	const context = createDateTimeContext(now, timeZone);
	let hasSystemMessage = false;

	const injectedMessages = messages.map((message) => {
		if (message.role !== 'system') {
			return { ...message };
		}

		hasSystemMessage = true;
		const existingContent = message.content.replace(contextPattern, '').trimEnd();
		return {
			...message,
			content: existingContent === '' ? context : `${existingContent}\n\n${context}`
		};
	});

	return hasSystemMessage
		? injectedMessages
		: [{ role: 'system', content: context }, ...injectedMessages];
}
