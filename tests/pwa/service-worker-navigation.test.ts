import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync(join(process.cwd(), 'src/service-worker.ts'), 'utf8');

describe('JKAI service-worker navigation policy', () => {
	it('does not cache authenticated JKAI navigation responses', () => {
		const sw = source();
		expect(sw).not.toContain("cacheName: 'jkai-navigation'");
		expect(sw).not.toMatch(/url\.pathname\.startsWith\(['"]\/jkai['"]\)/);
	});

	it('purges the legacy navigation cache and claims open clients on activation', () => {
		const sw = source();
		expect(sw).toContain("self.caches.delete('jkai-navigation')");
		expect(sw).toContain('clientsClaim()');
	});
});

describe('local type-check memory parity', () => {
	it('uses the same 8 GB heap as the CI type-check gate', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts.check).toContain('NODE_OPTIONS=--max-old-space-size=8192');
		expect(pkg.scripts['gate:check:only']).toContain('NODE_OPTIONS=--max-old-space-size=8192');
	});
});
