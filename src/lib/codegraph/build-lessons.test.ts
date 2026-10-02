import { describe, expect, it } from 'vitest';
import { buildLessonRow, readBuildLesson, UNVERIFIED_MARK } from './build-lessons';

describe('build lessons in the graph', () => {
  const at = new Date('2026-10-01T09:00:00.000Z');
  const row = buildLessonRow({ key: 'k1', buildId: 'b1', lesson: 'Owner gates go first', evidence: 'Broke in src/lib/server/owner.ts\nsecond line', revision: 'abc', files: ['src/routes/x/+page.server.ts'], at });

  it('writes an unverified build-origin lesson that cites the evidence paths and the changed files', () => {
    expect(row).toMatchObject({ id: 'development-lesson:k1', slug: 'development-lesson:k1', origin: 'build', originRef: '/jkai/develop/b1', observedAt: at, repo: 'SR-Main' });
    expect(row.body.endsWith(UNVERIFIED_MARK)).toBe(true);
    expect(row.citedPaths).toEqual(['src/lib/server/owner.ts', 'src/routes/x/+page.server.ts']);
  });

  it('reads back the lesson, its evidence, its candidate and its flags', () => {
    const read = readBuildLesson({ ...row, createdAt: at, staleAt: new Date() });
    expect(read).toMatchObject({ lesson: 'Owner gates go first', evidence: 'Broke in src/lib/server/owner.ts\nsecond line', revision: 'abc', unverified: true, stale: true });
    expect(read.expiresAt).toBe('2026-12-30T09:00:00.000Z');
  });
});
