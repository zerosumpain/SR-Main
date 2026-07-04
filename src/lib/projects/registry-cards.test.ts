import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATIC_PROJECT_KEYS } from './registry';

// Parity guard: every hardcoded card on /projects renders a `visToggle('<key>', …)`
// public/private control. If that literal key is missing from STATIC_PROJECT_KEYS,
// POST /api/projects/visibility rejects it (400) and the toggle silently fails —
// exactly the bug where scs-earnings and broads-pilot wouldn't toggle. This test
// fails the build if a new card ships without its key registered.
describe('/projects card ↔ registry parity', () => {
  const pagePath = fileURLToPath(new URL('../../routes/projects/+page.svelte', import.meta.url));
  const source = readFileSync(pagePath, 'utf8');

  // Match only string-literal keys: `visToggle('some-key'`. The AI-built card uses
  // `visToggle(project.publishedSlug!, …)` (dynamic) and is intentionally skipped —
  // those keys are validated at runtime against published build slugs.
  // Broad key charset (not just lowercase-kebab) so an uppercase/underscore key
  // can't slip past the guard while the test stays green.
  const literalKeys = [...source.matchAll(/visToggle\('([A-Za-z0-9_-]+)'/g)].map((m) => m[1]);

  it('finds the hardcoded toggle keys in the page', () => {
    // Guards the regex itself: if the card markup is refactored away, this catches it.
    expect(literalKeys.length).toBeGreaterThanOrEqual(8);
  });

  it.each([...new Set(literalKeys)])('registers card key "%s"', (key) => {
    expect(STATIC_PROJECT_KEYS).toContain(key);
  });
});
