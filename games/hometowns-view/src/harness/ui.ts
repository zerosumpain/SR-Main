// Harness mode's chrome (spec §9.16): in the app SwiftUI draws the top bar,
// the Wants bar, the toolbar, the forecast card and every sheet; in a desktop
// browser this file draws plain-DOM stand-ins for them, so a solo county is
// fully playable with no server: founding and Bramble's three steps, Plan
// then Build with the forecast card, lenses, the inspector, Town Hall (taxes,
// funding, standing orders, the Ledger), People, today's builds with undo,
// the clock, welcome back and the Morning Bulletin. Mobile-first: one column
// with bottom sheets on a phone, a side panel on a desk.
//
// Text only ever goes in through textContent, never innerHTML.

import {
  BUILDINGS,
  B_BUILT,
  B_KIND,
  CAT_ROAD,
  CAT_ZONE,
  ENGINE_HASH,
  FUNDING_GROUPS,
  FUNDING_KEYS,
  NAME_FIRST,
  NAME_SECOND,
  ORDER_DEFAULTS,
  ROAD_KINDS,
  TIER_NAMES,
  TILES,
  Z_HOMES,
  checklistOf,
  constructionLeft,
  gridEndAt,
  planesOf,
  population,
  readHistory,
  readTileLog,
  tileIndex,
  useCat,
  usePayload,
  type FundingPatch,
  type Op,
  type StandingOrder,
  type TaxPatch,
  type TownState,
} from '../engine';
import type { ForecastCard, InspectCardMsg, PageMessage } from '../bridge/protocol';
import { Controller, type Source } from '../controller';
import { ADVISOR_IDS, AVATAR_IDS, FLAG_COLOURS, advisorPortrait, mayorAvatar, type AdvisorId } from '../art/portraits';
import { MONTHS, words, type CopyLevel } from '../copy';
import { groupDigits, pounds, range, roughly, signed, signedPounds } from '../format';
import { causeLine, cohortTable, faceRows, ledgerRows, moodWords, townMood, wantLabel, whyOf, type Derived } from '../layers';
import { LENS_DEFS, LENS_IDS, lensesFor, type CellWhy, type LensId } from '../lenses';
import { TRAYS, trayItems, type TrayName } from '../plan/trays';
import type { Tool } from '../plan/plan';
import { derivedOf } from './derived';
import { LocalCounty, SPEEDS, SPEED_LABELS, type Outcome } from './local';

type Layer = 'mood' | 'why' | 'ledger';
type SheetName = 'build' | 'lenses' | 'hall' | 'people' | 'today' | 'clock' | null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function button(text: string, onClick: () => void, cls = '', attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', cls, text, attrs);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const titled = (s: string) => s[0].toUpperCase() + s.slice(1);
const MONEY = ['£', '££', '£££'];
const FACE_IDS = ['workers', 'professionals', 'families', 'retirees', 'students'];

/** WP8's procedural art (an SVG string) as an image element: never parsed into the page as markup. */
function svgImage(svg: string, label: string, size = 40): HTMLImageElement {
  const img = h('img', 'art', undefined, { alt: label, width: String(size), height: String(size) });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return img;
}

export interface HarnessUiOptions {
  seed: number;
  kid: boolean;
  bot: boolean;
  speed?: number;
  lens?: LensId | 'none';
  /** Keep the county in this browser between visits. */
  persist: boolean;
}

export class HarnessUi {
  readonly local: LocalCounty;
  private c!: Controller;
  private layer: Layer = 'mood';
  private sheet: SheetName = null;
  private tray: TrayName = 'Roads';
  private derived: Derived | null = null;
  private derivedKey = '';
  private lastChrome = 0;
  private lastRealFrame = 0;
  private lastDay = -1;
  private advisorsShown = new Set<string>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Welcome back waits for the time-lapse to finish (§9.9): the tick it covers, or null. */
  private pendingWelcome: number | null = null;
  private readonly el: Record<string, HTMLElement> = {};

  constructor(
    private readonly root: HTMLElement,
    private readonly o: HarnessUiOptions,
  ) {
    this.local = new LocalCounty({ seed: o.seed, storageKey: o.persist && !o.bot ? `hometowns.harness.v1.${o.seed}` : null });
    this.local.autopilot = o.bot;
    if (o.speed !== undefined && (SPEEDS as readonly number[]).includes(o.speed)) this.local.speed = o.speed;
  }

  async start(): Promise<void> {
    const r = this.root;
    r.replaceChildren();
    r.className = 'harness';
    const top = h('header', 'topbar');
    const wants = h('div', 'wantsbar', undefined, { role: 'group', 'aria-label': 'What the town wants' });
    const stage = h('main', 'stage');
    const mapHost = h('div', 'map');
    const legend = h('div', 'legend hidden');
    const readout = h('p', 'readout hidden', '', { 'aria-live': 'polite' });
    const advisors = h('div', 'advisors');
    const card = h('section', 'forecast hidden', undefined, { 'aria-label': 'Plan' });
    const tutorial = h('section', 'tutorial hidden');
    const inspector = h('section', 'inspector hidden', undefined, { 'aria-label': 'Inspector' });
    const overlay = h('div', 'overlay hidden');
    const toast = h('p', 'toast hidden', '', { role: 'status' });
    stage.append(mapHost, legend, readout, advisors, tutorial, inspector, card);
    const sheet = h('aside', 'sheet hidden');
    const toolbar = h('nav', 'toolbar', undefined, { 'aria-label': 'Toolbar' });
    r.append(top, wants, stage, sheet, toolbar, overlay, toast);
    Object.assign(this.el, { top, wants, stage, mapHost, legend, readout, advisors, card, tutorial, inspector, overlay, toast, sheet, toolbar });

    this.c = new Controller(
      mapHost,
      {
        out: (m) => this.onMessage(m),
        commit: (planId, ops) => this.commit(planId, ops),
        wantsFrames: () => this.local.speed > 0 || this.local.catchingUp || (this.local.autopilot && !this.local.town),
        beforeFrame: (_now, budget) => this.tickClock(budget),
        nextDue: () => null,
        cellRead: (w) => this.showCell(w),
        lapseDone: () => {
          const w = this.pendingWelcome;
          this.pendingWelcome = null;
          if (w !== null) this.showWelcomeBack(w);
        },
      },
      { copyLevel: this.o.kid ? 'kid' : 'adult', reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches },
    );
    await this.c.start();
    this.buildToolbar();
    if (this.local.town) this.afterTownChanged(true);
    else if (!this.o.bot) this.showFounding();
    if (this.o.lens && this.o.lens !== 'none') this.c.setLens(this.o.lens);
    // Coming back to a saved county: the time-lapse first, then welcome back (§9.9).
    if (this.local.restored && this.local.town) {
      const t = this.local.town;
      const from = t.lastSeenTick;
      this.local.advance(0, 2000, () => performance.now());
      this.afterTownChanged(true);
      const replaying = this.c.timelapse(from);
      if (replaying) this.toast('Here is what happened while you were away. Tap the map to skip.');
      if (t.tick - from >= 48) {
        if (replaying) this.pendingWelcome = from;
        else this.showWelcomeBack(from);
      }
    }
    window.addEventListener('beforeunload', () => this.local.save(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.local.save(true);
    });
    this.lastRealFrame = performance.now();
    this.c.wake();
  }

  private get level(): CopyLevel {
    return this.o.kid ? 'kid' : 'adult';
  }

  /** For Playwright and the console. */
  get controller(): Controller {
    return this.c;
  }

  /** Playwright: show a county built elsewhere (a fixture), paused. */
  show(county: Parameters<LocalCounty['load']>[0], townIndex: number, now: number): void {
    this.el.overlay.classList.add('hidden');
    this.local.load(county, townIndex, now);
    this.derivedKey = '';
    this.afterTownChanged(true);
    this.c.map.fit(this.local.town!);
  }

  // ---- The source and the clock --------------------------------------------------------------------

  private source(): Source | null {
    const c = this.local.county;
    const t = this.local.town;
    if (!t) return null;
    const key = `${t.tick >> 2}|${t.planesRev}|${c.log.length}|${c.dayIndex}`;
    if (key !== this.derivedKey) {
      this.derivedKey = key;
      this.derived = derivedOf(c, this.local.townIndex);
    }
    return {
      town: t,
      snapshot: c.snapshot,
      ctx: { townIndex: this.local.townIndex, dayIndex: c.dayIndex, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, paramsVersion: c.paramsVersion, profile: this.o.kid ? 'kid' : 'adult' },
      at: c.gridTick > 0 ? gridEndAt(c, c.gridTick - 1) : c.epoch,
      derived: this.derived,
      tickMs: c.tickMs,
      msToRegionalDay: this.local.msToRegionalDay(),
      live: false,
    };
  }

  private tickClock(budgetMs: number): void {
    const now = performance.now();
    const dt = Math.min(250, now - this.lastRealFrame);
    this.lastRealFrame = now;
    const hadTown = !!this.local.town;
    const ran = this.local.advance(dt, budgetMs, () => performance.now());
    if (!hadTown && this.local.town) return this.afterTownChanged(true);
    if (ran > 0 || this.local.catchingUp) {
      const s = this.source();
      if (s) this.c.setSource(s, false);
      if (now - this.lastChrome > 250) this.chrome();
    }
    if (this.local.county.dayIndex !== this.lastDay) {
      if (this.lastDay >= 0 && this.local.town && !this.local.inFortnight) this.showBulletin();
      this.lastDay = this.local.county.dayIndex;
    }
  }

  private afterTownChanged(urgent: boolean): void {
    const s = this.source();
    if (s) this.c.setSource(s, urgent);
    this.lastDay = this.local.county.dayIndex;
    this.chrome();
  }

  private act(cmd: Parameters<LocalCounty['act']>[0]): Outcome {
    const r = this.local.act(cmd);
    if (!r.ok && r.error) this.toast(r.error);
    this.afterTownChanged(true);
    return r;
  }

  private commit(planId: string, ops: Op[]): string | null {
    const r = this.local.act({ type: 'build', planId, plan: ops });
    if (!r.ok) return r.error ?? 'That plan could not be built.';
    this.afterTownChanged(true);
    this.toast(`Building! It cost ${pounds(r.result?.cost ?? 0)}. Undo it today from “Today”.`);
    return null;
  }

  // ---- Messages from the controller (what the app would receive) -------------------------------------

  private onMessage(m: PageMessage): void {
    switch (m.type) {
      case 'plan':
        return this.showCard(m.ops, m.cost, m.forecast);
      case 'inspect':
        return this.showInspector(m.card);
      case 'lensChanged':
        return this.showLegend(m.id, m.legend ?? [], m.note ?? null);
      case 'error':
        return this.toast(m.msg);
      case 'stats':
        if (this.el.perf) this.el.perf.textContent = `${m.fps} fps · low ${m.minFps} · sim ${m.simMs} ms`;
        return;
      default:
        return;
    }
  }

  // ---- Top bar, Wants bar and the advisor cards ------------------------------------------------------

  private chrome(): void {
    this.lastChrome = performance.now();
    const t = this.local.town;
    const top = this.el.top;
    top.replaceChildren();
    if (!t) {
      top.append(h('strong', 'town', 'Kingsport County'), h('span', 'muted', 'Pick a site to found your town'));
      this.el.wants.replaceChildren();
      return;
    }
    const c = this.local.county;
    const month = Math.floor(c.gridTick / 4);
    const flag = h('span', 'flag');
    flag.style.background = FLAG_COLOURS[t.flag % FLAG_COLOURS.length];
    const money = readHistory(t, 'reserves');
    const delta = money.length >= 2 ? money[money.length - 1] - money[money.length - 2] : 0;
    const why = this.layer !== 'mood';
    const num = (label: string, text: string, q: string) =>
      why
        ? button(text, () => this.showWhy(label, q), 'num', { 'aria-label': `${label} ${text}: why?` })
        : h('span', 'num', text, { 'aria-label': `${label} ${text}` });
    const mood = townMood(t);
    top.append(
      h('strong', 'town', ''),
      h('span', 'date', `Year ${Math.floor(month / 12) + 1} · ${MONTHS[month % 12]}`),
      num('Money', `${pounds(t.money.reserves)} ${delta >= 0 ? '▲' : '▼'}`, 'revenue'),
      num('People', groupDigits(population(t)), 'pop'),
      num('Mood', moodWords(mood), 'approval'),
      this.layerSwitch(),
    );
    (top.firstChild as HTMLElement).append(flag, document.createTextNode(` ${t.name} · ${titled(TIER_NAMES[t.tier])}`));
    if (this.local.catchingUp) top.append(h('span', 'muted', 'catching up…'));

    // The Wants bar: six bars; ones not yet unlocked are hidden (§9.2).
    const wants = this.el.wants;
    wants.replaceChildren();
    const bars: [string, number, string, number][] = [
      ['Homes', Math.max(t.meters[0], t.meters[1], t.meters[2]), 'meter.homesL', 0],
      ['Shops', t.meters[3], 'meter.shops', 0],
      ['Leisure', t.meters[4], 'meter.leisure', 2],
      ['Industry', t.meters[5], 'meter.industry', 0],
      ['Offices', t.meters[6], 'meter.offices', 2],
      ['Farms', t.meters[7], 'meter.farms', 0],
    ];
    for (const [label, v, q, tier] of bars) {
      if (t.tier < tier) continue;
      const b = button('', () => this.showWhy(label, q), 'want', { 'aria-label': `${label} wanted: ${Math.round(v)}. Why?` });
      const fill = h('span', 'want-fill' + (v < 0 ? ' neg' : ''));
      const pct = Math.max(-100, Math.min(100, v));
      fill.style.left = pct < 0 ? `${50 + pct / 2}%` : '50%';
      fill.style.width = `${Math.abs(pct) / 2}%`;
      const track = h('span', 'want-track');
      track.append(fill);
      b.append(h('span', 'want-label', label), track);
      if (label === 'Homes') b.append(h('span', 'want-tiers', t.meters.slice(0, 3).map((m, k) => `${MONEY[k]}${m > 20 ? '↑' : ''}`).join(' ')));
      wants.append(b);
    }
    this.drawAdvisors();
    this.drawTutorial();
    if (this.sheet) this.drawSheet();
  }

  private layerSwitch(): HTMLElement {
    const t = this.local.town;
    const box = h('span', 'layers', undefined, { role: 'group', 'aria-label': 'Layer' });
    const layers: [Layer, string][] = [
      ['mood', 'Mood'],
      ['why', 'Why'],
      ['ledger', 'Ledger'],
    ];
    for (const [id, label] of layers) {
      // The Ledger unlocks at Town and is for adults (§9.6).
      if (id === 'ledger' && (this.o.kid || !t || t.tier < 2)) continue;
      const b = button(label, () => {
        this.layer = id;
        this.chrome();
      }, '', { 'aria-pressed': String(this.layer === id) });
      box.append(b);
    }
    return box;
  }

  private drawAdvisors(): void {
    const box = this.el.advisors;
    box.replaceChildren();
    const d = this.derived;
    if (!d || this.local.inFortnight) return;
    // At most 3 cards a session, and a card the mayor dismissed stays dismissed (§9.7).
    for (const a of d.advisors.filter((x) => !this.advisorsShown.has(x.key)).slice(0, 3 - Math.min(3, this.advisorsShown.size))) {
      const cardEl = h('div', 'advisor');
      const action = String(a.data.action ?? '');
      const who = words(`advisorName.${a.advisor}`, this.level);
      if ((ADVISOR_IDS as readonly string[]).includes(a.advisor)) cardEl.append(svgImage(advisorPortrait(a.advisor as AdvisorId, 'thinking'), who));
      cardEl.append(
        h('strong', '', who),
        h('p', '', words(`advisor.${a.key}`, this.level, a.data, 'I have an idea for the town.')),
        button('Show me', () => {
          this.advisorsShown.add(a.key);
          this.follow(action);
        }),
        button('Not now', () => {
          this.advisorsShown.add(a.key);
          this.drawAdvisors();
        }, 'quiet'),
      );
      box.append(cardEl);
    }
  }

  /** An advisor's deep link: a sheet, a lens or a tool (§9.7: one button, which drops a suggestion). */
  private follow(action: string): void {
    const [kind, arg] = action.split(':');
    if (kind === 'sheet') this.openSheet(arg === 'wants' || arg === 'talk' || arg === 'growth' ? 'people' : 'hall');
    else if (kind === 'lens') this.c.setLens(arg === 'homes' ? 'desirability' : ((LENS_IDS as readonly string[]).includes(arg) ? (arg as LensId) : 'happy'));
    else if (kind === 'zone') this.useTool({ kind: 'zone', variant: arg });
    else if (kind === 'build') {
      const b = BUILDINGS.find((x) => x.id === arg);
      if (b) this.useTool({ kind: 'place', id: b.id, rot: 0 });
      else if (arg === 'avenue') this.useTool({ kind: 'upgrade', variant: 'avenue' });
      else {
        const tray: Record<string, TrayName> = { school: 'Learning', health: 'Health', police: 'Safety', power: 'Power & Water', water: 'Power & Water', park: 'Fun', culture: 'Culture & Visitors', attraction: 'Culture & Visitors' };
        this.tray = tray[arg] ?? 'Roads';
        this.openSheet('build');
      }
    }
    this.drawAdvisors();
  }

  // ---- Founding and Bramble's three steps ------------------------------------------------------------

  private showFounding(): void {
    const c = this.local.county;
    const o = this.el.overlay;
    o.classList.remove('hidden');
    o.replaceChildren();
    const box = h('div', 'panel founding');
    let site = c.sites.findIndex((s) => s.owner === null);
    let first: string = NAME_FIRST[0];
    let second: string = NAME_SECOND[0];
    let avatar: (typeof AVATAR_IDS)[number] = AVATAR_IDS[0];
    let flag = 0;
    const sites = h('div', 'choices', undefined, { role: 'group', 'aria-label': 'Site' });
    const siteButtons = c.sites.map((s, k) =>
      button(`${k + 1}. ${words(`site.${s.kind}`, this.level, {}, titled(s.kind))}`, () => {
        site = k;
        siteButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === site)));
      }, '', { 'aria-pressed': String(k === site) }),
    );
    sites.append(...siteButtons);
    const pick = (label: string, opts: readonly string[], set: (v: string) => void) => {
      const s = h('select', '', undefined, { 'aria-label': label });
      for (const v of opts) s.append(h('option', '', v, { value: v }));
      s.addEventListener('change', () => set(s.value));
      return s;
    };
    const name = h('div', 'name');
    name.append(pick('First half of the name', NAME_FIRST, (v) => (first = v)), pick('Second half of the name', NAME_SECOND, (v) => (second = v)));
    const avatars = h('div', 'choices', undefined, { role: 'group', 'aria-label': 'Mayor' });
    const avatarButtons = AVATAR_IDS.map((id) => {
      const b = button('', () => {
        avatar = id;
        avatarButtons.forEach((x, j) => x.setAttribute('aria-pressed', String(AVATAR_IDS[j] === id)));
      }, 'avatar-button', { 'aria-pressed': String(id === avatar), 'aria-label': words(`avatar.${id}`, this.level) });
      b.append(svgImage(mayorAvatar(id, flag), words(`avatar.${id}`, this.level), 36));
      return b;
    });
    avatars.append(...avatarButtons);
    const flags = h('div', 'choices', undefined, { role: 'group', 'aria-label': 'Flag' });
    const flagButtons = FLAG_COLOURS.map((col, k) => {
      const b = button('', () => {
        flag = k;
        flagButtons.forEach((x, j) => x.setAttribute('aria-pressed', String(j === k)));
      }, 'swatch-button', { 'aria-pressed': String(k === 0), 'aria-label': `Flag ${k + 1}` });
      b.style.background = col;
      return b;
    });
    flags.append(...flagButtons);
    box.append(
      h('h2', '', 'Found your town'),
      h('p', '', 'Kingsport County has six sites around Kingsport. Pick one, name your town and choose a flag.'),
      h('h3', '', 'Site'),
      sites,
      h('h3', '', 'Name'),
      name,
      h('h3', '', 'Mayor'),
      avatars,
      h('h3', '', 'Flag'),
      flags,
      button('Found the town', () => {
        const r = this.local.found({ site, nameParts: [first, second] as [string, string], avatar, flag });
        if (!r.ok) return this.toast(r.error ?? 'That did not work.');
        o.classList.add('hidden');
        this.afterTownChanged(true);
        this.c.map.fit(this.local.town!);
        this.toast('Welcome, Mayor! Bramble has three steps for you.');
      }, 'primary'),
    );
    o.append(box);
  }

  /** §1.5, §2.3: draw a lane, zone 12 homes, place a Well, then "Next week ▶" twelve times. */
  private drawTutorial(): void {
    const box = this.el.tutorial;
    const t = this.local.town;
    if (!t || !this.local.inFortnight) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const p = planesOf(t);
    let lanes = 0;
    let homes = 0;
    for (let i = 0; i < TILES; i++) {
      const u = p.use[i];
      if (useCat(u) === CAT_ROAD && ROAD_KINDS[usePayload(u)] !== 'county') lanes++;
      if (useCat(u) === CAT_ZONE && usePayload(u) === Z_HOMES) homes++;
    }
    const well = t.buildings.some((b) => BUILDINGS[b[B_KIND]]?.id === 'well');
    const steps: [boolean, string, Tool][] = [
      [lanes > 0, 'Draw a lane from the County Road (drag along the ground).', { kind: 'road', variant: 'lane' }],
      [homes >= 12, `Zone 12 Homes beside your lane (${Math.min(12, homes)} so far).`, { kind: 'zone', variant: 'homes' }],
      [well, 'Put a Well near the homes.', { kind: 'place', id: 'well', rot: 0 }],
    ];
    box.replaceChildren(h('strong', '', 'Bramble’s three steps'));
    const ol = h('ol');
    for (const [done, text, tool] of steps) {
      const li = h('li', done ? 'done' : '');
      li.append(h('span', '', `${done ? '✓ ' : ''}${text}`));
      if (!done) li.append(button('Use this tool', () => this.useTool(tool), 'quiet'));
      ol.append(li);
    }
    box.append(ol);
    const left = t.sprintLeft;
    box.append(
      h('p', '', `Then press Next week to watch it grow. ${left} week${left === 1 ? '' : 's'} of the Founding Fortnight left.`),
      button('Next week ▶', () => {
        const r = this.local.sprint();
        if (!r.ok) this.toast(r.error ?? 'Not yet.');
        this.afterTownChanged(true);
      }, 'primary'),
      button('Play it all', () => {
        this.local.sprintAll();
        this.afterTownChanged(true);
        this.toast('Your town is on the county clock now.');
      }),
    );
  }

  // ---- The forecast card (§9.2, §9.8) ------------------------------------------------------------------

  private showCard(ops: Op[], cost: number, f: ForecastCard | null): void {
    const card = this.el.card;
    if (!ops.length) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    card.replaceChildren();
    const preview = this.c.planPreview;
    const refused = f?.refused ?? preview?.refused ?? null;
    const kid = this.o.kid;
    const rows = h('dl', 'card-rows');
    const row = (k: string, v: string) => rows.append(h('dt', '', k), h('dd', '', v));
    row('Cost now', pounds(cost));
    if (preview && preview.upkeep) row('Upkeep', `${pounds(preview.upkeep)} a month`);
    if (f) {
      const after = f.exactForMs < f.months * 4 * (this.local.county.tickMs || 1) ? ' (after tomorrow: estimate)' : '';
      if (kid) {
        row('Money', f.monthly[1] >= 0 ? 'up' : f.monthly[1] > -500 ? 'down a little' : 'down');
        row('People', f.people[1] > 0 ? 'more people ↑' : f.people[1] < 0 ? 'fewer people ↓' : 'about the same');
      } else {
        row('Monthly money', range(f.monthly[0], f.monthly[2], signedPounds) + after);
        row('People', range(f.people[0], f.people[2]) + after);
      }
      const faces = f.happy
        .map((b, k) => [words(`face.${FACE_IDS[k]}`, this.level), b] as const)
        .filter(([, b]) => Math.abs(b[1]) >= 0.5)
        .map(([n, b]) => (kid ? `${n}: ${b[1] > 0 ? 'happier' : 'less happy'}` : `${n} ${range(b[0], b[2])}`));
      row('Happiness', faces.length ? faces.join(' · ') : 'no change');
      if (f.readyTicks > 0) row('Ready in', `${roughly(f.readyMs)} (${f.readyTicks} weeks)`);
      if (f.seeds === 1) row('', 'Working out the range…');
    } else row('', 'Forecasting…');
    const d = this.derived;
    if (d && (d.pipeline.homes || d.pipeline.movers)) row('On the way', `${groupDigits(d.pipeline.homes)} homes being built · about ${groupDigits(d.pipeline.movers)} people thinking of moving here`);
    card.append(h('strong', '', `Your plan · ${ops.length} step${ops.length === 1 ? '' : 's'}`), rows);
    if (refused) card.append(h('p', 'refused', refused));
    const actions = h('div', 'card-actions');
    actions.append(
      button('Build it!', () => this.c.planEdit('commit'), 'primary', refused ? { disabled: 'true' } : {}),
      button('Undo', () => this.c.planEdit('undo')),
      button('Clear', () => this.c.planEdit('clear')),
    );
    card.append(actions);
  }

  // ---- Lenses, readout and the inspector ---------------------------------------------------------------

  private showLegend(id: string, legend: string[], note: string | null): void {
    const box = this.el.legend;
    if (id === 'none') {
      box.classList.add('hidden');
      this.el.readout.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.replaceChildren(h('strong', '', LENS_DEFS[id as LensId]?.label ?? id));
    const ol = h('ol');
    const ramp = ['#2b3a67', '#2f6f8f', '#2fa38c', '#8cc865', '#f2e35b'];
    legend.forEach((label, k) => {
      if (!label) return;
      const li = h('li');
      const sw = h('span', 'swatch');
      sw.style.background = ramp[k];
      li.append(sw, document.createTextNode(label));
      ol.append(li);
    });
    box.append(ol);
    if (note) box.append(h('p', 'muted', note));
    box.append(button('Close lens', () => {
      this.c.setLens('none');
      if (this.sheet === 'lenses') this.drawSheet();
    }, 'quiet'));
  }

  private showCell(w: CellWhy | null): void {
    const r = this.el.readout;
    if (!w) return r.classList.add('hidden');
    r.classList.remove('hidden');
    r.textContent = w.line;
  }

  private showInspector(card: InspectCardMsg): void {
    const box = this.el.inspector;
    box.classList.remove('hidden');
    box.replaceChildren(h('strong', '', card.title));
    const dl = h('dl', 'card-rows');
    const row = (k: string, v: string | null) => v && dl.append(h('dt', '', k), h('dd', '', v));
    row('Who', card.who);
    row('Mood', card.mood);
    if (card.wants.length && card.kind !== 'want') row('Wants', card.wants.join(' · '));
    if (card.landValue) row('Land value', `${card.landValue.value}${card.landValue.terms.length ? ': ' + card.landValue.terms.map(([k, v]) => `${signed(v)} ${k}`).join(' · ') : ''}`);
    if (card.grow && !this.o.kid) row('Growth score', `${card.grow.score}${card.grow.blocked ? ` (held back: ${card.grow.blocked})` : ''}`);
    box.append(dl);
    if (card.kind === 'want') box.append(h('p', '', causeLine(whyOf(this.local.town!, card.wants[0] === 'homes' ? 'meter.homesL' : `meter.${card.wants[0]}`))));
    if (card.growLine) box.append(h('p', '', `What would make it grow? ${card.growLine}`));
    const actions = h('div', 'card-actions');
    if (card.growPlan) actions.append(button('Show me', () => {
      this.c.ghost(card.growPlan!);
      box.classList.add('hidden');
    }, 'primary'));
    actions.append(button('Close', () => box.classList.add('hidden'), 'quiet'));
    box.append(actions);
  }

  /** The Why layer: a number's top three causes (§9.6). */
  private showWhy(label: string, q: string): void {
    const t = this.local.town;
    if (!t) return;
    const lines = q === 'revenue' ? [whyOf(t, 'revenue'), whyOf(t, 'spending')] : [whyOf(t, q)];
    const box = this.el.inspector;
    box.classList.remove('hidden');
    box.replaceChildren(h('strong', '', `Why: ${label}`));
    for (const w of lines) box.append(h('p', '', causeLine(w, (k) => k.replace(/^[a-z]+\./, '').replace(/([A-Z])/g, ' $1').toLowerCase())));
    box.append(button('Close', () => box.classList.add('hidden'), 'quiet'));
  }

  // ---- Toolbar and sheets ------------------------------------------------------------------------------

  private buildToolbar(): void {
    const bar = this.el.toolbar;
    const items: [SheetName, string][] = [
      ['build', 'Build'],
      ['lenses', 'Lenses'],
      ['hall', 'Town Hall'],
      ['people', 'People'],
      ['today', 'Today'],
      ['clock', 'Clock'],
    ];
    bar.replaceChildren(
      ...items.map(([id, label]) => button(label, () => this.openSheet(this.sheet === id ? null : id), '', { 'data-sheet': String(id) })),
      button('Map view', () => {
        this.c.settings({ topDown: !this.c.topDown });
        this.toast(this.c.topDown ? 'Top-down planning view' : 'Town view');
      }, 'quiet'),
    );
    this.el.perf = h('span', 'perf muted', '');
    bar.append(this.el.perf);
  }

  private openSheet(s: SheetName): void {
    this.sheet = s;
    for (const b of Array.from(this.el.toolbar.querySelectorAll('button[data-sheet]'))) b.setAttribute('aria-pressed', String(b.getAttribute('data-sheet') === s));
    this.drawSheet();
  }

  private useTool(tool: Tool): void {
    this.c.setTool(tool);
    this.toast(tool.kind === 'none' ? 'Pan and look around.' : tool.kind === 'eraser' ? 'Tap a ghost to remove it.' : 'Drag on the map to plan. Two fingers (or the right mouse button) move the map.');
    if (window.matchMedia('(max-width: 720px)').matches) this.openSheet(null);
    else this.drawSheet();
  }

  private drawSheet(): void {
    const sheet = this.el.sheet;
    const t = this.local.town;
    if (!this.sheet || !t) {
      sheet.classList.add('hidden');
      return;
    }
    sheet.classList.remove('hidden');
    sheet.replaceChildren(button('Close', () => this.openSheet(null), 'quiet close'));
    const body = h('div', 'sheet-body');
    sheet.append(body);
    if (this.sheet === 'build') this.sheetBuild(body, t);
    else if (this.sheet === 'lenses') this.sheetLenses(body, t);
    else if (this.sheet === 'hall') this.sheetHall(body, t);
    else if (this.sheet === 'people') this.sheetPeople(body, t);
    else if (this.sheet === 'today') this.sheetToday(body, t);
    else if (this.sheet === 'clock') this.sheetClock(body);
  }

  private sheetBuild(body: HTMLElement, t: TownState): void {
    const tabs = h('div', 'tabs', undefined, { role: 'tablist' });
    for (const tray of TRAYS) tabs.append(button(tray, () => {
      this.tray = tray;
      this.drawSheet();
    }, '', { role: 'tab', 'aria-selected': String(this.tray === tray) }));
    const current = this.c.currentTool;
    const tools = h('div', 'tools');
    tools.append(
      button('Look', () => this.useTool({ kind: 'none' }), '', { 'aria-pressed': String(current.kind === 'none') }),
      button('Eraser', () => this.useTool({ kind: 'eraser' }), '', { 'aria-pressed': String(current.kind === 'eraser') }),
    );
    if (current.kind === 'place') tools.append(button('Rotate', () => this.useTool({ ...current, rot: current.rot === 1 ? 0 : 1 })));
    const grid = h('div', 'items');
    for (const it of trayItems(t).filter((x) => x.tray === this.tray)) {
      const active = current.kind === it.tool.kind && current.id === it.tool.id && current.variant === it.tool.variant;
      const b = button('', () => (it.locked ? this.toast(it.locked) : this.useTool(it.tool)), 'item' + (it.locked ? ' locked' : ''), { 'aria-pressed': String(active), 'aria-disabled': String(!!it.locked) });
      b.append(h('span', 'item-name', it.label));
      if (it.cost || it.upkeep) b.append(h('span', 'muted', `${pounds(it.cost)}${it.tool.kind === 'road' ? ' a tile' : ''}${it.upkeep ? ` · ${pounds(it.upkeep)}/month` : ''}`));
      if (it.locked) b.append(h('span', 'muted', it.locked));
      grid.append(b);
    }
    body.append(h('h2', '', 'Build'), tabs, tools, grid);
  }

  private sheetLenses(body: HTMLElement, t: TownState): void {
    const have = lensesFor(t.tier);
    const lens = this.c.currentLens;
    body.append(
      h('h2', '', 'Lenses'),
      button('No lens', () => {
        this.c.setLens('none');
        this.drawSheet();
      }, '', { 'aria-pressed': String(lens === 'none') }),
    );
    let group = '';
    for (const id of LENS_IDS) {
      const def = LENS_DEFS[id];
      if (def.group !== group) {
        group = def.group;
        body.append(h('h3', '', group));
      }
      const locked = !have.includes(id);
      body.append(button(locked ? `${def.label} (unlocks at Village)` : def.label, () => {
        if (!locked) {
          this.c.setLens(id);
          this.drawSheet();
        }
      }, locked ? 'locked' : '', { 'aria-pressed': String(lens === id), 'aria-disabled': String(locked) }));
    }
  }

  private sheetHall(body: HTMLElement, t: TownState): void {
    const p = this.local.params;
    const step = this.o.kid ? p.finance.kidStep : p.finance.adultStep;
    const led = ledgerRows(t);
    body.append(h('h2', '', 'Town Hall'));
    const dl = h('dl', 'card-rows');
    dl.append(h('dt', '', 'Reserves'), h('dd', '', pounds(t.money.reserves)), h('dt', '', 'Last month'), h('dd', '', signedPounds(led.net)));
    if (t.money.helper) dl.append(h('dt', '', 'Helper Mode'), h('dd', '', 'Bramble is helping with the money'));
    body.append(dl);

    // Taxes by tier (§9.6 controls unlock by tier).
    body.append(h('h3', '', 'Taxes'));
    const dial = (label: string, value: number, rangeBp: readonly number[], patch: (v: number) => TaxPatch) => {
      const row = h('div', 'dial');
      const out = h('span', 'dial-value', `${(value / 100).toFixed(1)}%`);
      const minus = button('−', () => this.act({ type: 'budget', moveId: this.local.newMoveId('tax'), taxes: patch(Math.max(rangeBp[0], value - step)) }), '', { 'aria-label': `Lower ${label}` });
      const plus = button('+', () => this.act({ type: 'budget', moveId: this.local.newMoveId('tax'), taxes: patch(Math.min(rangeBp[1], value + step)) }), '', { 'aria-label': `Raise ${label}` });
      row.append(h('span', 'dial-label', label), minus, out, plus);
      body.append(row);
    };
    const r = p.finance.ranges;
    if (t.tier < 1) dial('Town Tax', t.taxes.town, r.homes, (v) => ({ town: v }));
    else if (t.tier < 2) {
      dial('Homes tax', t.taxes.homes[0], r.homes, (v) => ({ homes: v }));
      dial('Business tax', t.taxes.business, r.business, (v) => ({ business: v }));
    } else {
      t.taxes.homes.forEach((v, k) => dial(`Homes tax ${MONEY[k]}`, v, r.homes, (x) => ({ homes: t.taxes.homes.map((y, j) => (j === k ? x : y)) })));
      dial('Business tax', t.taxes.business, r.business, (v) => ({ business: v }));
      dial('Sales tax', t.taxes.sales, r.sales, (v) => ({ sales: v }));
      if (t.tier >= 3) dial('Hotel tax', t.taxes.hotel, r.hotel, (v) => ({ hotel: v }));
    }

    // Funding: three groups at Hamlet, each service from Village.
    body.append(h('h3', '', 'Funding'));
    const levels = ['Low', 'Normal', 'High'];
    const groups: [string, string, number][] =
      t.tier < 1
        ? (Object.keys(FUNDING_GROUPS) as (keyof typeof FUNDING_GROUPS)[]).map((g) => [titled(g), g, t.funding[FUNDING_KEYS.indexOf(FUNDING_GROUPS[g][0])]] as [string, string, number])
        : FUNDING_KEYS.map((k, i) => [titled(k), k, t.funding[i]] as [string, string, number]);
    for (const [label, key, v] of groups) {
      const row = h('div', 'dial');
      row.append(h('span', 'dial-label', label));
      levels.forEach((name, lv) =>
        row.append(button(name, () => this.act({ type: 'budget', moveId: this.local.newMoveId('fund'), funding: { [key]: lv } as FundingPatch }), '', { 'aria-pressed': String(v === lv) })),
      );
      body.append(row);
    }

    // Standing orders (§5.18): what Bramble does while you are away. Split taxes come with them at Village.
    body.append(h('h3', '', 'Standing orders'));
    if (t.tier < 1) body.append(h('p', 'muted', 'Standing orders unlock at Village. Bramble keeps the basics running until then.'));
    for (const def of ORDER_DEFAULTS) {
      const mine = t.orders.find((x) => x.kind === def.kind);
      const on = mine?.on ?? false;
      const row = h('label', 'order');
      const box = h('input', '', undefined, { type: 'checkbox' }) as HTMLInputElement;
      box.checked = on;
      box.disabled = t.tier < 1;
      box.addEventListener('change', () => {
        const orders: StandingOrder[] = ORDER_DEFAULTS.map((d) => {
          const cur = t.orders.find((x) => x.kind === d.kind);
          return { kind: d.kind, on: d.kind === def.kind ? box.checked : (cur?.on ?? false), args: [...(cur?.args ?? d.args)] };
        });
        this.act({ type: 'orders', moveId: this.local.newMoveId('orders'), orders });
      });
      const args = mine?.args ?? def.args;
      row.append(box, document.createTextNode(` ${words(`order.${def.kind}`, this.level, { a0: args[0] ?? 0, a1: args[1] ?? 0, a2: args[2] ?? 0 })}`));
      body.append(row);
    }

    // The Ledger: adults, from Town (§9.6).
    if (!this.o.kid && t.tier >= 2) {
      body.append(h('h3', '', 'Ledger: last month'));
      const table = h('dl', 'card-rows');
      for (const row of [...led.revenue, ...led.spending]) table.append(h('dt', '', row.line), h('dd', '', signedPounds(row.amount)));
      body.append(table);
    } else if (!this.o.kid) body.append(h('p', 'muted', 'The full Ledger unlocks at Town.'));
  }

  private sheetPeople(body: HTMLElement, t: TownState): void {
    body.append(h('h2', '', 'People'));
    const dl = h('dl', 'card-rows');
    for (const f of faceRows(t)) dl.append(h('dt', '', words(`face.${f.face}`, this.level, {}, titled(f.face))), h('dd', '', `${groupDigits(f.people)} · ${'★'.repeat(Math.floor(f.stars))}${f.stars % 1 ? '½' : ''}`));
    body.append(dl);
    const d = this.derived;
    if (d?.needs.length) {
      body.append(h('h3', '', 'What families need'));
      for (const row of d.needs) {
        if (!row.items.length) continue;
        const items = row.items.map((it) => `${it.key} ${it.met >= 0.5 ? '✓' : '✗'}`).join(' · ');
        body.append(h('p', '', `${MONEY[row.tier]} families: ${items}`));
      }
    }
    if (d?.townTalk.length) {
      body.append(h('h3', '', 'Town Talk'));
      for (const [k, pct] of d.townTalk) body.append(h('p', '', `${Math.round(pct)}% are talking about ${k}`));
    }
    if (d?.wants.length) {
      body.append(h('h3', '', 'Wants'));
      for (const w of d.wants) body.append(h('p', '', wantLabel(w.key, d, this.level)));
    }
    body.append(h('h3', '', `To become a ${TIER_NAMES[Math.min(4, t.tier + 1)]}`));
    for (const item of checklistOf(t)) body.append(h('p', item.met ? 'done' : '', `${item.met ? '✓' : '✗'} ${words(`check.${item.id}`, this.level)}`));
    if (this.layer === 'ledger') {
      body.append(h('h3', '', 'Everyone, by group'));
      const table = h('dl', 'card-rows');
      for (const [k, v] of cohortTable(t)) table.append(h('dt', '', k), h('dd', '', groupDigits(v)));
      body.append(table);
    }
  }

  private sheetToday(body: HTMLElement, t: TownState): void {
    body.append(h('h2', '', 'Today’s builds'));
    const today = t.undo.filter((u) => u.day === this.local.county.dayIndex);
    if (!today.length) body.append(h('p', 'muted', 'Nothing built today. Plans you build can be undone until the end of the day.'));
    for (const u of [...today].reverse()) {
      const row = h('div', 'dial');
      row.append(
        h('span', 'dial-label', `${pounds(u.cost)} · ${u.added.length ? u.added.map((b) => BUILDINGS[b[B_KIND]]?.name ?? 'building').join(', ') : `${u.tiles.length / 6} tiles`}`),
        button('Undo', () => {
          const r = this.act({ type: 'undo', moveId: this.local.newMoveId('undo'), planId: u.planId });
          if (r.ok) this.toast(`Undone: ${pounds(-(r.result?.cost ?? 0))} back.`);
        }),
      );
      body.append(row);
    }
  }

  private sheetClock(body: HTMLElement): void {
    const l = this.local;
    body.append(h('h2', '', 'Clock'), h('p', 'muted', `Harness clock. Live is the local dev clock: a game week every ${l.county.tickMs / 1000} s, a Regional Day every 48 weeks.`));
    const row = h('div', 'tools');
    SPEEDS.forEach((s, k) => row.append(button(SPEED_LABELS[k], () => {
      l.speed = s;
      l.save(true);
      this.drawSheet();
      this.c.wake();
    }, '', { 'aria-pressed': String(l.speed === s) })));
    body.append(row);
    const ms = l.msToRegionalDay();
    body.append(h('p', '', `Day ${l.county.dayIndex + 1}. Next Regional Day ${Number.isFinite(ms) ? `in ${roughly(ms)}` : 'when the clock runs'}.`));
    body.append(
      button('Start a new county', () => {
        l.forget();
        location.reload();
      }, 'quiet'),
      h('p', 'muted', `Engine ${ENGINE_HASH} · seed ${l.seed}`),
    );
  }

  // ---- Welcome back and the Morning Bulletin (§9.9) -----------------------------------------------------

  private showWelcomeBack(fromTick: number): void {
    const t = this.local.town;
    if (!t) return;
    const days = Math.max(1, Math.round((t.tick - fromTick) / 48));
    const pops = readHistory(t, 'pop', true);
    // A town seen last in its founding fortnight had nobody yet; otherwise the daily record from back then.
    const before = fromTick <= 12 ? 0 : pops.length > days ? pops[pops.length - 1 - days] : (pops[0] ?? 0);
    const events = readTileLog(t, fromTick);
    const built = events.filter((e) => e.kind === 'built' || e.kind === 'levelUp').length;
    const opened = t.buildings.filter((b) => b[B_BUILT] >= fromTick && constructionLeft(t, tileIndex(b[1], b[2])) === 0).map((b) => BUILDINGS[b[B_KIND]]?.name ?? 'building');
    const bulletin = this.local.county.bulletin[0] ?? [];
    const cards = [
      `${words('welcomeBack.away', this.level, { ticks: t.tick - fromTick })} ${signed(population(t) - before)} people.`,
      opened.length ? `${opened.slice(0, 3).join(', ')} opened.` : `${groupDigits(built)} homes and shops were built or grew.`,
      bulletin.length ? bulletin.map((b) => b.key).join(' · ') : 'Bramble kept an eye on things. Lovely work.',
    ];
    this.cards('Welcome back!', cards, () => this.act({ type: 'seen', tick: t.tick }));
  }

  private showBulletin(): void {
    const t = this.local.town;
    if (!t) return;
    const pops = readHistory(t, 'pop', true);
    const money = readHistory(t, 'reserves', true);
    const dp = pops.length >= 2 ? pops[pops.length - 1] - pops[pops.length - 2] : 0;
    const dm = money.length >= 2 ? money[money.length - 1] - money[money.length - 2] : 0;
    const ev = this.local.county.snapshot.event;
    const items = this.local.county.bulletin[0] ?? [];
    const lines = items.length
      ? items.map((b) => b.key)
      : [`${dp >= 0 ? 'More' : 'Fewer'} people: ${signed(dp)} today.`, `Money ${dm >= 0 ? 'up' : 'down'} ${pounds(Math.abs(dm))} today.`, ev ? `Tomorrow: ${ev.id}.` : 'Tomorrow looks calm.'];
    this.toast(`Morning Bulletin · ${lines.join(' · ')}`, 7000);
  }

  private cards(title: string, lines: string[], done: () => void): void {
    const o = this.el.overlay;
    o.classList.remove('hidden');
    let k = 0;
    const draw = () => {
      o.replaceChildren();
      const box = h('div', 'panel welcome');
      box.append(h('h2', '', title), h('p', 'big', lines[k]), h('p', 'muted', `${k + 1} of ${lines.length}`));
      box.append(
        button(k < lines.length - 1 ? 'Next' : 'Let’s play', () => {
          if (k < lines.length - 1) {
            k++;
            draw();
          } else {
            o.classList.add('hidden');
            done();
          }
        }, 'primary'),
      );
      o.append(box);
    };
    draw();
  }

  private toast(text: string, ms = 3500): void {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }
}
