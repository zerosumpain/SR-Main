// The harness HUD: plain DOM beside the map. It shows the numbers a mayor
// watches (population, tier, treasury, the demand meters) plus the harness's
// own controls: speed, lens and a fresh seed. Text only goes in through
// textContent, never innerHTML.

import { METERS, TIER_NAMES, formatPounds } from './engine';
import type { HarnessEvent, HarnessStats } from './harness/session';
import { LENSES, LENS_DEFS, type Lens } from './render/model';
import { LENS_RAMP, css } from './render/palette';

export const SPEEDS = [0, 1, 4, 16, 48] as const;
const SPEED_LABELS = ['Pause', '1×', '4×', '16×', '48×'];
const METER_LABELS: Record<(typeof METERS)[number], string> = {
  homesL: 'Homes £',
  homesM: 'Homes ££',
  homesH: 'Homes £££',
  shops: 'Shops',
  leisure: 'Leisure',
  industry: 'Industry',
  offices: 'Offices',
  farms: 'Farms',
};

export interface HudHandlers {
  speed(ticksPerSecond: number): void;
  lens(lens: Lens): void;
  reseed(seed: number): void;
}

export interface Hud {
  show(s: HarnessStats, log: readonly HarnessEvent[], perf: { simMs: number; fps: number; draws: number }): void;
  inspect(text: string): void;
  setSpeed(v: number): void;
  setLens(l: Lens): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createHud(host: HTMLElement, seed: number, h: HudHandlers): Hud {
  host.replaceChildren();
  const title = el('h1', 'hud-title', 'Hometowns harness');
  const sub = el('p', 'hud-sub', 'A bot mayor plays an in-page county. No network.');

  const stats = el('dl', 'hud-stats');
  const field = (label: string) => {
    const dt = el('dt', '', label);
    const dd = el('dd', '', '–');
    stats.append(dt, dd);
    return dd;
  };
  const fName = field('Town');
  const fTier = field('Tier');
  const fPop = field('Population');
  const fMoney = field('Treasury');
  const fDay = field('Day · month');
  const fMood = field('Approval · happy');
  const fPerf = field('Sim · fps · draws');

  const meters = el('div', 'hud-meters');
  const bars = METERS.map((k) => {
    const row = el('div', 'meter');
    const label = el('span', 'meter-label', METER_LABELS[k]);
    const track = el('span', 'meter-track');
    const fill = el('span', 'meter-fill');
    track.append(fill);
    const value = el('span', 'meter-value', '0');
    row.append(label, track, value);
    meters.append(row);
    return { fill, value };
  });

  const speedRow = el('div', 'hud-buttons');
  const speedButtons = SPEEDS.map((v, k) => {
    const b = el('button', '', SPEED_LABELS[k]);
    b.type = 'button';
    b.addEventListener('click', () => h.speed(v));
    speedRow.append(b);
    return b;
  });

  const lensRow = el('div', 'hud-buttons');
  const lensButtons = LENSES.map((l) => {
    const b = el('button', '', LENS_DEFS[l].label);
    b.type = 'button';
    b.addEventListener('click', () => h.lens(l));
    lensRow.append(b);
    return b;
  });
  const legend = el('ol', 'hud-legend');

  const seedRow = el('form', 'hud-seed');
  const seedInput = el('input');
  seedInput.type = 'number';
  seedInput.min = '1';
  seedInput.value = String(seed);
  seedInput.setAttribute('aria-label', 'Seed');
  const seedButton = el('button', '', 'New town');
  seedButton.type = 'submit';
  seedRow.append(seedInput, seedButton);
  seedRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Math.floor(Number(seedInput.value));
    if (Number.isFinite(v) && v > 0) h.reseed(v);
  });

  const inspector = el('p', 'hud-inspect', 'Hover over a tile.');
  const log = el('ol', 'hud-log');

  host.append(
    title,
    sub,
    stats,
    el('h2', '', 'Demand'),
    meters,
    el('h2', '', 'Speed'),
    speedRow,
    el('h2', '', 'Lens'),
    lensRow,
    legend,
    inspector,
    el('h2', '', 'Seed'),
    seedRow,
    el('h2', '', 'Bot log'),
    log,
  );

  function setLens(l: Lens): void {
    lensButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(LENSES[k] === l)));
    legend.replaceChildren();
    LENS_DEFS[l].legend.forEach((label, k) => {
      if (!label) return;
      const li = el('li');
      const sw = el('span', 'swatch');
      sw.style.background = css(LENS_RAMP[k]);
      li.append(sw, document.createTextNode(label));
      legend.append(li);
    });
  }

  return {
    show(s, events, perf) {
      fName.textContent = s.name;
      fTier.textContent = TIER_NAMES[s.tier] + (s.fortnight ? ' (founding fortnight)' : '');
      fPop.textContent = formatPounds(s.population).slice(1); // the engine's own digit grouping (A25), without the £
      fMoney.textContent = formatPounds(s.reserves) + (s.helper ? ' · Helper Mode' : '');
      fDay.textContent = `${s.day} · ${s.month}`;
      fMood.textContent = `${Math.round(s.approval)} · ${Math.round(s.happy)}`;
      fPerf.textContent = `${perf.simMs.toFixed(1)} ms · ${Math.round(perf.fps)} · ${Math.round(perf.draws)}`;
      s.meters.forEach((v, k) => {
        const pct = Math.max(-100, Math.min(100, v));
        const f = bars[k].fill;
        f.style.left = pct < 0 ? `${50 + pct / 2}%` : '50%';
        f.style.width = `${Math.abs(pct) / 2}%`;
        f.classList.toggle('neg', pct < 0);
        bars[k].value.textContent = String(Math.round(v));
      });
      log.replaceChildren(...events.slice(-8).reverse().map((e) => el('li', '', `t${e.tick} ${e.text}`)));
    },
    inspect(text) {
      inspector.textContent = text;
    },
    setSpeed(v) {
      speedButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(SPEEDS[k] === v)));
    },
    setLens,
  };
}
