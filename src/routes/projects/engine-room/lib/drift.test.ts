// drift.test.ts — the Engine Room must not describe a machine that no longer exists.
//
// The study's numbers and stage names are imported from the features (facts.server.ts),
// and its copy is keyed by the features' own types, so most drift already fails svelte-check.
// This file pins what the type checker can't see:
//   * runtime key sets — a copy map must cover exactly the values the feature declares,
//     no more (a retired stage left behind) and no fewer;
//   * the heartbeat activities shown on the Build pages must exist in the scheduler;
//   * the app manifest's names must all have copy, and the copy must not outlive them;
//   * every native API area on disk must have copy;
//   * the explainer copy may not carry digits, because a number written into prose is a
//     number that will go stale — figures come from facts.server.ts instead.

import { describe, expect, it } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { STAGES } from '$lib/daydream/think/explain';
import { COMMISSION_STATES } from '$lib/daydream/commissioning';
import { IDEA_SOURCES } from '$lib/selfimprove/board';
import { RELEASE_POLICIES, BRIEF_LANES } from '$lib/constants/development';
import { EDGE_KINDS } from '$lib/codegraph/query';
import { GATE_NAMES } from '$lib/codegraph/gates';

import { STAGE_ENG, COMMISSION_COPY, DAYDREAM_COPY } from './daydream';
import {
  SOURCE_COPY, POLICY_COPY, BRIEF_LANE_COPY, EDGE_COPY, GATE_COPY, HEARTBEAT_ACTIVITIES, HIDDEN_ACTIVITIES, ACTIVITY_COPY,
  BUILD_COPY, DELIVERY_COPY, VERIFY_COPY, PHASE_COPY, LANE_COPY,
} from './build';
import {
  APP, APP_COPY, TAB_COPY, MORE_COPY, WATCH_COPY, BACKGROUND_COPY, PERMISSION_COPY, ENTITLEMENT_COPY,
  SURFACE_COPY, AREA_COPY,
} from './app';
import { REDIRECTS, PARTS, href } from './nav';

const keys = (o: object) => Object.keys(o).sort();
const sorted = (xs: readonly string[]) => [...xs].sort();

describe('copy maps cover exactly what the feature declares', () => {
  it.each([
    ['daydream stages', STAGE_ENG, STAGES],
    ['double-check states', COMMISSION_COPY, COMMISSION_STATES],
    ['backlog idea sources', SOURCE_COPY, IDEA_SOURCES],
    ['release policies', POLICY_COPY, RELEASE_POLICIES],
    ['brief lanes', BRIEF_LANE_COPY, BRIEF_LANES],
    ['codegraph edge kinds', EDGE_COPY, EDGE_KINDS],
    ['gate names', GATE_COPY, GATE_NAMES],
  ] as const)('%s', (_name, copy, declared) => {
    expect(keys(copy)).toEqual(sorted(declared));
  });
});

describe('the heartbeat activities on the Build pages', () => {
  it('all exist in the scheduler registry, and every daydream/build activity is shown', async () => {
    const { listHandlers } = await import('$lib/heartbeat/registry');
    const names = listHandlers().map((h) => h.name);
    for (const a of HEARTBEAT_ACTIVITIES) expect(names, `${a} is no longer a heartbeat activity`).toContain(a);
    const relevant = names.filter((n) => /^(daydream-|backlog-|build-|forge-)/.test(n) && !(n in HIDDEN_ACTIVITIES));
    expect(sorted(relevant), 'a new activity needs copy in ACTIVITY_COPY or a reason in HIDDEN_ACTIVITIES').toEqual(sorted(HEARTBEAT_ACTIVITIES));
    for (const h of Object.keys(HIDDEN_ACTIVITIES)) expect(names, `${h} no longer exists`).toContain(h);
    expect(keys(ACTIVITY_COPY)).toEqual(sorted(HEARTBEAT_ACTIVITIES));
  });
});

describe('the app manifest and its copy agree', () => {
  it.each([
    ['tabs', APP.tabs, TAB_COPY],
    ['More pages', APP.morePages, MORE_COPY],
    ['watch pages', APP.watchPages, WATCH_COPY],
    ['background modes', APP.backgroundModes, BACKGROUND_COPY],
    ['permissions', APP.permissions, PERMISSION_COPY],
    ['entitlements', APP.entitlements, ENTITLEMENT_COPY],
  ] as const)('%s', (_name, names, copy) => {
    expect(keys(copy)).toEqual(sorted(names));
  });

  it('every widget surface has copy', () => {
    for (const w of [...APP.widgets, ...APP.complications]) expect(SURFACE_COPY, w.id).toHaveProperty(w.surface);
  });

  it('carries no personal data — names only', () => {
    const text = JSON.stringify(APP);
    expect(text).not.toMatch(/@|https?:\/\/|\/home\/|com\.strangeramblings|\$\(/);
  });

  // Runs only where an app checkout is available (the owner's machine, or app CI).
  const ios = process.env.SR_APPLE_IOS ?? '/home/john/sr-apple-ux-20261002/ios';
  it.skipIf(!existsSync(join(ios, 'project.yml')))('is in step with the app source', () => {
    const script = resolve(__dirname, '../../../../../scripts/sync-app-manifest.mjs');
    expect(() => execFileSync('node', [script, ios, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('the native API', () => {
  it('every area under /api/native has copy, and no copy outlives its area', () => {
    const dir = resolve(__dirname, '../../../api/native');
    const areas = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(keys(AREA_COPY)).toEqual(sorted(areas));
  });
});

describe('explainer copy carries no figures', () => {
  const ALLOWED = /SHA-256/g;
  function strings(v: unknown, path: string, out: Array<[string, string]>) {
    if (typeof v === 'string') out.push([path, v]);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
  }
  it('no digits in any copy string', () => {
    const all: Array<[string, string]> = [];
    const maps = {
      DAYDREAM_COPY, STAGE_ENG, COMMISSION_COPY, BUILD_COPY, DELIVERY_COPY, VERIFY_COPY, PHASE_COPY, LANE_COPY,
      SOURCE_COPY, POLICY_COPY, BRIEF_LANE_COPY, EDGE_COPY, GATE_COPY, ACTIVITY_COPY, APP_COPY, TAB_COPY, MORE_COPY,
      WATCH_COPY, BACKGROUND_COPY, PERMISSION_COPY, ENTITLEMENT_COPY, SURFACE_COPY, AREA_COPY,
    };
    for (const [name, m] of Object.entries(maps)) strings(m, name, all);
    const offenders = all.filter(([, s]) => /\d/.test(s.replace(ALLOWED, '')));
    expect(offenders).toEqual([]);
  });
});

describe('every retired URL still lands somewhere', () => {
  it('redirects only to pages that exist', () => {
    const live = new Set(['/projects/engine-room', ...PARTS.flatMap((p) => [href(p.id), ...p.leaves.map((l) => href(p.id, l.slug))])]);
    for (const [from, to] of Object.entries(REDIRECTS)) expect(live, `${from} → ${to}`).toContain(to);
  });

  it('no live page is shadowed by a redirect', () => {
    for (const p of PARTS) {
      expect(REDIRECTS).not.toHaveProperty(p.id);
      for (const l of p.leaves) expect(REDIRECTS).not.toHaveProperty(`${p.id}/${l.slug}`);
    }
  });
});
