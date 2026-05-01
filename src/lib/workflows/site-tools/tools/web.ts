import { register } from '../registry-internal';
import { fetchUrlContent, isUrlFetchError } from '$lib/jkai/extract/url';

register({
	name: 'fetch_url',
	description:
		'Fetch a public web URL and return its readable text content. Use this when the user shares a link you have not already been given the contents of, or when you need to look up information on a page you have referenced. ' +
		'Public-internet HTTP/HTTPS only — refuses localhost, private/internal networks. HTML and plain-text pages only (no PDFs — use the files toolset for those).',
	parameters: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'The full URL to fetch, including scheme (http:// or https://).',
			},
		},
		required: ['url'],
	},
	category: 'Web',
	toolset: 'web',
	handler: async (args) => {
		const url = (args.url as string | undefined)?.trim();
		if (!url) return { success: false, error: 'url is required' };
		try {
			const result = await fetchUrlContent(url);
			return {
				success: true,
				data: {
					url: result.url,
					finalUrl: result.finalUrl,
					title: result.title,
					content: result.content,
					truncated: result.truncated,
					contentType: result.contentType,
					length: result.content.length,
				},
			};
		} catch (err) {
			if (isUrlFetchError(err)) {
				return { success: false, error: err.message, data: { kind: err.kind } };
			}
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Fetch failed',
			};
		}
	},
});
