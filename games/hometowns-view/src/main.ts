// The map page's entry point. In v1 the page runs inside the iPhone app and
// talks to it over the bridge (§10.9, WP6). Until then, and for development
// and Playwright, `?harness=1` plays an in-page county with the harness bot
// (§9.16): no authentication and no network.
//
// Query parameters (harness mode): seed=<n> (default 1), site=<0–5>,
// speed=<ticks a second: 0, 1, 4, 16 or 48>, lens=<landValue | pollution |
// access | development>.

import { describeTile, cellValue, LENSES, type Lens } from './render/model';
import { createMapView, type MapView } from './render/map';
import { createHud, SPEEDS, type Hud } from './hud';
import { HarnessSession } from './harness/session';
import { ENGINE_HASH } from './engine';

/** Wall-clock ms the simulation may use per frame; the rest is the renderer's. */
const SIM_BUDGET_MS = 12;

interface HarnessHandle {
  session: HarnessSession;
  /** For Playwright: the town hash, its stats, and a way to run whole days without the frame loop. */
  hash(): string;
  stats(): ReturnType<HarnessSession['stats']>;
  runDays(days: number): void;
  engineHash: string;
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
  const mapHost = document.createElement('div');
  mapHost.className = 'map';
  const hudHost = document.createElement('aside');
  hudHost.className = 'hud';
  root.replaceChildren(mapHost, hudHost);

  let seed = Math.max(1, Math.floor(param(q, 'seed', 1)));
  const site = Math.max(0, Math.min(5, Math.floor(param(q, 'site', 0))));
  let speed = SPEEDS.includes(param(q, 'speed', 4) as (typeof SPEEDS)[number]) ? param(q, 'speed', 4) : 4;
  let lens: Lens = (LENSES as readonly string[]).includes(q.get('lens') ?? '') ? (q.get('lens') as Lens) : 'none';
  let session = new HarnessSession({ seed, site });
  let hovered: [number, number] | null = null;

  const inspect = () => {
    if (!hovered) return hud.inspect('Hover over a tile.');
    const [x, y] = hovered;
    const v = cellValue(session.town, lens, x, y);
    hud.inspect(describeTile(session.town, x, y) + (v === null ? '' : ` · ${lens === 'landValue' ? 'land value' : 'pollution'} ${v}`));
  };

  const map: MapView = await createMapView(mapHost, (tile) => {
    hovered = tile;
    inspect();
  });
  const hud: Hud = createHud(hudHost, seed, {
    speed(v) {
      speed = v;
      hud.setSpeed(v);
    },
    lens(l) {
      lens = l;
      hud.setLens(l);
      map.update(session.town, lens);
      inspect();
    },
    reseed(v) {
      seed = v;
      session = new HarnessSession({ seed, site });
      handle.session = session;
      backlog = 0;
      map.update(session.town, lens);
    },
  });
  hud.setSpeed(speed);
  hud.setLens(lens);

  const handle: HarnessHandle = {
    session,
    hash: () => session.hash(),
    stats: () => session.stats(),
    runDays: (d) => session.runDays(d),
    engineHash: ENGINE_HASH,
  };
  window.__hometowns = handle;

  // The frame loop: whole ticks only (so a seed always plays the same town), at most SIM_BUDGET_MS a
  // frame; the map draws only when something changed, and the loop rests while the tab is hidden.
  let backlog = 0;
  let simMs = 0;
  let shown = 0;
  let last = performance.now();
  let frames = 0;
  let draws = 0;
  let rate = { fps: 0, draws: 0, since: last };
  const frame = (now: number) => {
    const dt = Math.min(250, now - last);
    last = now;
    backlog = Math.min(backlog + (dt / 1000) * speed, 4);
    const whole = Math.floor(backlog);
    if (whole > 0) {
      const t0 = performance.now();
      const ran = session.run(whole, SIM_BUDGET_MS, () => performance.now());
      backlog -= ran;
      simMs = simMs * 0.8 + (performance.now() - t0) * 0.2;
    }
    if (map.update(session.town, lens) && hovered) inspect();
    frames++;
    if (map.render()) draws++;
    if (now - rate.since >= 1000) {
      rate = { fps: (frames * 1000) / (now - rate.since), draws: (draws * 1000) / (now - rate.since), since: now };
      frames = 0;
      draws = 0;
    }
    if (now - shown > 250) {
      shown = now;
      hud.show(session.stats(), session.log, { simMs, fps: rate.fps, draws: rate.draws });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => {
    // Pixi resizes the canvas on its own schedule; resize now so fit() reads the new size.
    (map.app as unknown as { resize?: () => void }).resize?.();
    map.fit();
  });
}

function placeholder(root: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'placeholder';
  const h = document.createElement('h1');
  h.textContent = 'Hometowns';
  const p = document.createElement('p');
  p.textContent = 'This page draws a town inside the Hometowns app. For development, add ?harness=1 to the address to watch a bot mayor build a town here.';
  const a = document.createElement('a');
  a.href = '?harness=1';
  a.textContent = 'Open harness mode';
  box.append(h, p, a);
  root.replaceChildren(box);
}

const root = document.getElementById('app');
if (root) {
  const q = new URLSearchParams(location.search);
  if (q.get('harness') === '1') harness(root, q).catch((e) => {
    root.textContent = `The harness failed to start: ${e instanceof Error ? e.message : String(e)}`;
  });
  else placeholder(root);
}
