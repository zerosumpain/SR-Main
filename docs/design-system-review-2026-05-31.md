# Strange Ramblings — Design System Review
*2026-05-31. Scope: public pages, admin pages, shared tokens & primitives. Read-only audit; no code changes.*

---

## Executive summary

The system has a **strong tokenized foundation** (`nm-tokens.css`, `app.css`) and a coherent warm-brutalist identity — `sr.` monogram, Archivo Black display, DM Sans body, JetBrains Mono labels, burnt-orange accent (`#c4570a`). Pages that respect the primitives feel like one product. Where the system breaks down is at the edges: **standalone tools (`/capture`, `/live`, `/heart`, `/deepdive`, `/quickanswer`) drift from the chrome and palette**, a few admin pages reinvent existing primitives, and the nav model is fragmented into three disjoint sets.

These are all *organizational* problems, not redesign problems. The fixes are mostly mechanical.

### The four highest-leverage fixes

1. **Adopt a single shared footer + nav contract for every public page.** 7 of 11 public routes currently have no footer; visitors hitting `/live` or `/heart` from a deep link have no exit. (Big UX gain, small code change.)
2. **Reskin or retire `/capture`.** It's the one public page built in a completely different visual language (Tailwind grays/blues, no brand fonts, no `sr.` mark). It reads as a foreign product.
3. **Define `--font-sans`, `--success`, `--warn`, and a `--shadow-*` family.** These are tokens the codebase is already trying to use (via ghost references or duplicated hex) but that don't exist. Adding them retires dozens of hardcoded values.
4. **Migrate `/admin/hero` and `/admin/pulse` onto `nm-*` primitives.** Both reinvented buttons, badges, and form controls that already exist. They're the loudest internal inconsistencies.

---

## Findings by lens

### 1. Visual consistency

**What's working:** Main public pages (`/`, `/blog`, `/blog/[slug]`) and most admin pages share type scale, accent usage, and the section/card pattern. Typography discipline is high on pages that bother — Archivo Black for display, JetBrains Mono for labels, DM Sans for body, DM Mono for brand.

**What's broken:**

| Issue | Where | Why it matters |
|---|---|---|
| `/projects` card titles use `font-weight: 500 / 20px` (DM Sans) | `src/routes/projects/+page.svelte:~70` | Blog post titles are Archivo Black at `clamp(56–132px)`; project cards feel demoted by comparison |
| `--font-sans` referenced but never defined | `src/routes/jkai/canvas/+page.svelte` (multiple), `app.css` inline blocks (`.sys-card p`, `.process-step-detail`, `.layer-card .layer-desc`, `.layer-gap`, `.layer-fill`, `.act-desc`) | Falls back to browser default (serif on most contexts). Silent typography break. |
| Green success color forked into 6 hex variants | `#2d7a3a`, `#2d7d46`, `#3a8a56`, `#2c8a3f`, `#2a9d4a`, `#3f6f45` across pulse, agent, deepdive, quickanswer | No canonical `--success` (the defined `--status-success: #6ab88a` is barely used) |
| Red error color forked into 5 variants | `#c44`, `#c25b5b`, `#c0392b`, `#a33`, `#b00` | Same story; `--status-error` is defined but bypassed |
| Chart colors (`#5dbea3`, `#7a6cd4`, `#4a9`, `#3a6b8b`, etc.) hardcoded inline | `/jkai/canvas`, `/jkai/intel` D3 code | Data viz reads as a fork of the brand palette |
| `box-shadow` values ad-hoc (`4px 4px 0 rgba(0,0,0,0.08)`, `0 8px 24px rgba(26,16,8,0.18)`) | `.nm-inline`, burger panel, admin cards | No `--shadow-{sm,md,lg}` tokens defined |
| `border-radius: 2px` hardcoded 7+ times | various | `--radius-sharp` exists but isn't used |
| `/jkai/canvas` redefines `.nm-sec` / `.nm-sec-hd` in scoped `<style>` | `src/routes/jkai/canvas/+page.svelte` | Drift waiting to happen — token changes won't propagate |

### 2. Brand expression

**What's working:** The `sr.` brand mark + DM Mono wordmark show up on every page that uses `PageHeader` / `SiteNav`. The accent burnt orange (`#c4570a`) is the most recognizable thread.

**What's broken:**

- **`/capture` is completely off-brand.** Uses Tailwind `bg-gray-900`, `bg-sky-600`, `bg-red-600`, `bg-emerald-600`, no brand fonts, no `sr.` monogram. Looks like a different product. (`src/routes/capture/+page.svelte:175–272`)
- **`/jkai/canvas` palette forks** to teal (`#5dbea3`) and purple (`#7a6cd4`) for accents — visually feels like a separate app from `/admin/*`, which stays orange.
- **`/heart` and `/live` feel like detached visualisations** rather than parts of the site — minimal brand chrome around the canvas/map, no footer, no exit to the rest of the site.
- **No dark mode** is wired anywhere, yet `color-mix(..., var(--status-error, #c0392b) 10%, transparent)` fallback values exist throughout. Either commit to dark mode or strip the unused fallbacks.

### 3. Component reuse

**What `nm-*` primitives exist (well-used):** `.nm-sec`, `.nm-sec-hd`, `.nm-text-input`, `.nm-save-btn`, `.nm-btn-ghost`, `.nm-pill` (15 uses), `.nm-field` (15 uses), `.nm-form-row`, `.nm-tabs` / `.nm-tab` (6 uses), `.nm-select`, `.nm-textarea`, `.nm-toggle`, `.nm-range`, `.nm-empty`, `.nm-table`, `.row-link`, `.sr-label-tight`.

**The two worst offenders re-inventing the wheel:**

- **`/admin/hero`** rolls its own `.btn-primary`, `.btn-ghost` (duplicates `.nm-save-btn` / `.nm-btn-ghost`), `.style-box` (duplicates `.nm-textarea`), `.status-error` (duplicates `.banner-error`), custom `.ctl` / `.ctl-label` form scaffolding (duplicates `.nm-field` / `.nm-form-row`). Hardcodes white `#fff` text in `.btn-primary`. **Single biggest cleanup target in admin.**
- **`/admin/pulse`** defines `.pill` + `.st-running` / `.st-ok` / `.st-err` instead of `.nm-pill[data-state="..."]`, defines local `.banner-success` / `.banner-error` / `.banner-info` (already in admin.css), 50+ custom one-off classes for status streams. Functional but undisciplined.

**Primitives that obviously *should* exist but don't:**

- **`--success` / `--warn` / `--info` tokens** (currently 6 greens, 3 yellows, multiple blues all hardcoded)
- **`--shadow-{sm,md,lg}`** (currently 4+ ad-hoc shadow values)
- **`--chart-{teal,purple,blue,gold}`** palette extension for data viz
- **`--font-sans`** (already referenced; just needs to be defined)
- **A `.nm-toast` primitive** — pages currently use top-of-page `.banner` for transient feedback, which forces scrolling on long admin pages
- **A `.nm-collapsible` / `.nm-accordion`** — `/admin/pulse`, `/admin/tools`, `/admin/gmail` each build their own expand/collapse pattern

**Three near-duplicate nav primitives:** `.nav-link` (brutalist numbered, app.css), `.section-tab` (underline, app.css), `.nm-tab` (admin tabs, admin.css). They serve different surfaces but share enough DNA to deserve a common base + variants.

### 4. Information architecture & navigation

The current nav model is split into three disjoint sets in `PageHeader.svelte:26–58`:

- **SITE_ITEMS** — Home, Projects, Writing, Health, Live, jkai
- **JKAI_ITEMS** — Home, Chat, Intel, Research, Builds, Prompts, Canvases, Channels
- **DEEPDIVE_ITEMS** — Home, Projects, Research, Deep Dive, Quick

**Concrete problems this creates:**

1. **A visitor on `/quickanswer` can't get to `/blog` in one click** — the DEEPDIVE_ITEMS nav doesn't include Writing.
2. **`/live`, `/heart`, `/heart/1`, `/heart/2` are nav dead ends.** No footer, no secondary nav. `/heart/1` and `/heart/2` aren't discoverable from anywhere except `/heart` itself.
3. **Blog post pages link only to `/` and `/admin`** in their footer — no link back to `/blog` index. Awkward "read the next post" flow.
4. **No breadcrumbs anywhere** — the section→item→detail relationships exist (blog→post, admin→files, jkai→chat) but aren't surfaced.
5. **`/capture` has zero chrome** — no nav, no footer, no monogram. Drop in cold and you don't know what site you're on.

Footers exist on only 4 of 11 public routes: `/`, `/blog`, `/blog/[slug]`, `/projects`. Missing on: `/live`, `/heart`, `/heart/*`, `/quickanswer`, `/deepdive`, `/capture`, `/login`, `/auth-error`.

---

## Prioritized fix list

### Tier 1 — Do first (small effort, big visual/UX payoff)

1. **Define the missing tokens** in `src/lib/styles/nm-tokens.css`:
   ```css
   --font-sans: var(--font-body);
   --success: #2d7a3a;  --success-bg: rgba(45,122,58,0.10);
   --warn:    #b0892a;  --warn-bg:    rgba(176,137,42,0.10);
   --info:    #3a6b8b;  --info-bg:    rgba(58,107,139,0.10);
   --shadow-sm: 2px 2px 0 rgba(26,16,8,0.06);
   --shadow-md: 4px 4px 0 rgba(26,16,8,0.10);
   --shadow-lg: 0 8px 24px rgba(26,16,8,0.18);
   ```
   Then sweep the codebase for the hex variants and replace.
2. **Add a `<SiteFooter>` component and put it on every public route** (including `/live`, `/heart`, `/quickanswer`, `/deepdive`, `/login`, `/auth-error`). At minimum: brand mark, "back to home", one or two cross-section links.
3. **Consolidate nav into one SITE_ITEMS list** — let JKAI/Research surfaces add a secondary tab strip *under* the main nav, not replace it. Users should always be able to reach blog/projects/home in one click.
4. **Reskin `/capture`** to use nm-tokens.css colors and brand fonts. Even a minimal pass (replace `bg-gray-900` → `var(--code-bg)`, replace Tailwind blues with `var(--accent)`, add brand wordmark) recovers brand cohesion.

### Tier 2 — Component-reuse cleanups

5. **Migrate `/admin/hero`** to `.nm-textarea`, `.nm-save-btn`, `.nm-btn-ghost`, `.nm-field`, `.nm-form-row`, `.banner` / `.banner-error`. Delete `.btn-primary`, `.btn-ghost`, `.style-box`, `.status-error`.
6. **Migrate `/admin/pulse`** status indicators to `.nm-pill[data-state="..."]`. Delete the local `.pill` + `.st-*` and the redundant `.banner-*` definitions.
7. **Remove `/jkai/canvas`'s scoped `.nm-sec` / `.nm-sec-hd` overrides.** Inherit from `nm-tokens.css` so future token changes propagate.
8. **Promote `/projects` card titles to display type** — `font-family: var(--font-display); font-weight: 900; font-size: clamp(20px, 2.5vw, 36px);` Match the visual weight given to blog post titles.

### Tier 3 — Brand & polish

9. **Decide on `/jkai/canvas` palette.** Either commit to the warm-orange identity (replace `#5dbea3` / `#7a6cd4` with accent + accent-tints) or introduce a scoped, intentional `--jkai-accent` secondary token so the divergence is system-defined rather than ad-hoc.
10. **Define `--chart-*` palette tokens** in nm-tokens.css. Even 4–6 named chart colors gets D3 code out of inline-hex land.
11. **Add brand chrome to `/heart` and `/live`** — at least a thin top strip with `sr.` mark + section label, so the visualisations don't feel detached.
12. **Drop the unused dark-mode `color-mix` fallbacks** (e.g. `color-mix(..., var(--status-error, #c0392b) 10%, transparent)`) until dark mode is actually implemented. Cleans up noise.

### Tier 4 — New primitives worth adding

13. **`.nm-toast`** — bottom-right auto-dismiss notification (replaces top-of-page banners on long admin pages).
14. **`.nm-collapsible`** — a shared expand/collapse pattern (currently three rebuilds in `/admin/pulse`, `/admin/tools`, `/admin/gmail`).
15. **`.nm-breadcrumb`** — for blog post → blog → home and admin sub-pages.
16. **A single nav base** that `.nav-link` (numbered), `.section-tab` (underline), and `.nm-tab` (admin) extend, sharing typography and hover semantics.

---

## What I'd ship first

If you want one PR that moves the needle most: **Tier 1, items 1–3** (tokens + shared footer + unified nav). That's ~1 day of work, no design decisions required, and it fixes the worst UX gaps (dead-end pages, ghost tokens, fragmented nav) without touching the brand identity. Everything in Tier 2/3 can follow incrementally.

**Defer / don't bother:** A full design system refactor or a new component library. The bones are good — this is a discipline problem, not an architecture problem.
