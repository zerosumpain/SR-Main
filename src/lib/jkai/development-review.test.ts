import { describe, expect, it } from 'vitest';
import { criterionResult, acceptanceBlocker, newDelivery } from './development';
import { parseCriterionAssessment, reviewImages, reviewPayload, reviewContent, reviewerLessons, REVIEW_LIMITS } from './development-review.server';
const assessment = { verdict: 'passed' as const, basis: 'inferred' as const, evidence: 'Source implements the choice; browser showed the selected stop.', model: 'fixture', revision: 'candidate', at: 'today' };
it('uses current model inference for unanswered criteria and preserves explicit owner verdicts', () => {
  const c = { id: 'one', text: 'Save a stop', verdict: 'unverified' as const, evidence: '', revision: null, assessment };
  expect(criterionResult(c, 'candidate')).toMatchObject({ verdict: 'passed', source: 'model' });
  expect(criterionResult({ ...c, verdict: 'failed', revision: 'candidate', evidence: 'I saw the wrong stop' }, 'candidate')).toMatchObject({ verdict: 'failed', source: 'owner' });
  expect(criterionResult(c, 'new-candidate').verdict).toBe('unverified');
  const state = newDelivery('Example'); state.brief.acceptedAt = 'today'; state.candidate = 'candidate'; state.criteria = [c];
  state.preview = { status: 'ready', revision: 'candidate', url: 'https://preview.test', detail: '' };
  expect(acceptanceBlocker(state)).toContain('repository gate');
  state.gate = { passed: true, revision: 'candidate', evidence: 'Checked' };
  expect(acceptanceBlocker(state)).toBeNull();
});
it('requires one nonempty, attributed judgement for every requested criterion', () => {
  const c = { id: 'one', verdict: 'passed', basis: 'inferred', evidence: 'The source implements it.' };
  expect(parseCriterionAssessment(JSON.stringify({ criteria: [c] }), ['one'])).toEqual([c]);
  for (const criteria of [[], [c, c], [{ ...c, id: 'invented' }], [{ ...c, evidence: '' }]]) {
    expect(() => parseCriterionAssessment(JSON.stringify({ criteria }), ['one'])).toThrow();
  }
});

describe('reviewer evidence', () => {
  const shot = (width: number) => ({ width, route: '/feature', text: 'Save a stop', mediaType: 'image/jpeg', base64: 'QUJD' });
  const observation = { width: 1440, route: '/feature', text: 'Save a stop', consoleErrors: ['500 at /api/stops', ...Array(20).fill('again')], failedRequests: ['500 POST /api/stops'], outline: '- button "Save"' };

  it('sends screenshots only to a model that reads JPEG images, at most two', () => {
    const shots = [shot(1440), shot(390), shot(800)];
    expect(reviewImages(shots, { image: false })).toEqual([]);
    expect(reviewImages(shots, { image: true })).toHaveLength(2);
    expect(reviewImages(shots, { image: true, nativeMimes: ['image/png'] })).toEqual([]);
    expect(reviewImages([{ ...shot(1440), base64: 'A'.repeat(REVIEW_LIMITS.imageBase64 + 1) }], { image: true })).toEqual([]);
    expect(reviewImages(undefined, { image: true })).toEqual([]);
  });

  it('builds a bounded payload that says what is attached, and image parts only when there are images', () => {
    const inspection = { evidence: Array(30).fill('page text'), observations: [observation], screenshots: [shot(1440)], changes: { files: ['src/a.ts'], patch: '+x' } };
    const lessons = [{ id: 'area-1', origin: 'area' as const, lesson: 'Use HealthShell' }, { id: 'L9', origin: 'codegraph' as const, lesson: 'Unverified note' }];
    const withImages = JSON.parse(reviewPayload({ base: { brief: 'b' }, inspection, images: [shot(1440)], lessons, repositoryGate: { passed: false } }));
    expect(withImages.inspection.evidence).toHaveLength(REVIEW_LIMITS.evidence);
    expect(withImages.inspection.observations[0].consoleErrors).toHaveLength(REVIEW_LIMITS.messages);
    expect(withImages.inspection.observations[0]).toMatchObject({ failedRequests: ['500 POST /api/stops'], outline: '- button "Save"', scenario: 'Save a stop' });
    expect(withImages.inspection.screenshots).toEqual({ attached: [{ image: 1, width: 1440, route: '/feature', scenario: 'Save a stop' }] });
    expect(withImages).toMatchObject({ brief: 'b', houseRules: [lessons[0]], precedents: [lessons[1]], repositoryGate: { passed: false } });
    // Candidate-controlled strings are clipped, and the observation list is bounded in total.
    const flood = JSON.parse(reviewPayload({ base: {}, inspection: { evidence: ['x'.repeat(20_000)],
      observations: Array.from({ length: 24 }, () => ({ ...observation, outline: 'o'.repeat(5000) })) }, images: [], lessons: [], repositoryGate: null }));
    expect(flood.inspection.evidence[0].length).toBe(REVIEW_LIMITS.evidenceChars);
    expect(JSON.stringify(flood.inspection.observations).length).toBeLessThanOrEqual(REVIEW_LIMITS.observationsTotal);
    expect(flood.inspection.observationsOmitted).toMatch(/omitted/);
    const textOnly = JSON.parse(reviewPayload({ base: {}, inspection, images: [], lessons: [], repositoryGate: null }));
    expect(textOnly.inspection.screenshots.note).toMatch(/cannot read images/);
    expect(JSON.parse(reviewPayload({ base: {}, inspection: { evidence: ['x'] }, images: [], lessons: [], repositoryGate: null })).inspection.screenshots.note).toMatch(/No screenshots/);

    expect(reviewContent('payload', [])).toBe('payload');
    const parts = reviewContent('payload', [shot(1440), shot(390)]) as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts.map(p => p.type)).toEqual(['text', 'text', 'image_url', 'text', 'image_url']);
    expect(parts[2].image_url?.url).toBe('data:image/jpeg;base64,QUJD');
    // The worker-written scenario label never travels as a bare text part.
    expect(JSON.stringify(parts.slice(1))).not.toContain('Save a stop');
  });

  it('puts area lessons first, drops the same lesson retrieved by file and bounds the total', () => {
    // One store: an area lesson IS the graph row the file retrieval also finds.
    const area = [{ id: 'development-lesson:7', lesson: 'Never hard-code a model', evidence: 'PR #1' }];
    const files = [
      { id: 'development-lesson:7', title: 'Never hard-code a model', body: 'copy', citedPaths: [] },
      { id: 'L2', title: 'Two writers', body: 'They race on the cache.', citedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'] },
    ];
    const lessons = reviewerLessons(area, files);
    expect(lessons.map(l => [l.id, l.origin])).toEqual([['area-development-lesson:7', 'area'], ['L2', 'codegraph']]);
    expect(lessons[0].lesson).toBe('Never hard-code a model (evidence: PR #1)');
    expect(lessons[1]).toMatchObject({ lesson: 'Two writers: They race on the cache.', paths: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'] });
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `L${i}`, title: '', body: 'y'.repeat(2000), citedPaths: [] }));
    const manyArea = Array.from({ length: 30 }, (_, i) => ({ id: `development-lesson:${i}`, lesson: 'z'.repeat(2000), evidence: 'e' }));
    const bounded = reviewerLessons(manyArea, many);
    expect(bounded.length).toBeLessThanOrEqual(REVIEW_LIMITS.areaLessons + REVIEW_LIMITS.fileLessons);
    expect(bounded.reduce((n, l) => n + l.lesson.length, 0)).toBeLessThanOrEqual(REVIEW_LIMITS.lessonsTotal);
    expect(bounded.every(l => l.lesson.length <= REVIEW_LIMITS.lessonChars)).toBe(true);
  });
});
