import { extractLocal } from './extract-local';
import { extract as tavilyExtract } from './tavily';

export interface ExtractedContent {
	content: string;
	method: 'local' | 'tavily' | 'snippet';
}

/**
 * Hybrid content extraction: try local Readability first, fall back to Tavily.
 * Returns the best available content for a URL, or the original snippet if both fail.
 */
export async function extractContent(
	url: string,
	snippet: string,
	signal?: AbortSignal,
): Promise<ExtractedContent> {
	// Try local extraction first
	const local = await extractLocal(url, signal);
	if (local && local.content.length >= 200) {
		return { content: local.content, method: 'local' };
	}

	// Fall back to Tavily
	try {
		const extracted = await tavilyExtract([url], signal);
		if (extracted.results?.[0]?.raw_content) {
			return { content: extracted.results[0].raw_content, method: 'tavily' };
		}
	} catch {
		// Both failed — use snippet
	}

	return { content: snippet, method: 'snippet' };
}
