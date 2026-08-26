---
name: sr-design-system
description: "Strange Ramblings design system — apply to all static apps unless the user requests otherwise."
version: 1.0.0
metadata:
  hermes:
    tags: [design-system, branding, strangeramblings]
    applies_to: [register_chat_build, build_tweak]
---

# Strange Ramblings Design System

**Rule:** When building any static HTML app for strangeramblings.com (via `register_chat_build` or `build_tweak`), apply this design system by default. Only deviate if the user explicitly asks for something different.

## Fonts (Google Fonts CDN)

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Token | Value | Usage |
|-------|-------|-------|
| `--font-display` | `'Archivo Black', Impact, sans-serif` | Page headings, hero text |
| `--font-body` | `'DM Sans', system-ui, sans-serif` | Body copy, paragraphs |
| `--font-mono` | `'JetBrains Mono', ui-monospace, monospace` | Labels, inputs, data, code |

## Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#ede4d4` | Page background — warm cream |
| `--bg-section` | `rgba(26, 16, 8, 0.04)` | Card/section fill |
| `--card-border` | `rgba(26, 16, 8, 0.18)` | Borders on cards, inputs, sections |
| `--divider` | `rgba(26, 16, 8, 0.08)` | Subtle dividers, table rows |
| `--accent` | `#c4570a` | Primary accent — burnt orange |
| `--accent-hover` | `#a84808` | Hover state for accent |
| `--accent-tint-04` | `rgba(196, 87, 10, 0.04)` | Lightest accent tint |
| `--accent-tint-08` | `rgba(196, 87, 10, 0.08)` | Subtle highlight background |
| `--accent-tint-14` | `rgba(196, 87, 10, 0.14)` | Medium tint |
| `--accent-tint-20` | `rgba(196, 87, 10, 0.2)` | Strong tint |
| `--accent-tint-25` | `rgba(196, 87, 10, 0.25)` | Hover-tint |
| `--accent-tint-35` | `rgba(196, 87, 10, 0.35)` | Active/pressed tint |
| `--text-primary` | `#1a1008` | Main text — near-black warm |
| `--text-secondary` | `#3d2e1a` | Secondary text |
| `--text-muted` | `rgba(26, 16, 8, 0.65)` | Labels, metadata |
| `--text-ghost` | `rgba(26, 16, 8, 0.45)` | Placeholders, hint text |

## Brand Mark

The site uses **`sr.`** as the monogram — DM Mono, 11px, uppercase, letter-spacing 0.12em, `--text-muted` colour. Place it top-left as a brand signature on every app.

## Component Patterns

These are the canonical CSS classes from `nm-tokens.css`. Mirror them exactly.

### Sections (cards)

```css
.nm-sec {
  background: var(--bg-section);
  border: 1px solid var(--card-border);
  padding: 1rem 1.1rem 1.15rem;
  margin-bottom: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nm-sec-hd {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--card-border);
}
```

### Labels

```css
.sr-label-tight {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}
```

### Text inputs

```css
.nm-text-input {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  background: rgba(26, 16, 8, 0.04);
  border: 1px solid var(--card-border);
  padding: 7px 10px;
  outline: none;
}
.nm-text-input:focus {
  border-color: var(--accent);
  background: var(--bg);
}
```

### Primary button

```css
.nm-save-btn {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 6px 14px;
  background: var(--accent);
  color: var(--bg);
  border: 1px solid var(--accent);
  cursor: pointer;
}
.nm-save-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
```

### Ghost button

```css
.nm-btn-ghost {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 6px 14px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--card-border);
  cursor: pointer;
}
.nm-btn-ghost:hover { border-color: var(--text-primary); color: var(--text-primary); }
```

## Page Layout

- Max-width ~640px, centered, generous padding (2rem horizontal on desktop, 1rem on mobile).
- Headings: Archivo Black, ~1.75rem, tight line-height (1.15), slight negative letter-spacing (-0.02em).
- Subtitle/description: DM Mono, 11px, `--text-ghost`.
- No rounded corners — everything is sharp/square.
- No box-shadow except on overlays (optional 4px 4px 0 rgba(0,0,0,0.08)).

## What NOT to do

- Never use Space Grotesk, Neue Haas Grotesk, Inter, or Roboto.
- Never add rounded corners (border-radius).
- Never use drop shadows on cards.
- Never use bright/saturated blues or purples — the accent is burnt orange only.
- Never use a white (#fff) background — the page is warm cream.
