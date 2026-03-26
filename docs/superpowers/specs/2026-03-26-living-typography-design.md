# Living Typography

Headlines on the homepage subtly respond to biome state via two Svelte `use:action` directives — letter-spacing breathes with heart rate, and text skews with wind.

## Signals and Effects

| Biome signal | Action | CSS property | Range |
|---|---|---|---|
| Pulse (BPM) | `use:breathe` | `letter-spacing` | `-0.02em` (base) to `~-0.01em` (peak of beat) |
| Weather: wind | `use:windSkew` | `transform: skewX()` | `0deg` (calm) to `~3deg` (strong wind) |

### `breathe`

- Runs a `requestAnimationFrame` loop internally
- Each frame, reads `store.state.pulse` and computes expansion using the existing `cardiacPulse(time, bpm, intensity)` function from `$lib/biome/state`
- Intensity fixed at ~40 (perceptible but subtle)
- Modulates `letter-spacing` from the CSS baseline `-0.02em` by adding up to `+0.01em` at the peak of each beat
- At 60 BPM: one gentle pulse per second. At 90 BPM: noticeably quicker

### `windSkew`

- Uses `svelte/motion` `tweened()` for smooth interpolation when wind changes
- Reads `store.state.weather.windSpeed` and `store.state.weather.windDirection`
- Maps wind direction to skew sign (westerly = positive skew, easterly = negative)
- Maps wind speed to magnitude: `0 km/h` = `0deg`, `30+ km/h` = `~3deg`
- Tweened duration: 2000ms with easeOut, so transitions feel organic

## New File

`src/lib/biome/actions.ts` — contains both action functions.

Each action signature:

```typescript
export function breathe(node: HTMLElement, params: { store: BiomeStore; enabled: boolean }): ActionReturn
export function windSkew(node: HTMLElement, params: { store: BiomeStore; enabled: boolean }): ActionReturn
```

### Action contract

- `update(params)`: called when params change (e.g., `enabled` toggles). If `enabled` becomes false, reset styles to defaults and stop animation.
- `destroy()`: cancel rAF, reset styles, clean up tweened subscription.

## Integration Points

### Elements that receive actions (all in `src/routes/+page.svelte`)

1. "STRANGE RAMBLINGS" wordmark (top-left `<a>`)
2. BPM number (hero center `<p class="display">`)
3. "PULSE", "WEATHER", "RECOVERY" biome section headers

### Toggle integration

The `biomeVisible` state already exists in `+page.svelte`, driven by `localStorage` + the `biome-toggle` CustomEvent. Both actions receive `enabled: biomeVisible` — when toggled off, they reset to CSS defaults.

### Reduced motion

Both actions check `window.matchMedia('(prefers-reduced-motion: reduce)')` on init. If true, they become no-ops (never modify styles). This matches the existing biome tier detection in `store.svelte.ts`.

## Scope boundaries

- Only affects `src/routes/+page.svelte` (homepage)
- No changes to the biome store, API, or other components
- No new CSS classes or font loading
- No changes to other pages (blog, health, admin)
