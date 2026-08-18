import { describe, it, expect } from 'vitest';
import { familyOf, dirOf, siblingScore } from './family';

describe('familyOf — shape is a pure function of the path', () => {
  it('separates api endpoints from every other +server.ts', () => {
    // A build writing an API endpoint must not be shown a page's loader: they
    // share a filename and share nothing else.
    expect(familyOf('src/routes/api/jkai/builds/+server.ts')).toBe('api-endpoint');
    expect(familyOf('src/routes/admin/thing/+server.ts')).toBe('route-endpoint');
    expect(familyOf('src/routes/admin/thing/+page.server.ts')).toBe('page-server');
    expect(familyOf('src/routes/admin/thing/+page.svelte')).toBe('page');
  });

  it('calls a test a test, whatever else it looks like', () => {
    // Ordered before every library rule on purpose. `foo.test.ts` under
    // src/lib matches 'lib-module' too, and showing a build a test when it is
    // writing a module is the most obvious way to get the shape wrong.
    expect(familyOf('src/lib/codegraph/query.test.ts')).toBe('test');
    expect(familyOf('src/lib/workflows/nodes/apple-calendar.test.ts')).toBe('test');
    expect(familyOf('src/lib/codegraph/query.ts')).toBe('lib-module');
  });

  it('splits a workflow node from its definition', () => {
    expect(familyOf('src/lib/workflows/nodes/apple-calendar.def.ts')).toBe('workflow-node-def');
    expect(familyOf('src/lib/workflows/nodes/apple-calendar.ts')).toBe('workflow-node');
    expect(familyOf('src/lib/workflows/site-tools/tools/apple-calendar.ts')).toBe('site-tool');
  });

  it('returns null rather than inventing a catch-all', () => {
    // A file with no family has no siblings. An "other" bucket would make every
    // unclassified file a candidate precedent for every other one.
    expect(familyOf('README.md')).toBeNull();
    expect(familyOf('package.json')).toBeNull();
    expect(familyOf('')).toBeNull();
    expect(familyOf(null)).toBeNull();
    expect(familyOf('../etc/passwd')).toBeNull();
  });
});

describe('siblingScore — what makes one precedent better than another', () => {
  const base = { inDegree: 0, episodes: 0, lessons: 0 };
  const target = 'src/routes/api/jkai/builds/+server.ts';

  it('never offers the file back to itself', () => {
    expect(siblingScore(target, { ...base, path: target })).toBe(-Infinity);
  });

  it('puts the same directory above everything else', () => {
    // Conventions here are local: the endpoints under api/jkai share an auth
    // guard the ones under api/public must not copy. A neighbour with no
    // importers still beats a heavily-imported stranger.
    const neighbour = siblingScore(target, { ...base, path: 'src/routes/api/jkai/builds/other/+server.ts' });
    const sameDir = siblingScore(target, { ...base, path: 'src/routes/api/jkai/builds/+server2.ts' });
    const stranger = siblingScore(target, { ...base, path: 'src/routes/api/public/x/+server.ts', inDegree: 50 });
    expect(sameDir).toBeGreaterThan(stranger);
    expect(sameDir).toBeGreaterThan(neighbour);
  });

  it('prefers a nearer subtree', () => {
    const near = siblingScore(target, { ...base, path: 'src/routes/api/jkai/chat/+server.ts' });
    const far = siblingScore(target, { ...base, path: 'src/routes/api/trails/+server.ts' });
    expect(near).toBeGreaterThan(far);
  });

  it('uses import centrality to break a tie, with diminishing returns', () => {
    const popular = siblingScore(target, { ...base, path: 'src/routes/api/a/+server.ts', inDegree: 30 });
    const leaf = siblingScore(target, { ...base, path: 'src/routes/api/b/+server.ts', inDegree: 0 });
    expect(popular).toBeGreaterThan(leaf);

    // Uncapped, a hub like schema.ts would win every contest it entered.
    const huge = siblingScore(target, { ...base, path: 'src/routes/api/c/+server.ts', inDegree: 4000 });
    expect(huge - popular).toBeLessThan(popular - leaf);
  });

  it('lets recorded history break a tie but never lead', () => {
    const withHistory = siblingScore(target, { path: 'src/routes/api/a/+server.ts', inDegree: 0, episodes: 5, lessons: 5 });
    const nearer = siblingScore(target, { ...base, path: 'src/routes/api/jkai/z/+server.ts' });
    expect(withHistory).toBeGreaterThan(siblingScore(target, { ...base, path: 'src/routes/api/a/+server.ts' }));
    expect(nearer).toBeGreaterThan(withHistory);
  });
});

describe('dirOf', () => {
  it('keeps the trailing slash so prefixes compare cleanly', () => {
    expect(dirOf('src/lib/a.ts')).toBe('src/lib/');
    expect(dirOf('a.ts')).toBe('');
  });
});
