---
name: sr-design
description: Use when building or restyling ANY page/component in strange_rambling_svelte — new UI, admin/JKAI pages, project pages, modals/overlays, or when choosing fonts, colors, spacing, or layout. Also when asked to "tidy", "match the site", or redesign.
---

# SR design system — apply, don't invent

Warm-brutalist system. Source of truth: tokens in `src/app.css` (`:root`) + `src/lib/styles/nm-tokens.css`; canonical brand repo `~/strange-ramblings-design/` (README = brand guidelines, `colors_and_type.css`, `ui_kits/{site,jkai}`). Read the tokens and a reference page BEFORE proposing any visual choice.

## Fonts (never invent new ones)

| Token | Font | Role |
|---|---|---|
| `--font-display` | Archivo Black | headlines — the live site DELIBERATELY keeps this (design repo says Zilla Slab; do NOT "fix" it) |
| `--font-brand` | DM Mono | 'sr.' brand mark, lowercase wordmark |
| `--font-body` / `--font-sans` | DM Sans | body copy |
| `--font-mono` | JetBrains Mono | labels, nav, `.sr-label-tight` |

Space Grotesk / Neue Haas Grotesk are design-repo-only references — never in production code.

## Palette (CSS vars, never hex-invent)

Cream `--bg #ede4d4`; ink `--text-primary #1a1008` with `--text-secondary/muted/ghost`; accent burnt-orange `--accent #c4570a` (+ `--accent-hover`, tint scale); counter-accent petrol `--accent-ink #0e5b66` (`--info` aliases it — blue was retired); status `--success #2d7a3a`, `--warn #b0892a`, `--error #c44`. No shadows, no spring animations; radii 0/2/4/100 only; SVG icons, not emoji.

## Reference pages (copy structure, not vibes)

- **Admin/JKAI pages** → model on `src/routes/admin/files/+page.svelte`: `.page-hdr` (`.kicker` mono eyebrow, display h1, `.sub`, `.back-link`, 2px bottom border) → `.nm-sec` sections with `.nm-sec-hd` + `.sr-label-tight` → `.nm-text-input` inputs → `.nm-save-btn` primary → `.row-link` (+ `.danger`) row actions.
- **Canvas/tools** → `src/routes/jkai/canvas/+page.svelte`.

## Modals / overlays (recurring trap)

- Panel background must be OPAQUE: `--surface-elevated` (#e8dece) or `--bg`. `--card-bg` is a 7%-opacity tint (fine inline, transparent as a modal) — same for `--bg-section`/`--surface-overlay`. Make `position: sticky` table headers opaque too.
- Portal to `<body>`; parent mounts/unmounts via `{#if open}`. Do NOT use the shared `$lib/canvas/portal` action for mount/unmount modals — its `destroy()` re-appends the node and resurrects the overlay (stuck-open modal, dead ✕/Escape). Use a local action: `document.body.appendChild(node)` + `node.remove()` on destroy. See `OpenRouterModelPicker.svelte`.
- In-modal tables: `table-layout: fixed` + `<colgroup>`; never `display:flex` on a `<td>`.

## Hard rule

When redesigning any page, mirror the FULL system sitewide — no selective reconciliation, no one-off palettes. If a needed pattern is missing, extend from the reference pages and tokens, don't freelance.
