import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A container name is a DNS label: 63 characters at most. The batch trial's
// database was `sr-preview-batch-<uuid>-<hex>-db` (65), never resolved, and
// every batch integration failed at "schema push" (29915e85, 2026-10-01).
// Containers must address each other by the short aliases, not by name.
const broker = readFileSync(join(process.cwd(), 'scripts/development-workspace-broker.mjs'), 'utf8');

describe('preview containers address each other by short aliases', () => {
  it('connects to the database and the app through aliases', () => {
    expect(broker).toMatch(/DATABASE_URL=postgresql:\/\/preview:\$\{credentials\}@\$\{PREVIEW_DB_HOST\}:5432/);
    expect(broker).toMatch(/PREVIEW_UPSTREAM=\$\{PREVIEW_APP_HOST\}/);
    expect(broker).not.toMatch(/@\$\{dbName\}/);
  });

  it('keeps the aliases valid DNS labels the ingress accepts', () => {
    const hosts = [...broker.matchAll(/const PREVIEW_(?:DB|APP)_HOST = '([^']+)'/g)].map((m) => m[1]);
    expect(hosts).toHaveLength(2);
    for (const host of hosts) {
      expect(host.length).toBeLessThanOrEqual(63);
      expect(host).toMatch(/^sr-preview-[a-zA-Z0-9-]+$/);
    }
  });

  it('would have failed for the name it replaced', () => {
    const batchDb = `sr-preview-batch-${'29915e85-7697-40f6-a9f8-dc0f95fefc79'}-${'b1685331'}-db`;
    expect(batchDb.length).toBeGreaterThan(63);
  });
});
