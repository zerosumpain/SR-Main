// The map page's entry point (spec §9.1, §9.16, §10.9).
//
//   ?app=1      inside the iPhone app: the page draws the map and talks to
//               the app over the bridge (window.hometowns and the `hometowns`
//               message handler); it does no network of its own.
//   ?harness=1  a solo county played in a desktop browser with no server,
//               for development and Playwright. Options: seed=<n>,
//               speed=<ticks a second: 0, 1, 4, 16, 48; default Live>,
//               lens=<a lens id>, kid=1 (children's copy and dials),
//               bot=1 (the harness bot plays), fresh=1 (do not keep the
//               county in this browser).
//
// In harness mode `window.__hometowns` exposes hash(), stats(), runDays(n),
// botHash(seed, site, days) and engineHash for Playwright.

import { ENGINE_HASH, paramsFor, paramsHash } from './engine';
import { AppSession } from './app';
import { expose, inApp, post } from './bridge/bridge';
import { BRIDGE_VERSION } from './bridge/protocol';
import { Controller } from './controller';
import { HarnessSession } from './harness/session';
import { HarnessUi } from './harness/ui';
import { LENS_IDS, type LensId } from './lenses';

interface HarnessHandle {
  hash(): string;
  stats(): { tick: number; population: number; tier: number; day: number; fps: number; simMs: number };
  /** Runs whole game days of the county on screen, without the frame loop. */
  runDays(days: number): void;
  /** A fresh bot town of `days` days: the WebKit-vs-Node determinism check. */
  botHash(seed: number, site: number, days: number): string;
  /** Shows a county built in Node (a JSON fixture), paused. */
  show(countyJson: string, townIndex: number, now: number): void;
  /** Draws `n` frames, panning a pixel each time, and returns each frame's ms (the frame-time check). */
  frameTimes(n: number, repaint: boolean): number[];
  engineHash: string;
  ui: HarnessUi;
}

declare global {
  interface Window {
    __hometowns?: HarnessHandle;
  }
}

function param(q: URLSearchParams, k: string, fallback: number): number {
  const v = Number(q.get(k));
  return q.has(k) && Number.isFinite(v) ? v : fallback;
}

async function harness(root: HTMLElement, q: URLSearchParams): Promise<void> {
  const lensParam = q.get('lens') ?? 'none';
  const speedParam = param(q, 'speed', NaN);
  const ui = new HarnessUi(root, {
    seed: Math.max(1, Math.floor(param(q, 'seed', 1))),
    kid: q.get('kid') === '1',
    bot: q.get('bot') === '1',
    speed: Number.isFinite(speedParam) ? speedParam : undefined,
    lens: (LENS_IDS as readonly string[]).includes(lensParam) ? (lensParam as LensId) : 'none',
    persist: q.get('fresh') !== '1',
  });
  await ui.start();
  window.__hometowns = {
    hash: () => ui.local.hash(),
    stats: () => {
      const t = ui.local.town;
      const s = ui.controller.stats();
      return { tick: t?.tick ?? 0, population: ui.local.population(), tier: t?.tier ?? 0, day: ui.local.county.dayIndex, fps: s.fps, simMs: s.simMs };
    },
    runDays: (d) => {
      ui.local.runDays(d);
      ui.controller.wake();
    },
    botHash: (seed, site, days) => {
      const s = new HarnessSession({ seed, site });
      s.runDays(days);
      return s.hash();
    },
    show: (json, townIndex, now) => ui.show(JSON.parse(json), townIndex, now),
    frameTimes: (n, repaint) => {
      const map = ui.controller.map;
      const out: number[] = [];
      for (let k = 0; k < n; k++) {
        const t0 = performance.now();
        if (repaint) ui.controller.repaintAll();
        else map.focus(32 + (k % 2), 40);
        map.render(t0);
        // Reading a pixel waits for the GPU, so the time is the whole frame, not just the queueing.
        (map.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl?.finish();
        out.push(performance.now() - t0);
      }
      return out;
    },
    engineHash: ENGINE_HASH,
    ui,
  };
}

async function app(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.className = 'in-app';
  const mapHost = document.createElement('div');
  mapHost.className = 'map';
  root.append(mapHost);
  let session: AppSession | null = null;
  const c = new Controller(
    mapHost,
    {
      out: post,
      commit: (planId, ops) => session!.commit(planId, ops),
      beforeFrame: (_now, budget) => session?.beforeFrame(budget),
      nextDue: () => session?.nextDue() ?? null,
    },
    { copyLevel: 'adult', reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches },
  );
  await c.start();
  session = new AppSession(c, post);
  expose(session.api());
  post({ type: 'ready', bridge: BRIDGE_VERSION, engineHash: ENGINE_HASH, paramsHash: paramsHash(paramsFor('v1')) });
}

function placeholder(root: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'placeholder';
  const h = document.createElement('h1');
  h.textContent = 'Hometowns';
  const p = document.createElement('p');
  p.textContent = 'This page draws a town inside the Hometowns app. For development, add ?harness=1 to the address to play a county here, with no server.';
  const a = document.createElement('a');
  a.href = '?harness=1';
  a.textContent = 'Open harness mode';
  box.append(h, p, a);
  root.replaceChildren(box);
}

/**
 * Harness mode could not start, most likely on a county this browser saved:
 * offer to forget it (every saved harness county) and start afresh, rather
 * than failing the same way on every visit.
 */
function offerFreshCounty(root: HTMLElement): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Start a new county';
  b.addEventListener('click', () => {
    try {
      const keys = Array.from({ length: localStorage.length }, (_, k) => localStorage.key(k)).filter((k): k is string => !!k && k.startsWith('hometowns.harness.'));
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      // Storage is blocked: the reload starts afresh anyway, as a private window does.
    }
    location.reload();
  });
  root.append(document.createElement('br'), b);
}

const root = document.getElementById('app');
if (root) {
  const q = new URLSearchParams(location.search);
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    root.textContent = `The map failed to start: ${msg}`;
    post({ type: 'error', msg });
  };
  if (q.get('app') === '1' || inApp()) app(root).catch(fail);
  else if (q.get('harness') === '1')
    harness(root, q).catch((e) => {
      fail(e);
      offerFreshCounty(root);
    });
  else placeholder(root);
}
