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

**Exception — jkai runs on Segoe UI.** Inside `/jkai` (the hub shell and every
sub-page) `--font-body` is redefined to a Segoe UI stack: it is an application
surface, not editorial. This is DELIBERATE (John, 2026-08-29) — do NOT "fix" it
back to DM Sans. The override is the `body:has(.jkai-root)` / `body:has(.jkai-runner)`
block in `src/app.css`; it is keyed on `<body>` because jkai modals portal out of
`.jkai-root`, and it lives in `app.css` because Svelte's scoped-CSS pruner deletes
a `:has()` matching another component's child. Only the body token moves —
`--font-display` and `--font-mono` are unchanged, and the rest of the site keeps
DM Sans. No `@font-face`: Segoe UI is not licensable for web embedding, so
non-Windows clients fall through the stack.

## Palette (CSS vars, never hex-invent)

Cream `--bg #ede4d4`; ink `--text-primary #1a1008` with `--text-secondary/muted/ghost`; accent burnt-orange `--accent #c4570a` (+ `--accent-hover`, tint scale); counter-accent petrol `--accent-ink #0e5b66` (`--info` aliases it — blue was retired); status `--success #2d7a3a`, `--warn #b0892a`, `--error #c44`. No shadows, no spring animations; radii 0/2/4/100 only; SVG icons, not emoji.

## Reference pages (copy structure, not vibes)

- **Admin/JKAI pages** → model on `src/routes/admin/files/+page.svelte`: `.page-hdr` (`.kicker` mono eyebrow, display h1, `.sub`, `.back-link`, 2px bottom border) → `.nm-sec` sections with `.nm-sec-hd` + `.sr-label-tight` → `.nm-text-input` inputs → `.nm-save-btn` primary → `.row-link` (+ `.danger`) row actions.
- **Canvas/tools** → `src/routes/jkai/canvas/+page.svelte`.

## Navigation — one bar, every page (non-negotiable)

Full principle: `docs/design/navigation.md`. The short version:

```
[⌂] [← parent] [ Section ] [ sub-nav cells … ] ················· [ right slot ]
```

Every page wears this, in this order. Building a new page:

1. `src/lib/nav/site-nav.ts` is the ONLY thing that decides where "up" is —
   usually a new page inherits its section and needs no entry. **Never
   hand-write a back link.**
2. The family shell normally renders the bar already (`PageHeader`,
   `HealthShell`, `HubHeader`, `AdminTopNav`, `FieldStudyNav`). A standalone
   page mounts `SiteHeader` as the FIRST element of its markup — a sibling above
   the page wrapper, never inside a scroll container.
3. Read the path with `currentPath()` / `currentIsOwner()` from
   `$lib/nav/page-path`, never `page.url` from `$app/state` (it throws outside a
   request and kills component tests).

`tests/lib/nav/` fails the gate if a page has no bar and no reasoned entry in
`CHROME_EXCLUSIONS`, if a back link points at a non-existent or chrome-less
route, or if more than one sub-nav cell lights.

Do not: hand-roll a `← Back` link (the bar owns it); publish a `pageMenu.back`
that skips levels; offer a signed-out visitor an `ownerOnly` destination; derive
nav from the route tree (it resurrects `/projects/landgrab`); change
`--site-nav-height`.

The bar is INK — cream text is `var(--bg)`, accent is `var(--accent-on-dark)`,
hairlines `rgba(237, 228, 212, 0.14)` (`--line-hair` is invisible there). Field
studies are PAPER and use `FieldStudyNav`, which mounts INSIDE the element the
layout measures with `bind:clientHeight`.

## Modals / overlays (recurring trap)

- Panel background must be OPAQUE: `--surface-elevated` (#e8dece) or `--bg`. `--card-bg` is a 7%-opacity tint (fine inline, transparent as a modal) — same for `--bg-section`/`--surface-overlay`. Make `position: sticky` table headers opaque too.
- Portal to `<body>`; parent mounts/unmounts via `{#if open}`. Do NOT use the shared `$lib/canvas/portal` action for mount/unmount modals — its `destroy()` re-appends the node and resurrects the overlay (stuck-open modal, dead ✕/Escape). Use a local action: `document.body.appendChild(node)` + `node.remove()` on destroy. See `OpenRouterModelPicker.svelte`.
- In-modal tables: `table-layout: fixed` + `<colgroup>`; never `display:flex` on a `<td>`.

## Hard rule

When redesigning any page, mirror the FULL system sitewide — no selective reconciliation, no one-off palettes. If a needed pattern is missing, extend from the reference pages and tokens, don't freelance.
