import { describe, expect, it } from 'vitest';
import { resolvePublishSlug } from './publish-slug';
import { isStaticProjectKey } from '$lib/projects/visibility';

const build = (title: string | null) => ({ id: 'abcdef1234567890', title });

describe('resolvePublishSlug', () => {
  it('derives the slug from the title, else the id', () => {
    expect(resolvePublishSlug(build('Simple Calculator'), '', isStaticProjectKey)).toEqual({ ok: true, slug: 'simple-calculator' });
    expect(resolvePublishSlug(build(null), '', isStaticProjectKey)).toEqual({ ok: true, slug: 'abcdef12' });
  });

  it('keeps an explicit slug, so a rewrite can replace its own page', () => {
    expect(resolvePublishSlug(build('Other'), 'Simple Calculator', isStaticProjectKey)).toEqual({ ok: true, slug: 'simple-calculator' });
  });

  // publishBuild empties the destination and rsyncs it with --delete, so a
  // build landing on a static key would wipe a hand-deployed bundle (every
  // Hometowns engine-hash folder at once).
  it('moves a title that derives a static key beside it', () => {
    expect(resolvePublishSlug(build('Hometowns'), '', isStaticProjectKey)).toEqual({ ok: true, slug: 'hometowns-abcdef' });
    expect(resolvePublishSlug(build('Marbler'), '', isStaticProjectKey)).toEqual({ ok: true, slug: 'marbler-abcdef' });
  });

  it('refuses an explicit static key', () => {
    const r = resolvePublishSlug(build('Anything'), 'hometowns', isStaticProjectKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('hand-deployed');
  });
});
