---
name: svelte5-pitfalls
description: Use when writing ANY Svelte component or debugging Svelte 5 runes code ($state/$effect/$derived) in this SvelteKit project — before writing the first line of a .svelte file, and on effect_update_depth_exceeded, state_referenced_locally warnings, a page that never finishes hydrating, onMount that never runs, a UI that locks up on interaction, or a build that fails after adding a CSS import.
---

# Svelte 5 — baseline syntax + pitfalls (from production incidents)

## 0. Baseline: these codebases are PURE runes mode — zero legacy syntax

373+ components, not one legacy usage. Writing Svelte 4 syntax here introduces the first. Use ONLY the right column:

| Never write (Svelte 4) | Always write (Svelte 5) |
|---|---|
| `export let foo` | `let { foo } = $props()` |
| `on:click={fn}` / `on:input` | `onclick={fn}` / `oninput` |
| `$: x = y * 2` | `const x = $derived(y * 2)` |
| `$: { sideEffect() }` | `$effect(() => { sideEffect() })` |
| `<slot />` / `<slot name="x">` | `{@render children()}` / snippet props |
| `createEventDispatcher()` | callback props (`let { onDone } = $props()`) |
| writable/readable stores for local state | `$state(...)` |

Before inventing a pattern, open 2 existing components in the same route/lib dir and copy their conventions.

Both major traps are forms of **"an effect reading what it just wrote."** Cost when missed: hours of surface-level patching. Check these BEFORE other theories.

## 1. Never `$state` an internal handle

`setTimeout`/`setInterval` handles, `requestAnimationFrame` IDs, `AbortController`, EventSource/WebSocket refs, observers, pending-batch Maps → plain `let`, never `$state`.

If a function reads AND writes such a `$state` var and is called from a `$effect`, the effect subscribes to it, the write re-triggers, and Svelte throws `effect_update_depth_exceeded` after ~200 loops (symptom: multi-second UI lock).

**Test before declaring `$state`:** does the template, a `$derived`, or another reactive context read it? If no — plain `let`.

**Audit grep:** any `$state` var both read and assigned inside a `start*`/`stop*`/`cleanup*`/`close*`/`flush*` function.

## 2. Prop→state sync effects: hoist reads, wrap body in `untrack`

Syncing prop data into local `$state` inside `$effect` re-tracks the freshly created proxy on each reassignment and can loop once more consumers mount (symptom: hydration never completes, child `onMount` never fires):

```ts
import { untrack } from 'svelte';

$effect(() => {
  // 1. Tracked reads — ONLY the props signalling "data refreshed"
  const sourceBuild = data.build;
  // 2. Everything else (condition + writes) untracked
  untrack(() => {
    if (sourceBuild && sourceBuild.id === build.id) {
      build = { ...build, ...sourceBuild };
    }
  });
});
```

Without `untrack`, the condition's `build.id` read subscribes the effect to the proxy it reassigns.

## 3. Other known breaks

- **Threlte/`useTask`**: nested arrays in `$state` inside component scripts break — move the data to an external `.ts` module.
- **@vite-pwa builds**: a standalone `import './x.css'` from a route file breaks `npm run build` (service-worker `swSrc` ENOENT) while `svelte-check` passes clean. Put shared CSS in the global `app.css`.
- **`svelte-check` OOM** on large projects: prefix with `NODE_OPTIONS=--max-old-space-size=8192`.

## Red flags — stop and check rules 1–2

- `effect_update_depth_exceeded` in console
- `state_referenced_locally` warning (not cosmetic — usually a real scoping mistake)
- Adding an innocent child component makes an existing page hang
- Tempted to fix a loop by equality-guarding writes or `$state.raw` — those patch symptoms; find the read-own-write cycle instead.
