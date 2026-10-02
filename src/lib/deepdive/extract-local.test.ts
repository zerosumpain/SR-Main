import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractLocal } from './extract-local';

afterEach(() => vi.restoreAllMocks());

describe('extractLocal', () => {
	it('refuses loopback, private and metadata addresses without fetching them', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		for (const url of ['http://127.0.0.1:5432/', 'http://10.0.0.5/admin', 'http://169.254.169.254/latest/meta-data/']) {
			expect(await extractLocal(url)).toBeNull();
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("surfaces the caller's abort as an AbortError", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(extractLocal('https://example.com/', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
	});
});
