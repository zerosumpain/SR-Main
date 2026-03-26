# Living Typography

Headlines on the homepage subtly respond to biome state via a single Svelte `use:action` directive — letter-spacing breathes with heart rate, and text skews with wind.

## Signals and Effects

| Biome signal | CSS property | Range |
|---|---|---|
| Pulse (BPM) | `letter-spacing` | `-0.02em` (base) to `~-0.01em` (peak of beat) |
| Weather: wind | `transform: skewX()` | `0deg` (calm) to `~3deg` (strong wind) |

## The Action: `use:livingType`

A single combined action that handles both effects, sharing one `requestAnimationFrame` loop.

### Svelte 5 action contract

Uses the Svelte 5 function-parameter pattern (not the legacy `update` return):

```typescript
export function livingType(
  node: HTMLElement,
  params: () => { store: BiomeStore; enabled: boolean }
): { destroy: () => void }
```

Template usage:

```svelte
<p class="display" use:livingType={() => ({ store, enabled: biomeVisible })}>
```

The params function is called by the action each rAF frame to get current values. This is intentionally non-reactive (no `$effect`) — the rAF loop already polls at display refresh rate, so reactive subscriptions would be redundant.

### Breathing (letter-spacing)

- Each frame, reads `store.state.pulse` and computes expansion using the existing `cardiacPulse(time, bpm, intensity)` function from `$lib/biome/state`
- Normal intensity: 40 (perceptible but subtle). When `store.state.stale` is true or `store.state.sources.heartRate` is false, reduces to 20 — still alive but muted
- Modulates `letter-spacing` from the CSS baseline `-0.02em` by adding up to `+0.01em` at the peak of each beat
- At 60 BPM: one gentle pulse per second. At 90 BPM: noticeably quicker

### Wind skew (transform)

- Each rAF frame, compares current wind values to previously seen values
- When wind changes, starts a `Tween` (Svelte 5 `svelte/motion`) to the new target skew
- Wind direction mapping: `skewDeg = maxSkew * sin(directionRad) * clamp(speed / 30, 0, 1)` — only the east-west component of wind produces horizontal skew. Northerly/southerly winds produce zero skew.
- Max skew: 3 degrees
- Tween duration: 2000ms with `cubicOut` easing

### Destroy and re-init

- `destroy()` cancels the rAF loop, resets `letter-spacing` and `transform` to defaults
- Elements inside `ScrollReveal` may unmount/remount — the action handles this cleanly since each mount creates a fresh rAF loop and each unmount cancels it

### Reduced motion

Checks `window.matchMedia('(prefers-reduced-motion: reduce)')` on init. If true, becomes a no-op (never modifies styles, never starts rAF). Matches existing biome tier detection.

## New File

`src/lib/biome/actions.ts` — contains the `livingType` action function.

## Integration Points

### Elements that receive the action (all in `src/routes/+page.svelte`)

1. "STRANGE RAMBLINGS" wordmark (top-left `<a>`)
2. BPM number (hero center `<p class="display">`)
3. "PULSE", "WEATHER", "RECOVERY" biome section headers

The footer wordmark is excluded — it's below the fold and outside the biome visual area.

### Toggle integration

The `biomeVisible` state already exists in `+page.svelte`, driven by `localStorage` + the `biome-toggle` CustomEvent. The action receives `enabled: biomeVisible` via the params function — when toggled off, it resets styles to CSS defaults and skips computation (rAF still runs but exits early).

## Scope boundaries

- Only affects `src/routes/+page.svelte` (homepage)
- One new file: `src/lib/biome/actions.ts`
- No changes to the biome store, API, or other components
- No new CSS classes or font loading
- No changes to other pages (blog, health, admin)
