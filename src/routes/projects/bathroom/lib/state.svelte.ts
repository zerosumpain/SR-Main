// One shared store for the whole planner: the room, the spec, the ticked snags
// and the edited brief. It lives in this browser only — nothing is sent
// anywhere, which is also why two people planning together do not see each
// other's ticks.

import { browser } from '$app/environment';
import { defaultPlan, foot, notchRect, overlap, place, type Item, type Plan } from './fixtures';
import { defaultCost, type CostState } from './cost';
import { applyPreset } from './presets';
import type { JobSize } from './content';

const KEY = 'sr-bathroom-v1';

export interface Store {
  plan: Plan;
  cost: CostState;
  snags: Record<string, boolean>;
  hand: Record<string, boolean>;
  prog: { size: JobSize; start: string };
  brief: string;
  address: string;
  seeded: boolean;
}

const fresh = (): Store => ({
  plan: defaultPlan(),
  cost: defaultCost(),
  snags: {},
  hand: {},
  prog: { size: 'standard', start: '' },
  brief: '',
  address: '',
  seeded: false,
});

export const s = $state<Store>(fresh());

/** The currently selected fitting, if any. Never persisted. */
export const ui = $state<{ sel: number | null }>({ sel: null });

// Plain `let`, not $state — an internal handle nothing renders. A $state timer
// that a function both reads and writes is the classic effect_update_depth trap.
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const isLoaded = () => loaded;

/** Read once on mount. Missing or corrupt storage just leaves the defaults. */
export function hydrate() {
  if (!browser || loaded) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      const base = fresh();
      s.plan = { ...base.plan, ...(parsed.plan ?? {}) };
      s.cost = {
        ...base.cost,
        ...(parsed.cost ?? {}),
        items: { ...base.cost.items, ...(parsed.cost?.items ?? {}) },
      };
      s.snags = parsed.snags ?? {};
      s.hand = parsed.hand ?? {};
      s.prog = { ...base.prog, ...(parsed.prog ?? {}) };
      s.brief = parsed.brief ?? '';
      s.address = parsed.address ?? '';
      s.seeded = parsed.seeded ?? false;
    }
  } catch {
    // A broken payload is not worth blocking the page for.
  }
  if (!s.plan.items.length && !s.seeded) {
    s.seeded = true;
    s.plan.items = applyPreset(s.plan, 'classic');
  }
  loaded = true;
}

/** Debounced write. Safe to call from anywhere, including a render effect. */
export function persist() {
  if (!browser || !loaded) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Private-mode quota failures are not worth a dialog.
    }
  }, 200);
}

export function resetAll() {
  const base = fresh();
  s.plan = base.plan;
  s.cost = base.cost;
  s.snags = {};
  s.hand = {};
  s.prog = base.prog;
  s.brief = '';
  s.address = '';
  s.seeded = true;
  s.plan.items = applyPreset(s.plan, 'classic');
  ui.sel = null;
  persist();
}

/* ——— plan mutations, all snapped and clamped through place() ——— */

export function addItem(t: string): Item {
  const it: Item = { id: s.plan.seq++, t, x: 0, y: 0, r: 0 };
  // Drop it in the first clear slot rather than always on top of the bath.
  outer: for (let y = 0; y <= s.plan.D; y += 50)
    for (let x = 0; x <= s.plan.W; x += 50) {
      it.x = x;
      it.y = y;
      if (fits(it)) break outer;
    }
  place(s.plan, it, it.x, it.y);
  s.plan.items = [...s.plan.items, it];
  ui.sel = it.id;
  persist();
  return it;
}

function fits(it: Item): boolean {
  const b = foot(it);
  if (b.x + b.w > s.plan.W || b.y + b.h > s.plan.D) return false;
  const nr = notchRect(s.plan);
  if (nr && overlap(b, nr) > 0) return false;
  return !s.plan.items.some((o) => overlap(foot(o), b) > 0);
}

export function removeItem(id: number) {
  s.plan.items = s.plan.items.filter((i) => i.id !== id);
  if (ui.sel === id) ui.sel = null;
  persist();
}

export function rotateItem(id: number) {
  const it = s.plan.items.find((i) => i.id === id);
  if (!it) return;
  const b = foot(it);
  const cx = it.x + b.w / 2;
  const cy = it.y + b.h / 2;
  it.r = ((it.r + 90) % 360) as Item['r'];
  const nb = foot(it);
  place(s.plan, it, cx - nb.w / 2, cy - nb.h / 2);
  persist();
}

export function loadPreset(key: Parameters<typeof applyPreset>[1]) {
  s.plan.items = applyPreset(s.plan, key);
  ui.sel = null;
  persist();
}

export function clearRoom() {
  s.plan.items = [];
  ui.sel = null;
  persist();
}

/** Re-snap everything after the room changes shape. */
export function reflow() {
  for (const it of s.plan.items) place(s.plan, it, it.x, it.y);
  persist();
}
