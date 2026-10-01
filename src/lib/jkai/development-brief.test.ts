import { describe, expect, it } from 'vitest';
import {
  BRIEF_GRACE_MS, acknowledgementKeys, autopilotBriefDecision, briefAcceptanceBlocker, briefLane, criterionFindings, lintBrief,
  parseCriteriaJudgement, parseLane, routeExists, routeOwner,
} from './development-brief';
import { parseDevelopmentProposal } from './development-grooming.server';
import { newDelivery } from './development';
import type { BriefLint } from '$lib/constants/development';

// Patterns in the shape the deployed codegraph snapshot stores them.
const MANIFEST = ['/', '/blog', '/blog/[slug]', '/jkai/develop', '/jkai/develop/[id]', '/projects', '/projects/[slug]/[...path]', '/home/people', '/news', '/news/[[topic]]'];
const clean = { outcome: 'Show weekly reading streaks on the blog index', criteria: ['The /blog page shows a streak count above the post list'], routes: ['/blog'] };

describe('lane', () => {
  it('reads the model lane leniently and refuses anything that is not one of the three', () => {
    expect(parseLane({ lane: 'studio', reason: 'A standalone toy.\nSecond line' })).toEqual({ lane: 'studio', reason: 'A standalone toy.' });
    expect(parseLane({ lane: 'other-repo', reason: 'x', repo: 'zerosumpain/marble-run' })?.repo).toBe('zerosumpain/marble-run');
    expect(parseLane({ lane: 'sandbox', reason: 'x' })).toBeUndefined();
    expect(parseLane('site')).toBeUndefined();
    expect(parseLane(undefined)).toBeUndefined();
  });

  it('knows which repository serves a path, honouring the registry exclusions', () => {
    expect(routeOwner('/health/sleep')?.repo).toBe('zerosumpain/SR-Health');
    expect(routeOwner('/drive')?.repo).toBe('zerosumpain/SR-Drive');
    // /jkai belongs to SR-Jkai-Core except what Main still serves.
    expect(routeOwner('/jkai/develop/abc')).toBeNull();
    expect(routeOwner('/jkai/canvas')?.repo).toBe('zerosumpain/SR-Workflows');
    expect(routeOwner('/healthy-eating')).toBeNull();
    expect(routeOwner('/blog')).toBeNull();
  });

  it('sends the sausage generator to the Marble Run repo, whatever the model said', () => {
    // The 2026-09-25 case: groomed into /marble-run and accepted in four minutes.
    const lane = briefLane({ outcome: 'A random sausage generator', criteria: ['Pressing Generate shows a sausage'], routes: ['/marble-run'], lane: { lane: 'site', reason: 'It is a page' } });
    expect(lane).toMatchObject({ lane: 'other-repo', repo: 'zerosumpain/marble-run', source: 'rule' });
    expect(briefLane({ outcome: 'Add a new level to the marble run', criteria: ['x'], routes: [] }).lane).toBe('other-repo');
  });

  it('takes the model lane when no rule applies, and says so when nothing checked it', () => {
    expect(briefLane({ ...clean, lane: { lane: 'studio', reason: 'Standalone explainer' } })).toMatchObject({ lane: 'studio', source: 'grooming' });
    expect(briefLane(clean)).toMatchObject({ lane: 'site', source: 'unchecked' });
  });

  it('carries the lane and new routes through the grooming proposal', () => {
    const base = { summary: 's', outcome: 'o', constraints: [], scope: [], dependencies: [], assumptions: [], questions: [], validation: ['v'], criteria: ['c'], routes: ['/blog'] };
    const groomed = parseDevelopmentProposal(JSON.stringify({ ...base, newRoutes: ['/blog/streaks'], lane: { lane: 'site', reason: 'Reads posts from Postgres' } }), 'm');
    expect(groomed.brief.lane).toEqual({ lane: 'site', reason: 'Reads posts from Postgres' });
    expect(groomed.brief.newRoutes).toEqual(['/blog/streaks']);
    // A malformed lane or new-route list is dropped, not a failed proposal.
    const lenient = parseDevelopmentProposal(JSON.stringify({ ...base, newRoutes: ['https://x'], lane: 'site' }), 'm');
    expect(lenient.brief.lane).toBeUndefined();
    expect(lenient.brief.newRoutes).toEqual([]);
  });
});

describe('routes', () => {
  it('matches concrete paths and parameter shapes against SvelteKit patterns', () => {
    expect(routeExists('/blog/my-post', MANIFEST)).toBe(true);
    expect(routeExists('/blog/[id]', MANIFEST)).toBe(true);
    expect(routeExists('/blog/:slug', MANIFEST)).toBe(true);
    expect(routeExists('/news', MANIFEST)).toBe(true);
    expect(routeExists('/news/politics', MANIFEST)).toBe(true);
    expect(routeExists('/projects/x/a/b', MANIFEST)).toBe(true);
    expect(routeExists('/jkai/develop/', MANIFEST)).toBe(true);
    expect(routeExists('/blog/a/b', MANIFEST)).toBe(false);
    expect(routeExists('/sausages', MANIFEST)).toBe(false);
  });

  it('blocks a target route that does not exist unless it is proposed as new', () => {
    const missing = lintBrief({ ...clean, routes: ['/blog/streaks/history'] }, MANIFEST, 2);
    expect(missing.findings).toContainEqual(expect.objectContaining({ kind: 'route', severity: 'block', subject: '/blog/streaks/history' }));
    const proposed = lintBrief({ ...clean, routes: ['/blog/streaks/history'], newRoutes: ['/blog/streaks/history'] }, MANIFEST, 2);
    expect(proposed.findings.filter(f => f.kind === 'route')).toEqual([]);
  });

  it('warns when a "new" route already exists, and leaves routes unchecked without a manifest', () => {
    expect(lintBrief({ ...clean, newRoutes: ['/news'] }, MANIFEST, 1).findings).toContainEqual(expect.objectContaining({ subject: '/news', severity: 'warn' }));
    const blind = lintBrief({ ...clean, routes: ['/anything'] }, null, 1);
    expect(blind.routesChecked).toBe(false);
    expect(blind.findings.filter(f => f.kind === 'route')).toEqual([]);
  });
});

describe('criteria', () => {
  it('passes a criterion that names a page and a visible result', () => {
    expect(criterionFindings('The /blog page shows a streak count above the post list')).toEqual([]);
    expect(criterionFindings('Clicking Save keeps the comparison after a reload')).toEqual([]);
  });

  it('blocks judgements, and fragments too short to check', () => {
    expect(criterionFindings('The page is intuitive and user-friendly')[0]).toMatchObject({ kind: 'criterion', severity: 'block' });
    expect(criterionFindings('Fast')[0]).toMatchObject({ severity: 'block' });
    // A judgement word beside something observable is fine.
    expect(criterionFindings('The table renders properly at phone width with no horizontal scroll')).toEqual([]);
  });

  it('blocks criteria the synthetic preview cannot satisfy, unless they ask for sample data', () => {
    expect(criterionFindings('Shows my real steps from WHOOP for today')[0]).toMatchObject({ kind: 'preview', severity: 'block' });
    expect(criterionFindings('Sends an email to the owner when the form is submitted')[0]).toMatchObject({ kind: 'preview', severity: 'block' });
    expect(criterionFindings('The page loads with production data on strangeramblings.com')[0]).toMatchObject({ kind: 'preview', severity: 'block' });
    expect(criterionFindings('Shows the WHOOP recovery card filled from labelled sample data')).toEqual([]);
    expect(criterionFindings('The Life360 panel shows the last reading time')[0]).toMatchObject({ kind: 'preview', severity: 'warn' });
  });

  it('reads the model pass, ignoring anything it cannot attach to a criterion', () => {
    const criteria = ['A', 'B'];
    expect(parseCriteriaJudgement('```json\n{"criteria":[{"index":0,"checkable":true},{"index":1,"checkable":false,"reason":"Taste"}]}\n```', criteria))
      .toEqual([{ kind: 'criterion', severity: 'block', subject: 'B', message: 'Taste', source: 'model' }]);
    expect(parseCriteriaJudgement('{"criteria":[{"index":7,"checkable":false}]}', criteria)).toEqual([]);
    expect(parseCriteriaJudgement('not json', criteria)).toEqual([]);
  });
});

describe('acceptance', () => {
  it('needs an explicit lane override for anything that is not the site, separately from the lint override', () => {
    const studio = lintBrief({ ...clean, lane: { lane: 'studio', reason: 'A standalone explainer.' } }, MANIFEST, 1);
    const seen = acknowledgementKeys(studio);
    expect(briefAcceptanceBlocker(studio)).toMatch(/Studio lane/);
    expect(briefAcceptanceBlocker(studio, { lint: true, acknowledged: seen })).toMatch(/Studio lane/);
    expect(briefAcceptanceBlocker(studio, { lane: true, acknowledged: seen })).toBeNull();
    const vague = lintBrief({ ...clean, criteria: ['It looks nice'] }, MANIFEST, 1);
    expect(briefAcceptanceBlocker(vague)).toMatch(/1 problem/);
    expect(briefAcceptanceBlocker(vague, { lane: true, acknowledged: acknowledgementKeys(vague) })).toMatch(/1 problem/);
    expect(briefAcceptanceBlocker(vague, { lint: true, acknowledged: acknowledgementKeys(vague) })).toBeNull();
    expect(briefAcceptanceBlocker(lintBrief(clean, MANIFEST, 1))).toBeNull();
  });

  it('binds an override to the findings the owner saw', () => {
    const before = lintBrief({ ...clean, criteria: ['It looks nice'] }, MANIFEST, 1);
    const seen = acknowledgementKeys(before);
    // An edit that adds a second problem is not covered by the old tick.
    const after = lintBrief({ ...clean, criteria: ['It looks nice'], routes: ['/sausages'] }, MANIFEST, 2);
    expect(briefAcceptanceBlocker(after, { lint: true, acknowledged: seen })).toMatch(/1 new problem.*does not exist/);
    // A tick with no acknowledged set covers nothing.
    expect(briefAcceptanceBlocker(before, { lint: true })).toMatch(/new problem/);
    // Nor does a lane confirmation carry over to a different lane.
    const studio = lintBrief({ ...clean, lane: { lane: 'studio', reason: 'x' } }, MANIFEST, 1);
    const marble = lintBrief({ ...clean, routes: ['/marble-run'] }, MANIFEST, 2);
    expect(briefAcceptanceBlocker(marble, { lane: true, acknowledged: acknowledgementKeys(studio) })).toMatch(/changed since you confirmed/);
  });
});

describe('autopilot on an unaccepted brief', () => {
  const NOW = Date.parse('2026-10-01T12:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const LONG = BRIEF_GRACE_MS + 1;
  const draft = (lint?: Partial<BriefLint>, extra: { questions?: string; by?: 'owner' | 'autopilot'; groomedAgo?: number } = {}) => {
    const state = newDelivery(clean.outcome, 'Public site', clean.criteria, { autopilot: true });
    state.autopilot!.startedAt = ago(LONG);
    state.brief.routes = clean.routes;
    state.brief.questions = extra.questions ?? '';
    state.grooming = { model: 'm', at: ago(extra.groomedAgo ?? LONG), summary: 's', by: extra.by ?? 'owner' };
    if (lint) {
      const base = lintBrief({ ...clean, lane: { lane: 'site', reason: 'Reads site data' } }, MANIFEST, state.brief.revision, ago(extra.groomedAgo ?? LONG));
      state.brief.lint = { ...base, judged: { key: 'k', model: 'judge' }, by: extra.by ?? 'owner', ...lint };
    }
    return state;
  };

  it('grooms a brief nobody has groomed, but not inside the grace period after commission', () => {
    const state = newDelivery('A thing', 'Public site', [], { autopilot: true });
    state.autopilot!.startedAt = ago(60_000);
    // The owner's page grooms on mount; racing it would make the brief look like autopilot's own.
    expect(autopilotBriefDecision(state, NOW)).toEqual({ action: 'wait' });
    state.autopilot!.startedAt = ago(LONG);
    expect(autopilotBriefDecision(state, NOW)).toEqual({ action: 'groom' });
  });

  it('leaves an owner-touched brief alone for the grace period, but not its own writes', () => {
    expect(autopilotBriefDecision(draft({}, { groomedAgo: 60_000 }), NOW)).toEqual({ action: 'wait' });
    expect(autopilotBriefDecision(draft({}, { groomedAgo: 60_000, by: 'autopilot' }), NOW)).toEqual({ action: 'accept' });
    // Autopilot's own re-check of an old owner grooming does not restart the clock.
    const rechecked = draft({ by: 'autopilot', at: ago(1000) });
    expect(autopilotBriefDecision(rechecked, NOW)).toEqual({ action: 'accept' });
    // An owner's failed Accept does.
    expect(autopilotBriefDecision(draft({ by: 'owner', at: ago(1000) }), NOW)).toEqual({ action: 'wait' });
  });

  it('checks a brief whose check is missing or older than the brief', () => {
    expect(autopilotBriefDecision(draft(), NOW)).toEqual({ action: 'lint' });
    expect(autopilotBriefDecision(draft({ revision: 0 }), NOW)).toEqual({ action: 'lint' });
  });

  it('accepts only a site-lane brief with a clean, model-read check, checked routes and no open question', () => {
    expect(autopilotBriefDecision(draft({}), NOW)).toEqual({ action: 'accept' });
    expect(autopilotBriefDecision(draft({}, { questions: 'Which colour?\n' }), NOW)).toEqual({ action: 'answer', questions: ['Which colour?'] });
  });

  it('stops, with the reason, on a wrong or unchecked lane, a blocking finding, unchecked routes or an unread criteria set', () => {
    const studio = autopilotBriefDecision(draft({ lane: { lane: 'studio', reason: 'A toy.', source: 'grooming' } }), NOW);
    expect(studio).toMatchObject({ action: 'stop', reason: expect.stringMatching(/Studio lane/) });
    const unchecked = autopilotBriefDecision(draft({ lane: { lane: 'site', reason: 'never groomed', source: 'unchecked' } }), NOW);
    expect(unchecked).toMatchObject({ action: 'stop', reason: expect.stringMatching(/lane was never checked/) });
    const vague = autopilotBriefDecision(draft({ findings: [{ kind: 'criterion', severity: 'block', subject: 'It looks nice', message: 'A judgement.' }] }), NOW);
    expect(vague).toMatchObject({ action: 'stop', reason: expect.stringMatching(/It looks nice.*A judgement/) });
    // A warning alone does not stop the run.
    expect(autopilotBriefDecision(draft({ findings: [{ kind: 'route', severity: 'warn', subject: '', message: 'No route' }] }), NOW)).toEqual({ action: 'accept' });
    expect(autopilotBriefDecision(draft({ routesChecked: false }), NOW)).toMatchObject({ action: 'stop', reason: expect.stringMatching(/route manifest/) });
    expect(autopilotBriefDecision(draft({ judged: undefined }), NOW)).toMatchObject({ action: 'stop', reason: expect.stringMatching(/reviewer model could not check/) });
  });

  it('does nothing once the brief is accepted', () => {
    const state = draft({});
    state.brief.acceptedAt = ago(0);
    expect(autopilotBriefDecision(state, NOW)).toEqual({ action: 'wait' });
  });
});
