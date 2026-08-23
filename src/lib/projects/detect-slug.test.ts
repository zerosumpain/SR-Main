import { describe, it, expect } from 'vitest';
import { detectProjectSlug } from './detect-slug';

// The real file list from PR #416, the change request this exists for.
const PR_416 = [
  '.github/public-routes.txt',
  'src/lib/family-location-history.test.ts',
  'src/lib/family-location-history.ts',
  'src/lib/workflows/homeassistant/service.ts',
  'src/routes/api/family-life360-history/+server.ts',
  'src/routes/projects/family-life360-history/+page.server.ts',
  'src/routes/projects/family-life360-history/+page.svelte',
];

describe('detectProjectSlug', () => {
  it('finds the address a change request added', () => {
    expect(detectProjectSlug(PR_416)).toEqual({
      slug: 'family-life360-history',
      candidates: ['family-life360-history'],
    });
  });

  it('is not fooled by the matching /api route in the same PR', () => {
    // `src/routes/api/family-life360-history/` shares the name but is not a
    // project address; only the /projects route may become a card.
    const apiOnly = PR_416.filter((p) => !p.startsWith('src/routes/projects/'));
    expect(detectProjectSlug(apiOnly)).toBeNull();
  });

  it('returns null for a PR that touches no project route', () => {
    expect(
      detectProjectSlug([
        'src/lib/jkai/prompt.ts',
        'src/lib/builds/published-link.ts',
        'README.md',
      ]),
    ).toBeNull();
  });

  it('offers every address when a PR touches more than one', () => {
    const d = detectProjectSlug([
      'src/routes/projects/tide-times/+page.svelte',
      'src/routes/projects/moon-phase/+page.svelte',
    ]);
    expect(d?.candidates).toEqual(['tide-times', 'moon-phase']);
    expect(d?.slug).toBe('tide-times');
  });

  it('ranks a new page above a loader edited elsewhere', () => {
    const d = detectProjectSlug([
      'src/routes/projects/engine-room/+page.server.ts',
      'src/routes/projects/tide-times/+page.svelte',
    ]);
    expect(d?.slug).toBe('tide-times');
    expect(d?.candidates).toEqual(['tide-times', 'engine-room']);
  });

  it('accepts a loader-only change when nothing else claims that address', () => {
    const d = detectProjectSlug(['src/routes/projects/engine-room/+page.server.ts']);
    expect(d?.slug).toBe('engine-room');
  });

  it('resolves a nested route to its top-level address', () => {
    // `engine-room/turn/routing` is one project as far as visibility is
    // concerned; the key is the first segment.
    const d = detectProjectSlug(['src/routes/projects/engine-room/turn/routing/+page.svelte']);
    expect(d?.slug).toBe('engine-room');
  });

  it('ignores a param segment, which cannot be a visibility key', () => {
    expect(detectProjectSlug(['src/routes/projects/[slug]/+page.svelte'])).toBeNull();
  });

  it('ignores the projects index itself', () => {
    expect(
      detectProjectSlug(['src/routes/projects/+page.svelte', 'src/routes/projects/+page.server.ts']),
    ).toBeNull();
  });

  it('survives junk in the list', () => {
    expect(detectProjectSlug([])).toBeNull();
    expect(detectProjectSlug(['', '   ', 'src/routes/projects/'])).toBeNull();
  });
});
