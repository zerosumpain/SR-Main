# Navigation — one bar, every page

Adopted 2026-09-03 (PR #665). Binding on new pages.

Before this, the site had **six** navigation dialects and **111 pages with no top
nav at all**. Where you were, how you got up a level, and whether there was a way
home all depended on which family you had landed in. The principle is simply that
a reader should never have to learn this page's particular answer.

## The bar

```
[⌂] [← parent] [ Section ] [ sub-nav cells … ] ················· [ right slot ]
```

The order does not vary. The home icon is always first, always `/`. The back cell
is always one level up. The sub-nav is the section's own siblings — the pattern
`/jkai` and `/health` already used, now everywhere.

## Adding a page

1. **Put it in the manifest.** `src/lib/nav/site-nav.ts` is the only thing that
   decides where "up" is. Usually a new page inherits the section it sits under
   and needs no entry at all. **Never hand-write a back link.**
2. **Render the bar.** Nearly always the family's shell already does it:
   `PageHeader`, `HealthShell`, `HubHeader`, `AdminTopNav`, `FieldStudyNav`. A
   standalone page mounts `SiteHeader` as the *first* element of its markup — a
   sibling above the page wrapper, never inside a scroll container.
3. **Read the path safely.** `currentPath()` / `currentIsOwner()` from
   `$lib/nav/page-path`. Never `page.url` from `$app/state`: it throws outside a
   request and takes every component test with it.

## What the tests enforce

`tests/lib/nav/` fails the gate on any of these:

- A page that neither wears the bar nor appears in `CHROME_EXCLUSIONS`.
- An entry in `CHROME_EXCLUSIONS` is required to carry a **written reason**.
  "It looked cluttered" is not one. "It is a `position: fixed; inset: 0`
  full-viewport stage that covers anything sticky" is.
- A back link that resolves to a route which does not exist, or to a page that is
  itself chrome-less — a destination with no way out is a trap, not a parent.
- More or fewer than exactly one lit sub-nav cell.

## Do not

- **Hand-roll a `← Back` link** in a page or masthead. The bar owns that
  affordance. A second one is the inconsistency this removes — eight pages had
  two before the unification.
- **Publish a `pageMenu.back` that skips levels.** Intel and Codegraph both did
  (`back: chat`), which made them the only two surfaces where back jumped
  straight to the top. Removed 2026-09-03.
- **Offer a signed-out visitor an owner-only destination.** Flag it `ownerOnly`.
  An owner-only *section* hides its whole item list, not just flagged items.
- **Derive nav from the route tree or `.github/public-routes.txt`.** `/projects`
  is a public PREFIX, so that resurrects `/projects/landgrab` and
  `/projects/family-life360-history` — owner-only surfaces, gated only inside
  their own loads, deliberately absent from every index.
- **Change `--site-nav-height` (48px).** Twelve places do arithmetic on it,
  including the landing hero and all three `/heart` heroes.

## Registers

The bar is **INK** (`background: var(--text-primary)`). Inside it: cream text is
`var(--bg)`, the accent is `var(--accent-on-dark)` — plain `--accent` scores
2.6:1 on `#1a1008` — and hairlines are `rgba(237, 228, 212, 0.14)`, because
`--line-hair` is ink-on-ink there and renders invisible.

The field studies are the one deliberate exception: they are **PAPER**, and use
`FieldStudyNav`. It must mount *inside* the element that layout measures with
`bind:clientHeight` (`--topH`), never above it — a row above is invisible to that
measurement and every sticky offset beneath it silently breaks, including the
federation simulator's on-canvas HUD.
