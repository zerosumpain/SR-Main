# Navigation — one bar, every page

Adopted 2026-09-03 (PR #665). Binding on new pages.

Before this, the site had **six** navigation dialects and **111 pages with no top
nav at all**. Where you were, how you got up a level, and whether there was a way
home all depended on which family you had landed in. The principle is simply that
a reader should never have to learn this page's particular answer.

## The bar

```
[⌂] [Room ▾] [← parent] [ Section ] [ sub-nav cells … ] ········ [jkai] [ right slot ]
```

The order does not vary. The home icon is always first, always `/`. The room
cell is second. The back cell is always one level up. The sub-nav is the
section's own siblings — the pattern `/jkai` and `/health` already used, now
everywhere. The jkai cell is the assistant, one press from any page; it is a
plain link and holds nothing.

## Rooms

Added 2026-11-10. Every destination on the site is filed in one of five rooms,
`ROOMS` in the manifest:

| Room | Holds |
|---|---|
| Show | Projects, Writing, Editor |
| Life | Health, House, Trips, Wish list |
| Know | News, Daydreams, Research, Intel, Notes |
| Make | Canvas, Develop, Codegraph, Prompts, Drive |
| Run  | Admin, Sources, Activity, Shipped |

A room is not a page and has no URL. The room cell (`RoomMenu.svelte`) is a
button naming the room you are in; its menu lists that room and carries the
other four across its top, so anywhere is one hover and one click from
anywhere. Three consequences:

- **A page with no sub-nav of its own shows its room-mates** (Trips shows
  Health, House, Trips, Wish list), not the whole site.
- **A page in no room** (`/`, jkai chat) has no strip; the bar wears one cell
  per room instead.
- **A viewer who reaches fewer than six destinations wears no rooms.** A
  signed-out visitor gets Projects, Writing, Health as a flat strip.

Adding a destination means adding one row to one room. A page's room is worked
out from those rows (`roomFor`), so a section never declares it. Do not hang a
destination under the jkai cell again: that drawer is what rooms replaced.

## The map, and go-or-ask

Added 2026-11-10. Wherever the room cell is worn, the whole site is one sheet
away (`NavMap.svelte`, drawn beside the room cell):

- **Three ways in.** Rest a mouse on the home icon, press `/` anywhere outside
  a field, or take the last row of any room menu ("Everywhere, or ask"). The
  home icon is still a link home: hovering shows the map, clicking goes.
- **Empty, it is the map**: the five rooms side by side (two abreast on a
  phone), the current place cut out, and above them **Lately** — the last few
  places this browser visited (`localStorage`, never sent anywhere).
- **Typed in, it is go-or-ask.** Every word typed must begin a word of a
  place's label, its room or section, or its address (`placesFor` and
  `matchPlaces` in `src/lib/nav/go.ts`). Enter goes to the first match. For
  the owner the last row hands the line to jkai as a question (`askHref`), so
  a line that names no place is asked.
- **A place is a nav row.** The box indexes the manifest (rooms, the jkai
  cell, each section's sub-nav) and nothing else, so it can never reach what
  the bar itself would not show that viewer. A route with no nav row is not a
  place; give it a row and it is found.

A viewer who wears no rooms has no map: three destinations need no index.

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
