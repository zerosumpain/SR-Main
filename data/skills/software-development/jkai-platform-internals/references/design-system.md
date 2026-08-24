# SR Design System Tokens

Quick reference for building HTML apps/pages that match the Strange Ramblings
design language. All values are canonical — do not invent substitutes.

## Fonts (Google Fonts CDN)

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Token | Value | Usage |
|-------|-------|-------|
| `--font-display` | `'Archivo Black', Impact, sans-serif` | Page headings, hero text |
| `--font-body` | `'DM Sans', system-ui, sans-serif` | Body copy, paragraphs |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` | Labels, inputs, tables, code, data |

## Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#ede4d4` | Page background — warm cream |
| `--bg-section` | `rgba(26, 16, 8, 0.04)` | Card/section background tint |
| `--card-border` | `rgba(26, 16, 8, 0.18)` | Borders, dividers, inputs |
| `--accent` | `#c4570a` | Primary action — burnt orange |
| `--accent-hover` | `#a84808` | Hover state for accent |
| `--accent-tint-08` | `rgba(196, 87, 10, 0.08)` | Subtle accent backgrounds |
| `--accent-tint-14` | `rgba(196, 87, 10, 0.14)` | Medium accent backgrounds |
| `--accent-tint-20` | `rgba(196, 87, 10, 0.2)` | Strong accent backgrounds |
| `--text-primary` | `#1a1008` | Main body text |
| `--text-secondary` | `#3d2e1a` | Secondary/muted text |
| `--text-muted` | `rgba(26, 16, 8, 0.65)` | Labels, captions |
| `--text-ghost` | `rgba(26, 16, 8, 0.45)` | Placeholders, disabled, hints |
| `--divider` | `rgba(26, 16, 8, 0.08)` | Hairline dividers |

## Typography Scale

- **Page heading (h1):** `font-family: var(--font-display)`, ~1.75rem, tight line-height
- **Section label:** `font-family: var(--font-mono)`, 10px, uppercase, letter-spacing 0.12em, `var(--text-muted)`
- **Body text:** `font-family: var(--font-body)`, 16px base
- **Data values:** `font-family: var(--font-mono)`, 12–16px, weight 500
- **Small meta/caption:** `font-family: var(--font-mono)`, 9–10px, `var(--text-ghost)`

## nm-* Component Classes

Defined in `src/lib/styles/nm-tokens.css`. Reuse these classes directly in
standalone HTML builds — copy the relevant rules into a `<style>` block.

| Class | Purpose |
|-------|---------|
| `.nm-sec` | Bordered section card (bg, border, padding, flex-column) |
| `.nm-sec-hd` | Section header row (flex, baseline, bottom border) |
| `.sr-label-tight` | Mono uppercase label (10px, 0.12em tracking) |
| `.nm-sec-meta` | Right-aligned mono meta text |
| `.nm-text-input` | Mono text/number input (12px, bordered, focus = accent border) |
| `.nm-save-btn` | Primary action button (accent bg, bg text) |
| `.nm-btn-ghost` | Secondary action button (transparent bg, bordered) |

## Layout Patterns

- **Max content width:** 640px centered
- **Section spacing:** 1.25rem bottom margin
- **Field gaps:** 5px within sections
- **Field rows:** flex with 10px gap for side-by-side inputs
- **Button rows:** flex with 8px gap
- **Results grids:** CSS grid, 2-column, 8px gap

## Brand Mark

The site uses `sr.` (lowercase, with period) as the monogram. Rendered in
`var(--font-mono)`, uppercase, letter-spacing 0.12em, `var(--text-muted)`.
