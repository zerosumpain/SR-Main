// The game's words (WP8, spec §5.19, §9.7, §9.9, §9.14): every explanation
// at two copy levels, kid and adult, from one file, copy/en-GB.json. The
// engine, the map page and the iPhone app all read that file, so a Why line,
// an advisor card or a Bulletin headline says the same thing on every
// surface, and the server can render the Gazette at both levels without an
// LLM (§9.9).
//
// An entry is { kid, adult } plus, where the wording depends on direction,
// { kidLess, adultLess } for a negative amount ("good schools" vs "busy
// schools"). Templates are plain text with slots:
//
//   {x}                  data.x: a number, grouped ("1,234"), or a string as is
//   {x:n}                a whole number, grouped
//   {x:signed}           "+12" / "−3"
//   {x:money}            "£12,345"
//   {x:signedMoney}      "+£1,200" / "−£300"
//   {x:pct}              a fraction as a percentage: 0.38 → "38%"
//   {x:bp}               basis points as a percentage: 250 → "2.5%"
//   {x:stars}            a 0–100 star as halves out of five: 72 → "★3.5"
//   {x:time}             game ticks as weeks, months or years
//   {x:ms}               real milliseconds: "about 25 minutes", "about 2 hours"
//   {x:count:one:many}   "1 home" / "12 homes"
//   {x:ref:prefix}       the copy entry "prefix.<x>" at the same level
//
// Kid text never shows a player's own words (§9.14: no free text for
// children): a string slot in kid text must be a `ref`, so it can only ever
// print words from this file. The copy test enforces that, the readability
// lint and the banned words. Numbers are formatted by our own arithmetic,
// never Intl or toLocaleString (A25), so V8 and JavaScriptCore agree.
//
// The app implements the same small grammar in Swift; the JSON file's
// "_about" field repeats it for whoever ports it.

import { ADVISOR_RULES, advisorCopyKeys } from './advisors';
import { BUILDINGS, EVENTS, ORDER_DEFAULTS, POLICIES, ROAD_DEFS, TIER_DEFS } from './content';
import { formatPounds } from './num';
import { NEED_ITEMS } from './needs';
import { CHECKLISTS } from './tiers';
import { COHORTS, FACES, FUNDING_KEYS, LEDGER_LINES, METERS, SITE_KINDS, STARS, ZONES } from './types';
import { QUANTITIES, TERMS } from './why';
import file from './copy/en-GB.json';

export type CopyLevel = 'kid' | 'adult';
export type CopyData = Record<string, number | string>;

export interface CopyEntry {
  kid: string;
  adult: string;
  /** For a negative amount, when the wording turns around. */
  kidLess?: string;
  adultLess?: string;
}

interface CopyFile {
  _about: string;
  locale: string;
  version: number;
  strings: Record<string, CopyEntry>;
}

const FILE = file as CopyFile;
export const COPY: Readonly<Record<string, CopyEntry>> = FILE.strings;
export const COPY_LOCALE = FILE.locale;
export const COPY_VERSION = FILE.version;

// ---- Lists the copy names (content WP8 owns) --------------------------------------------------

/** Mayor avatars for the Founding sheet: animals in hi-vis vests (`avatar.<id>`). */
export const AVATARS = ['fox', 'owl', 'rabbit', 'squirrel', 'duck', 'mole', 'deer', 'robin', 'frog', 'puffin', 'mouse', 'heron'] as const;

/** Flag colours by FoundBody.flag (`flag.<n>`); the art module paints them. */
export const FLAG_COUNT = 8;

/** The Build menu's trays (§9.3), by id (`tray.<id>`). */
export const TRAY_IDS = ['roads', 'zones', 'powerWater', 'safety', 'learning', 'health', 'fun', 'cultureVisitors', 'transport', 'landmarks'] as const;

/** The 14 lenses (§9.4), by the page's ids (`lens.<id>`, `lensName.<id>`). */
export const LENS_IDS = ['happy', 'landValue', 'pollution', 'noise', 'safety', 'schools', 'health', 'fun', 'culture', 'traffic', 'utilities', 'jobs', 'visitors', 'desirability'] as const;

/** Advisor portrait expressions (§9.15: four mascots × four expressions). */
export const EXPRESSIONS = ['happy', 'thinking', 'proud', 'concerned'] as const;

/**
 * The wants bubbles mood.ts can raise (§5.15): meters above +35, power and
 * water, unmet needs by wealth tier, and the Town Talk items.
 */
export const WANT_KEYS: readonly string[] = [
  'homes', 'shops', 'factories', 'offices', 'hotels', 'power', 'water',
  'needs.0', 'needs.1', 'needs.2',
  ...[...STARS, 'traffic'].map((k) => `talk.${k}`),
];

/** Town Talk topics (mood.ts: the 11 stars, then traffic). */
export const TALK_KEYS: readonly string[] = [...STARS, 'traffic'];

/** The Deputy's notes (orders.ts deputyNote kinds), as inbox kinds `deputy.<kind>`. */
export const DEPUTY_NOTES = ['budgetHealthy.funding', 'budgetHealthy.tax', 'awayZoning', 'repayLoan', 'fixDamaged', 'buyUtilities'] as const;

/**
 * Bulletin and welcome-back cards: key → the data fields its writer sends.
 * WP4's welcomeOf writes the `welcomeBack.*` cards; the Morning Bulletin
 * writer (§9.9: the migration result, the biggest change, tomorrow's event)
 * uses the `bulletin.*` keys, and welcome back repeats them.
 */
export const CARD_SLOTS: Readonly<Record<string, readonly string[]>> = {
  'welcomeBack.away': ['ticks'],
  'welcomeBack.people': ['pop'],
  'welcomeBack.inbox': ['n'],
  'welcomeBack.deputy': ['n'],
  'bulletin.grew': ['n', 'pop'],
  'bulletin.shrank': ['n', 'pop'],
  'bulletin.steady': ['pop'],
  'bulletin.movedIn': ['n', 'cohort'],
  'bulletin.movedOut': ['n', 'cohort'],
  'bulletin.opened': ['building'],
  'bulletin.homesBuilt': ['n'],
  'bulletin.homesComing': ['n'],
  'bulletin.money': ['amount'],
  'bulletin.moneyDown': ['amount'],
  'bulletin.happier': ['face'],
  'bulletin.tierNear': ['tier', 'left'],
  'bulletin.tierUp': ['tier'],
  'bulletin.tomorrow': ['event'],
  'bulletin.quiet': [],
  'bulletin.founded': [],
};

// ---- Rendering ------------------------------------------------------------------------------

const SLOT = /\{([A-Za-z0-9_]+)(?::([A-Za-z]+)(?::([^}:]*))?(?::([^}]*))?)?\}/g;

export interface Slot {
  name: string;
  fmt: string;
  arg1: string;
  arg2: string;
}

/** The slots a template uses, in order. */
export function templateSlots(s: string): Slot[] {
  const out: Slot[] = [];
  for (const m of s.matchAll(SLOT)) out.push({ name: m[1], fmt: m[2] ?? '', arg1: m[3] ?? '', arg2: m[4] ?? '' });
  return out;
}

/** "12,345" and "−12,345", by arithmetic. */
export function groupDigits(n: number): string {
  const s = formatPounds(n);
  return s.startsWith('−') ? '−' + s.slice(2) : s.slice(1);
}

function signedText(n: number): string {
  const r = Math.round(n);
  return r > 0 ? '+' + groupDigits(r) : groupDigits(r);
}

/** One decimal place at most, by arithmetic (2.5, 3, −0.5). */
function oneDecimal(x: number): string {
  const r = Math.round(x * 10);
  const neg = r < 0;
  const a = neg ? -r : r;
  const whole = Math.floor(a / 10);
  const tenth = a % 10;
  return (neg ? '−' : '') + groupDigits(whole) + (tenth ? '.' + String(tenth) : '');
}

/** Game ticks as words: a tick is a week, four make a month, 48 a year (§2.1). */
function timeText(ticks: number, level: CopyLevel): string {
  const t = Math.max(0, Math.round(ticks));
  if (t < 4) return t === 1 ? 'a week' : `${t} weeks`;
  if (t < 48) {
    const m = Math.round(t / 4);
    return m === 1 ? 'a month' : `${m} months`;
  }
  const y = level === 'kid' ? Math.round(t / 48) : Math.round(t / 4.8) / 10;
  return y === 1 ? 'a year' : `${level === 'kid' ? groupDigits(y) : oneDecimal(y)} years`;
}

/**
 * Real time as words, for "ready in" and "can afford it in" (§9.2, §0): a
 * plan's wait is felt in real minutes and hours, whatever the dev clock.
 */
function realTimeText(ms: number): string {
  const min = Math.round(Math.max(0, ms) / 60000);
  if (min < 1) return 'a moment';
  if (min < 90) return min === 1 ? 'about a minute' : `about ${min} minutes`;
  const h = Math.round(min / 60);
  if (h < 36) return h === 1 ? 'about an hour' : `about ${h} hours`;
  const d = Math.round(h / 24);
  return d === 1 ? 'about a day' : `about ${groupDigits(d)} days`;
}

function formatSlot(slot: Slot, v: number | string | undefined, level: CopyLevel): string {
  if (slot.fmt === 'ref') {
    const e = v === undefined ? undefined : COPY[`${slot.arg1}.${v}`];
    if (e) return pick(e, level, 1);
    // A kid never sees a raw value: an unknown reference reads as a neutral word.
    return level === 'kid' ? 'something' : String(v ?? '');
  }
  if (v === undefined) return level === 'kid' ? 'some' : '?';
  if (typeof v === 'string') return level === 'kid' ? 'something' : v;
  if (!Number.isFinite(v)) return '?';
  switch (slot.fmt) {
    case '':
    case 'n':
      return groupDigits(Math.round(v));
    case 'signed':
      return signedText(v);
    case 'money':
      return formatPounds(v);
    case 'signedMoney': {
      const r = Math.round(v);
      return r > 0 ? '+' + formatPounds(r) : formatPounds(r);
    }
    case 'pct':
      return groupDigits(Math.round(v * 100)) + '%';
    case 'bp':
      return oneDecimal(v / 100) + '%';
    case 'stars':
      return '★' + oneDecimal(Math.round(Math.max(0, Math.min(100, v)) / 10) / 2);
    case 'time':
      return timeText(v, level);
    case 'ms':
      return realTimeText(v);
    case 'count': {
      const r = Math.round(v);
      return `${groupDigits(r)} ${r === 1 || r === -1 ? slot.arg1 : slot.arg2}`;
    }
    default:
      return groupDigits(Math.round(v));
  }
}

function pick(e: CopyEntry, level: CopyLevel, sign: number): string {
  if (sign < 0) {
    const less = level === 'kid' ? e.kidLess : e.adultLess;
    if (less) return less;
  }
  return level === 'kid' ? e.kid : e.adult;
}

/** Fills a template's slots from `data`. */
export function fill(template: string, level: CopyLevel, data: CopyData = {}): string {
  return template.replace(SLOT, (_m, name: string, fmt?: string, a1?: string, a2?: string) =>
    formatSlot({ name, fmt: fmt ?? '', arg1: a1 ?? '', arg2: a2 ?? '' }, data[name], level),
  );
}

export function hasCopy(key: string): boolean {
  return COPY[key] !== undefined;
}

/**
 * The words for `key` at `level`, filled from `data`. `sign` < 0 picks the
 * "Less" wording where there is one. Keys of the form `<key>.kid` and
 * `<key>.adult` (advisors.ts advisorCopyKeys) name their own level. An
 * unknown key returns itself, so a gap is visible in development; the copy
 * test keeps there being none.
 */
export function say(key: string, level: CopyLevel, data: CopyData = {}, sign = 1): string {
  let k = key;
  let lv = level;
  if (!COPY[k]) {
    if (k.endsWith('.kid')) [k, lv] = [k.slice(0, -4), 'kid'];
    else if (k.endsWith('.adult')) [k, lv] = [k.slice(0, -6), 'adult'];
  }
  const e = COPY[k];
  if (!e) return key;
  return fill(pick(e, lv, sign), lv, data);
}

// ---- The Why engine's words (§5.19) --------------------------------------------------------------

/** Families of quantities whose member names another copy list (arrive.wL → cohort.wL). */
const MEMBER_PREFIX: Record<string, string> = { arrive: 'cohort', depart: 'cohort', meter: 'meter', line: 'ledger', happy: 'cohort' };

function memberOf(q: string): { family: string; member: string } | null {
  const dot = q.indexOf('.');
  if (dot < 0) return null;
  return { family: q.slice(0, dot), member: q.slice(dot + 1) };
}

/** The copy key that names quantity `q`: its own, or its family's. */
export function quantityKey(q: string): string | null {
  if (COPY[`why.q.${q}`]) return `why.q.${q}`;
  const m = memberOf(q);
  if (m && MEMBER_PREFIX[m.family] && COPY[`why.q.${m.family}`] && COPY[`${MEMBER_PREFIX[m.family]}.${m.member}`]) return `why.q.${m.family}`;
  return null;
}

/** "How happy Families are", "People", "Homes tax". */
export function quantityLabel(q: string, level: CopyLevel): string {
  const key = quantityKey(q);
  if (!key) return q;
  return say(key, level, { who: memberOf(q)?.member ?? '' });
}

/**
 * One Why term's words, e.g. kid "Good schools brought Families." or adult
 * "+212 from the Schools star". `quantity` names the family member the
 * term explains (arrive.fM → Families), and the amount's sign picks the
 * wording.
 */
export function whyTermText(key: string, amount: number, quantity: string, level: CopyLevel): string {
  const m = memberOf(quantity);
  const data: CopyData = { n: Math.abs(amount), amount, who: m?.member ?? '' };
  return say(`why.${key}`, level, data, amount);
}

/**
 * A whole Why row (§9.6: "top 3 causes with arrows and amounts"): kids see
 * an arrow and the words, adults the signed amount in the quantity's unit
 * first ("+£4,200 homes tax", "−22 smoke").
 */
export function whyLine(key: string, amount: number, quantity: string, level: CopyLevel): string {
  const words = whyTermText(key, amount, quantity, level);
  if (level === 'kid') return `${amount >= 0 ? '↑' : '↓'} ${words}`;
  const unit = QUANTITIES.find((q) => q.id === quantity)?.unit;
  const r = Math.round(amount);
  const n = unit === '£' ? (r > 0 ? '+' + formatPounds(r) : formatPounds(r)) : signedText(amount);
  return `${n} ${words}`;
}

// ---- Cards ----------------------------------------------------------------------------------------

/** An advisor card's line and button (§9.7): one sentence and one action. */
export function advisorText(ruleId: string, level: CopyLevel): { advisor: string; line: string; button: string } {
  const rule = ADVISOR_RULES.find((r) => r.id === ruleId);
  return {
    advisor: rule ? say(`advisorName.${rule.advisor}`, level) : '',
    line: say(`advisor.${ruleId}`, level),
    button: rule ? say(`action.${rule.action}`, level) : '',
  };
}

/** A wants bubble's words (§5.15). */
export function wantText(key: string, level: CopyLevel): string {
  return say(`want.${key}`, level);
}

/** A standing order as an "if … then …" card (§5.18), adult thresholds filled from its args. */
export function orderText(kind: string, args: readonly number[], level: CopyLevel): string {
  const data: CopyData = {};
  args.forEach((a, i) => (data[`a${i}`] = a));
  return say(`order.${kind}`, level, data);
}

// ---- The checklist: every key the engine's registries need ------------------------------------------

/**
 * Every copy key the game needs, generated from the registries (§13.2 WP8:
 * "generated as a checklist from the term registry"). The test asserts each
 * one has both levels; a package that adds a term, a rule, a building or a
 * want key shows up here as missing copy until WP8 writes it.
 */
export function requiredCopyKeys(): string[] {
  const keys: string[] = [];
  const add = (...ks: string[]) => keys.push(...ks);
  for (const t of TERMS) add(`why.${t.key}`);
  add('why.rest', 'why.title', 'why.none');
  for (const k of advisorCopyKeys()) if (k.endsWith('.kid')) add(k.slice(0, -4));
  for (const a of ['bramble', 'penny', 'mo', 'zia']) add(`advisorName.${a}`);
  for (const a of new Set(ADVISOR_RULES.map((r) => r.action))) add(`action.${a}`);
  for (const w of WANT_KEYS) add(`want.${w}`);
  for (const k of TALK_KEYS) add(`talk.${k}`);
  add('talk.say');
  for (const s of STARS) add(`star.${s}`, `starAbout.${s}`);
  for (const f of FACES) add(`face.${f}`);
  for (const c of COHORTS) add(`cohort.${c}`);
  for (let h = 0; h < 3; h++) add(`wealth.${h}`);
  for (const m of METERS) add(`meter.${m}`);
  add('meter.hatched');
  for (const l of LEDGER_LINES) add(`ledger.${l}`);
  for (const it of NEED_ITEMS) add(`need.${it.id}`);
  for (const list of CHECKLISTS) for (const it of list) add(`check.${it.id}`);
  for (let t = 0; t < TIER_DEFS.length; t++) add(`tier.${t}`, `tierUp.${t}`);
  add('title.greatMetropolis');
  for (const b of BUILDINGS) add(`buildingName.${b.id}`, `building.${b.id}`);
  for (const z of ZONES) add(`zoneName.${z}`, `zone.${z}`);
  for (const r of ROAD_DEFS) add(`roadName.${r.id}`, `road.${r.id}`);
  add('roadName.rail', 'road.rail');
  for (const p of POLICIES) add(`policyName.${p.id}`, `policy.${p.id}`);
  for (const e of EVENTS) add(`eventName.${e.id}`, `event.${e.id}`);
  for (const o of ORDER_DEFAULTS) add(`order.${o.kind}`);
  for (const d of DEPUTY_NOTES) add(`deputy.${d}`);
  add('inbox.promotion', 'inbox.title');
  for (const k of Object.keys(CARD_SLOTS)) add(k);
  for (const l of LENS_IDS) add(`lensName.${l}`, `lens.${l}`);
  for (const t of TRAY_IDS) add(`tray.${t}`);
  for (const s of SITE_KINDS) add(`site.${s}`);
  for (const a of AVATARS) add(`avatar.${a}`);
  for (let f = 0; f < FLAG_COUNT; f++) add(`flag.${f}`);
  for (const f of FUNDING_KEYS) add(`funding.${f}`);
  for (const g of ['safety', 'learning', 'fun']) add(`fundingGroup.${g}`);
  for (let l = 0; l < 3; l++) add(`fundingLevel.${l}`);
  for (const t of ['town', 'homes', 'business', 'sales', 'hotel']) add(`tax.${t}`);
  // Quantities: each must resolve to a label, its own or its family's.
  for (const q of QUANTITIES) add(quantityKey(q.id) ?? `why.q.${q.id}`);
  add(...SCRIPT_KEYS);
  return [...new Set(keys)];
}

/** The fixed lines of the founding, tutorial, forecast, undo and Deputy scripts (§1.5, §9.3, §9.8). */
export const SCRIPT_KEYS: readonly string[] = [
  // Founding (§1.5 step 1, §9.11)
  'founding.title', 'founding.pickSite', 'founding.siteTaken', 'founding.reroll', 'founding.nameTitle', 'founding.nameFirst', 'founding.nameSecond',
  'founding.nameTyped', 'founding.nameWaiting', 'founding.pickAvatar', 'founding.pickFlag', 'founding.confirm', 'founding.done',
  // Bramble's three steps (§1.5 step 2, A12)
  'tutorial.hello', 'tutorial.road', 'tutorial.roadDone', 'tutorial.homes', 'tutorial.homesMore', 'tutorial.homesDone', 'tutorial.farms', 'tutorial.well', 'tutorial.farmsDone',
  'tutorial.buildIt', 'tutorial.ghosts',
  // The Founding Fortnight (§1.5 step 3–4, §2.3)
  'sprint.next', 'sprint.playAll', 'sprint.wait', 'sprint.left', 'sprint.payDay', 'sprint.arrived', 'sprint.wantShop', 'sprint.special', 'sprint.done', 'sprint.auto',
  // Forecast card (§9.8)
  'forecast.cost', 'forecast.money', 'forecast.people', 'forecast.happier', 'forecast.lessHappy', 'forecast.sameHappy', 'forecast.ready', 'forecast.estimate',
  'forecast.homesBuilding', 'forecast.movers', 'forecast.refused', 'forecast.working', 'forecast.buildIt', 'forecast.afford', 'forecast.affordLater',
  // Undo (§9.3)
  'undo.title', 'undo.button', 'undo.refund', 'undo.done', 'undo.blocked', 'undo.tooLate', 'undo.empty',
  // Plan and build (§9.3)
  'plan.noRoad', 'plan.bulldozeConfirm', 'plan.bulldozePrivate', 'plan.bulldozeRefund', 'lock.unlocksAt', 'lock.unlocksAtTier',
  // Bramble's housekeeping (§9.7, §9.14)
  'bramble.break', 'bramble.sessionEnd', 'bramble.welcome', 'bramble.ordersIntro', 'bramble.ordersOn', 'bramble.ordersOff',
  // Helper Mode (§5.13, A16)
  'helper.title', 'helper.on', 'helper.steps', 'helper.off',
  // Wants bar and Why sheet chrome
  'wants.title', 'wants.none', 'why.ask', 'why.tapAny',
];
