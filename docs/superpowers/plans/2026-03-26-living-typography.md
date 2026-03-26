# Living Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `use:livingType` Svelte action that makes homepage headlines breathe with heart rate and skew with wind.

**Architecture:** A single `use:action` in `src/lib/biome/actions.ts` runs a `requestAnimationFrame` loop, reading biome store state each frame. It modulates `letter-spacing` via `cardiacPulse()` and `skewX` via wind data (with a manual lerp for smooth wind transitions). Applied to 5 `.display` elements on the homepage, gated by the existing `biomeVisible` toggle.

**Tech Stack:** Svelte 5 actions, `cardiacPulse()` from `$lib/biome/state`, `performance.now()` for timing, CSS `letter-spacing` + `transform: skewX()`

**Spec:** `docs/superpowers/specs/2026-03-26-living-typography-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/biome/actions.ts` | Create | `livingType` action + pure helper functions (`computeWindSkew`, `LIVING_TYPE_DEFAULTS`) |
| `tests/lib/biome/actions.test.ts` | Create | Unit tests for `computeWindSkew` and action integration |
| `src/routes/+page.svelte` | Modify (lines 19, 58, 74, 118, 124, 130) | Import action, apply `use:livingType` to 5 headline elements |

---

### Task 1: Pure helper — `computeWindSkew`

**Files:**
- Create: `tests/lib/biome/actions.test.ts`
- Create: `src/lib/biome/actions.ts`

- [ ] **Step 1: Write failing tests for `computeWindSkew`**

```typescript
// tests/lib/biome/actions.test.ts
import { describe, it, expect } from 'vitest';
import { computeWindSkew } from '$lib/biome/actions';

describe('computeWindSkew', () => {
  it('returns 0 for calm wind', () => {
    expect(computeWindSkew(0, 0)).toBe(0);
  });

  it('returns 0 for northerly wind (no east-west component)', () => {
    expect(computeWindSkew(0, 20)).toBeCloseTo(0, 5);
  });

  it('returns 0 for southerly wind (no east-west component)', () => {
    expect(computeWindSkew(180, 20)).toBeCloseTo(0, 3);
  });

  it('returns negative skew for easterly wind (90deg)', () => {
    // Wind FROM the east: text leans with the wind (westward = negative skew)
    const skew = computeWindSkew(90, 30);
    expect(skew).toBeLessThan(0);
    expect(Math.abs(skew)).toBeCloseTo(3, 0);
  });

  it('returns positive skew for westerly wind (270deg)', () => {
    // Wind FROM the west: text leans eastward = positive skew
    const skew = computeWindSkew(270, 30);
    expect(skew).toBeGreaterThan(0);
    expect(Math.abs(skew)).toBeCloseTo(3, 0);
  });

  it('clamps speed at 30 km/h — higher speed does not increase skew', () => {
    const at30 = computeWindSkew(90, 30);
    const at50 = computeWindSkew(90, 50);
    expect(at30).toBeCloseTo(at50, 5);
  });

  it('scales linearly with speed below 30', () => {
    const at15 = computeWindSkew(90, 15);
    const at30 = computeWindSkew(90, 30);
    expect(at15).toBeCloseTo(at30 / 2, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/biome/actions.test.ts`
Expected: FAIL — `Cannot find module '$lib/biome/actions'`

- [ ] **Step 3: Implement `computeWindSkew` and constants**

```typescript
// src/lib/biome/actions.ts
const MAX_SKEW_DEG = 3;
const MAX_WIND_SPEED = 30;

/**
 * Compute wind skew in degrees from wind direction and speed.
 * Uses the east-west component only (sin of direction).
 * Meteorological convention: direction is "from", so we negate
 * to get the direction the wind pushes (text leans with the wind).
 */
export function computeWindSkew(directionDeg: number, speed: number): number {
  if (speed <= 0) return 0;
  const rad = (directionDeg * Math.PI) / 180;
  const ewComponent = -Math.sin(rad); // negate: wind FROM east pushes west
  const speedFactor = Math.min(speed, MAX_WIND_SPEED) / MAX_WIND_SPEED;
  return MAX_SKEW_DEG * ewComponent * speedFactor;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/biome/actions.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/biome/actions.ts tests/lib/biome/actions.test.ts
git commit -m "feat(biome): add computeWindSkew helper for living typography"
```

---

### Task 2: The `livingType` action

**Files:**
- Modify: `src/lib/biome/actions.ts`
- Modify: `tests/lib/biome/actions.test.ts`

- [ ] **Step 1: Write failing test for the action**

The action needs DOM and `requestAnimationFrame`. Use `jsdom` (already a devDependency) with `vi.stubGlobal` for rAF. Add to the existing test file:

Add `// @vitest-environment jsdom` at the very top of the test file (before all imports) to enable DOM APIs. Then add the action tests below the existing `computeWindSkew` tests:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeWindSkew, livingType } from '$lib/biome/actions';
import type { BiomeStore } from '$lib/biome/store.svelte';
import { BIOME_DEFAULTS } from '$lib/biome/state';

// ... existing computeWindSkew tests ...

describe('livingType action', () => {
  let node: HTMLElement;
  let rafCallbacks: FrameRequestCallback[];
  let rafId: number;

  function mockStore(overrides: Partial<typeof BIOME_DEFAULTS> = {}): BiomeStore {
    const state = { ...BIOME_DEFAULTS, ...overrides };
    return { state } as unknown as BiomeStore;
  }

  beforeEach(() => {
    node = document.createElement('p');
    node.style.letterSpacing = '-0.02em';
    rafCallbacks = [];
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRaf(time = 500) {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    cbs.forEach(cb => cb(time));
  }

  it('modifies letter-spacing when enabled', () => {
    const store = mockStore({ pulse: 72, stale: false, sources: { heartRate: true, weather: true } });
    const action = livingType(node, () => ({ store, enabled: true }));
    flushRaf(500);
    // letter-spacing should have been set (exact value depends on cardiacPulse math)
    expect(node.style.letterSpacing).toBeDefined();
    action.destroy();
  });

  it('resets styles when disabled', () => {
    const store = mockStore({ pulse: 72, stale: false, sources: { heartRate: true, weather: true } });
    const action = livingType(node, () => ({ store, enabled: false }));
    flushRaf(500);
    expect(node.style.letterSpacing).toBe('');
    expect(node.style.transform).toBe('');
    action.destroy();
  });

  it('is a no-op when prefers-reduced-motion is set', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const store = mockStore({ pulse: 90 });
    const action = livingType(node, () => ({ store, enabled: true }));
    flushRaf(500);
    expect(node.style.letterSpacing).toBe('');
    action.destroy();
  });

  it('applies skewX for windy conditions', () => {
    const store = mockStore({
      weather: { condition: 'clear', temp: 15, windSpeed: 25, windDirection: 90 },
    });
    const action = livingType(node, () => ({ store, enabled: true }));
    // Run several frames to let the manual lerp progress
    for (let i = 0; i < 120; i++) flushRaf(i * 16.67);
    const transform = node.style.transform;
    expect(transform).toContain('skewX(');
    action.destroy();
  });

  it('uses reduced intensity when data is stale', () => {
    const freshStore = mockStore({ pulse: 72, stale: false, sources: { heartRate: true, weather: true } });
    const staleStore = mockStore({ pulse: 72, stale: true, sources: { heartRate: true, weather: true } });

    const freshNode = document.createElement('p');
    const staleNode = document.createElement('p');

    const freshAction = livingType(freshNode, () => ({ store: freshStore, enabled: true }));
    const staleAction = livingType(staleNode, () => ({ store: staleStore, enabled: true }));

    // Run at a time that hits a beat peak (near phase=0)
    flushRaf(100);

    const freshSpacing = parseFloat(freshNode.style.letterSpacing);
    const staleSpacing = parseFloat(staleNode.style.letterSpacing);

    // Fresh data should produce larger letter-spacing modulation than stale
    // Both should be >= base (-0.02), fresh should be further from base
    expect(freshSpacing).toBeGreaterThanOrEqual(staleSpacing);

    freshAction.destroy();
    staleAction.destroy();
  });

  it('does not apply transform for near-zero wind', () => {
    const store = mockStore({
      weather: { condition: 'clear', temp: 15, windSpeed: 0.1, windDirection: 90 },
    });
    const action = livingType(node, () => ({ store, enabled: true }));
    for (let i = 0; i < 10; i++) flushRaf(i * 16.67);
    // Skew target is 3 * -1 * (0.1/30) = -0.01 — right at the threshold
    // After a few frames of lerping, currentSkew should still be < 0.01
    expect(node.style.transform).toBe('');
    action.destroy();
  });

  it('cancels rAF on destroy', () => {
    const store = mockStore();
    const action = livingType(node, () => ({ store, enabled: true }));
    action.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/biome/actions.test.ts`
Expected: FAIL — `livingType` not exported / not implemented

- [ ] **Step 3: Implement the `livingType` action**

Add to `src/lib/biome/actions.ts` below the existing `computeWindSkew`:

```typescript
import { cardiacPulse } from './state';
import type { BiomeStore } from './store.svelte';

// ... existing computeWindSkew code ...

const BASE_LETTER_SPACING = -0.02; // em — matches .display in app.css
const BREATH_RANGE = 0.01; // em — max expansion at peak beat
const NORMAL_INTENSITY = 40;
const STALE_INTENSITY = 20;
const WIND_LERP_SPEED = 0.002; // per ms — ~2s to reach target

export function livingType(
  node: HTMLElement,
  params: () => { store: BiomeStore; enabled: boolean }
): { destroy: () => void } {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    return { destroy: () => {} };
  }

  let rafHandle = 0;
  let lastTime = 0;
  let currentSkew = 0; // manual lerp state
  let startTime = 0;

  function loop(time: number) {
    if (startTime === 0) startTime = time;
    const { store, enabled } = params();

    if (!enabled) {
      node.style.letterSpacing = '';
      node.style.transform = '';
      currentSkew = 0;
      lastTime = time;
      rafHandle = requestAnimationFrame(loop);
      return;
    }

    const dt = lastTime > 0 ? time - lastTime : 16;
    lastTime = time;
    const elapsed = (time - startTime) / 1000; // seconds for cardiacPulse

    // --- Breathing ---
    const { pulse, stale, sources } = store.state;
    const intensity = (stale || !sources.heartRate) ? STALE_INTENSITY : NORMAL_INTENSITY;
    const beat = cardiacPulse(elapsed, pulse, intensity);
    const letterSpacing = BASE_LETTER_SPACING + beat * BREATH_RANGE;
    node.style.letterSpacing = `${letterSpacing}em`;

    // --- Wind skew (manual lerp) ---
    const { windSpeed, windDirection } = store.state.weather;
    const targetSkew = computeWindSkew(windDirection, windSpeed);
    const lerpFactor = 1 - Math.exp(-WIND_LERP_SPEED * dt);
    currentSkew += (targetSkew - currentSkew) * lerpFactor;
    // Only apply transform if skew is noticeable (avoid sub-pixel jank)
    if (Math.abs(currentSkew) > 0.01) {
      node.style.transform = `skewX(${currentSkew.toFixed(3)}deg)`;
    } else {
      node.style.transform = '';
    }

    rafHandle = requestAnimationFrame(loop);
  }

  rafHandle = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafHandle);
      node.style.letterSpacing = '';
      node.style.transform = '';
    },
  };
}
```

Note: Uses a manual exponential lerp (`1 - e^(-speed * dt)`) instead of `Tween` from `svelte/motion`. This avoids reactive-context issues (Tween uses `$effect` internally) and keeps the action self-contained — one rAF loop handles everything.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/biome/actions.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/biome/actions.ts tests/lib/biome/actions.test.ts
git commit -m "feat(biome): add livingType action — breathing + wind skew"
```

---

### Task 3: Wire up the action on the homepage

**Files:**
- Modify: `src/routes/+page.svelte` (lines 14, 58, 74, 118, 124, 130)

- [ ] **Step 1: Import the action**

Add after the existing imports in `src/routes/+page.svelte` (after line 20):

```typescript
  import { livingType } from '$lib/biome/actions';
```

- [ ] **Step 2: Apply `use:livingType` to the 5 target elements**

Element 1 — "STRANGE RAMBLINGS" wordmark (line 58):

```svelte
    <a href="/" class="display text-[28px] sm:text-[32px] leading-none no-underline" style="color: var(--text-primary);" use:livingType={() => ({ store, enabled: biomeVisible })}>
```

Element 2 — BPM number (line 74):

```svelte
        <p class="display text-[64px] sm:text-[96px] md:text-[120px]" style="color: var(--accent);" use:livingType={() => ({ store, enabled: biomeVisible })}>
```

Element 3 — "PULSE" header (line 118):

```svelte
          <p class="display text-[20px] mb-2" style="color: var(--text-primary);" use:livingType={() => ({ store, enabled: biomeVisible })}>PULSE</p>
```

Element 4 — "WEATHER" header (line 124):

```svelte
          <p class="display text-[20px] mb-2" style="color: var(--text-primary);" use:livingType={() => ({ store, enabled: biomeVisible })}>WEATHER</p>
```

Element 5 — "RECOVERY" header (line 130):

```svelte
          <p class="display text-[20px] mb-2" style="color: var(--text-primary);" use:livingType={() => ({ store, enabled: biomeVisible })}>RECOVERY</p>
```

- [ ] **Step 3: Run typecheck**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20`
Expected: No errors related to `livingType` or `actions.ts`

- [ ] **Step 4: Run all biome tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/biome/`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/+page.svelte
git commit -m "feat(biome): apply livingType action to homepage headlines"
```

---

### Task 4: Manual visual verification

- [ ] **Step 1: Start dev server**

Run: `cd ~/strange_rambling_svelte && npx vite dev --host 0.0.0.0`

- [ ] **Step 2: Open homepage and verify**

Open `http://homeserv:5173` in a browser. Check:
- Headlines have a subtle letter-spacing pulse synced to the BPM shown
- If wind speed > 0, headlines lean slightly
- Toggling biome off (bottom-right button) resets all text to normal
- Toggling biome back on resumes the effects
- No visible jank or layout shift

- [ ] **Step 3: Stop dev server and commit any tweaks**

If any intensity/range values need tuning, adjust the constants in `src/lib/biome/actions.ts` (`BREATH_RANGE`, `NORMAL_INTENSITY`, `MAX_SKEW_DEG`, `WIND_LERP_SPEED`) and commit.
