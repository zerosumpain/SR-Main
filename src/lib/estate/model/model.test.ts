/**
 * Guards for the estate model.
 *
 * The invariant that matters most is the last one: a feed that cannot run must
 * report `null`, never `0`. Zero is a claim about the estate ("there are no
 * containers"); null is a claim about the reading ("I could not look"). The
 * surface this model replaces conflated the two — a runtime filesystem scan
 * SUCCEEDED against a directory the deploy does not update and returned a
 * confident, month-stale inventory. It never errored. It just quietly lied.
 */
import { describe, it, expect } from 'vitest';
import { assembleEstateModel } from './assemble.server';
import registry from '../registry/apps.generated.json';
import { EXTRACTED_TRIGGERS } from '$lib/workflows/trigger-ownership';

const model = await assembleEstateModel();

describe('estate model', () => {
  it('has a node for every application in the vendored registry', () => {
    const apps = model.nodes.filter((n) => n.layer === 'app').map((n) => n.label).sort();
    expect(apps).toEqual(registry.apps.map((a) => a.key).sort());
  });

  it('links every application to the repository that builds it', () => {
    for (const app of registry.apps) {
      if (!app.repo) continue;
      const edge = model.edges.find((e) => e.kind === 'builds' && e.to === `app:${app.key}`);
      expect(edge, `${app.key} has no repo edge`).toBeTruthy();
      expect(edge!.from).toBe(`repo:${app.repo}`);
    }
  });

  it('carries the activity to repository link as real edges, not prose', () => {
    // This is the join the brief asked for: a queue trigger names a lane of
    // work, an app's worker claims it, and the app is built from a repository.
    const lanes = registry.apps.flatMap((a) => a.queueTriggers.map((t) => [a.key, t] as const));
    expect(lanes.length, 'the registry declares no queue triggers at all').toBeGreaterThan(0);
    for (const [app, trigger] of lanes) {
      expect(
        model.edges.some((e) => e.kind === 'owns-worker' && e.from === `app:${app}` && e.to === `activity:${trigger}`),
      ).toBe(true);
    }
  });

  it('REPORTS a trigger the registry claims and this process still executes, rather than reconciling it', () => {
    // Deriving EXTRACTED_TRIGGERS from the registry would stop Main's generic
    // worker claiming a lane while no dedicated worker existed to claim it: the
    // queue would fill with no owner and no error. The two lists answer
    // different questions — intent vs "a worker is live" — so the model surfaces
    // the difference and changes nothing.
    const declared = new Set<string>(EXTRACTED_TRIGGERS);
    const unclaimed = registry.apps.flatMap((a) => a.queueTriggers).filter((t) => !declared.has(t));
    for (const trigger of unclaimed) {
      expect(
        model.findings.some((f) => f.kind === 'mismatch' && f.title.includes(trigger)),
        `no finding raised for the unreconciled trigger "${trigger}"`,
      ).toBe(true);
    }
    // And the constant itself is untouched by the model.
    expect([...EXTRACTED_TRIGGERS]).toEqual(['policy-analysis']);
  });

  it('gives every feed a ledger row, and every node a feed that produced it', () => {
    expect(model.ledger.length).toBeGreaterThanOrEqual(5);
    const feeds = new Set(model.ledger.map((l) => l.feed));
    for (const n of model.nodes) expect(feeds.has(n.feed), `${n.id} cites unknown feed ${n.feed}`).toBe(true);
  });

  it('reports a feed it could not read as null, never as zero', () => {
    // The runtime feed is the live one: off the release host it must decline to
    // answer rather than report every port closed.
    const runtime = model.ledger.find((l) => l.feed === 'runtime');
    expect(runtime).toBeTruthy();
    if (runtime!.count === null) {
      expect(runtime!.error, 'a feed that returns null must say why').toBeTruthy();
      expect(model.nodes.some((n) => n.layer === 'container')).toBe(false);
    } else {
      expect(runtime!.count).toBeGreaterThan(0);
    }
    // No feed may report 0 without that being a true statement about the estate:
    // every zero must come with nodes or be null.
    for (const l of model.ledger) {
      if (l.count === 0) expect(l.error, `${l.feed} reported 0 with no explanation`).toBeTruthy();
    }
  });

  it('surfaces the blind feeds as a finding so a partial model cannot read as complete', () => {
    const blind = model.ledger.filter((l) => l.count === null);
    if (blind.length) {
      expect(model.findings.some((f) => f.kind === 'gap' && f.title.includes('could not be read'))).toBe(true);
    }
  });
});
