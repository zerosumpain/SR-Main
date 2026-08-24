---
name: jkai-decks
description: "Build sr. decks presentations from chat — design the slide outline first, then persist."
version: 2.2.0
metadata:
  hermes:
    tags: [jkai, decks, presentation, slides, mcp]
    related_skills:
      - jkai-general
      - jkai-research
      - jkai-files
---

# jkai Decks — presentations from a prompt

## What a deck is

An **sr. deck** is a multidirectional editorial slide presentation at `strangeramblings.com/decks/<slug>`. A deck is a tree of slides; each slide is an ordered list of typed blocks that render in the site's field-study register (Fraunces serif, paper-and-ink). The main pathway runs **left→right**; a slide with `children` carries a **side journey** — a floating pill on it says "↓ down for `journey_label`" and the viewer walks the journey downward (a journey inside a journey runs rightward; ↑/Escape climb back; a nav map bottom-left shows the way home). **Always set `journey_label`** (2–5 words naming the side story) on any slide with children. Decks are **private by default**; the build tool mints a share link.

## The design-first gate (same discipline as canvas builds)

1. **Design in chat first.** Write the outline as numbered slides: title, block types, the key content of each block, and which slide nests a sub-deck. Keep it skimmable — this is the approval artifact.
2. **Wait for yes** ("build it", "go", "yes") before calling the tool. Never call `presentation_build_from_spec` with a guessed design.
3. **One build call.** On return, paste `data.summaryMarkdown` VERBATIM — it has the deck URL, the share link and the outline. Do not rewrite it or invent URLs.
4. If the tool returns validation issues, fix the spec and call again — do not hand the errors to John.

## Authoring judgement — what makes a deck good

- **Narrative arc, not a document.** 6–12 top-level slides: hook → context → the argument (often the sub-deck) → evidence → close. One idea per slide.
- **Draw from real site material.** Use `research_search`, `file_search` (via `mcp_jkai_jkai_extended`) and what you know of the site's studies to ground every claim. After an initial build, enriching from the vault (design handoffs, strategies, CVs, org charts) is a proven pattern — see "Enriching a deck from the file vault" below. Decks are editorial and factual — no invented statistics, no fake quotes. Label indicative numbers as indicative.
- **Big blocks, few words.** Whitespace is the loudest signal — 1–3 blocks per slide, never fill the page. `masthead` opens (and can close) the deck; `statRow` for evidence rows; `timeline` for history; `image` for figures.
- **Every slide is a FIXED 1280×720 page — nothing scrolls, and the build/update tools REJECT overfull slides** with fit feedback (a server-side estimator, since batch 18). Budget roughly 120 words of body prose on a full page, HALF that beside a visual or at statement scale; a chart/image/embed leaves room for only ~40 words beside it. When content is too much: tighten the words, switch to a denser register (`columns`/`ledger`/`cards`), or split it over two slides. Never resubmit the same overfull spec.
- **Statement facts get a `headline`** (kicker → ≤12-word claim, sentence case, no full stop → optional one-line dek) on a `statement-left` or `statement-right` layout. That is the bold editorial page; alternate the sides for rhythm.
- **`quote` is for REAL quotations/aphorisms only, ≤140 chars.** A paragraph is `prose` (style `lede` for the opener); an assertive claim is a `headline`. Never pour long text into a quote. Quote styles: `rail` (default — accent left rail, for a quote inside a busier page), `pull` (huge centered under an ornamental mark — when the quotation IS the page, one quote on a statement layout), `boxed` (inset bordered card — a documentary aside beside other content).
- **Prose styles are presets** (`style: body|lede|band|cards|aside|pull|columns|callout|numbered|ledger|interview|manifesto|verse|checklist` — fourteen registers): a short rhythmic creed → `band` (inverted emphasis band, add an *italic* second line) or `manifesto` (huge Fraunces display lines on paper — the lighter creed; *italic* words flare accent); 3+ parallel points of detail → `cards` (each paragraph a card, **bold opener** = its title) instead of a wall of text; an ordered argument/phases → `numbered` (01/02/03 numerals, **bold opener** = step title); specifications/facts-at-a-glance → `ledger` (each paragraph opens with a **bold label** that sits in a left column); a Q&A exchange → `interview` (**bold speaker label** opens each paragraph; questions and answers alternate); a line worth lingering on that is NOT a quotation → `pull`; a lyrical/reflective passage → `verse` (centered italic serif); dense reference text → `columns`; a warning/key takeaway → `callout`; commitments kept / what ships → `checklist` (`- ` lines render as ticked items); sources/footnotes → `aside`. Body supports `#`–`####` headings, `- ` bullet lines, **bold**, *italic*, __underline__.
- **Charts** (`chart`, seven kinds — pick by meaning): trend→`line`/`area`, comparison→`bar` (`xLabels` for categories), before/after→`slope` (2 points per series, `xLabels` = the two ends), share-of-whole→`donut` (`segments`), correlation→`scatter`, flow/allocation→`sankey` (`flows: [{from,to,value}]`, acyclic).
- **Interactives**: `embed` mounts a registered interactive — currently `federation-sim` (config `{ scenario, autoplay }`; scenario ids are validated). `iframe` embeds any site-relative page — check the page is public before using it in a deck that will be shared (e.g. `/live` is login-gated; `/` is public).
- **Code + video** (new in batch 17): `code` sets a Shiki-highlighted snippet in an editorial mono panel — `{ type: "code", code (keep ≤20 lines), lang? (ts|python|bash|json|sql…), title? (usually a filename), caption? }`; it counts as a VISUAL block, so pair it with `split`/`split-flip` (argument beside code). `video` is a motion figure — `{ type: "video", src, caption?, autoplay?, loop? }` where `src` is a YouTube/Vimeo URL (rendered privacy-enhanced) or a site-hosted `/api/blog/images/deck-media/….mp4` file the owner uploaded.
- **Build steps**: ANY content block may carry `step: N` (1–12) — it stays hidden until the presenter's Nth forward press within the slide (backward re-hides; past the last step the press navigates). Use SPARINGLY: stage 2–3 points on ONE argument slide (steps 1, 2, 3…), never a whole deck. Blocks without `step` always show.
- **Source real imagery** with `presentation_source_image` for poster backdrops and figures — do this DURING the build, before calling the build/update tool. `op:"search"` queries openly-licensed providers (Openverse + Wikimedia Commons) → pick a candidate → `op:"import"` stores a site copy and returns `{ src, alt, caption }`; use `src` in the image block and KEEP the caption (it is the licence attribution). `op:"generate"` (pollinations.ai, free) when nothing real fits — keep its AI-generated caption too. Prefer searched real photos for real places/things; generated for abstract/mood imagery. 1–3 image slides per deck is usually right — don't illustrate every slide.
- **Atmosphere** (`effect` blocks — seasoning, not sauce): `{ type: "effect", effect: <name>, role: "background"|"transition", intensity?: 0.1-1, tint?: ink|accent|petrol }`. **Backgrounds** (at most ONE per slide, only where the metaphor fits) — Particle fields: `drift` (quiet statements), `starfield` (vast numbers), `plexus` (networks/federation), `currents` (movement, data in motion), `orbits` (cycles, the long view), `sea` (calm scale), `murmuration` (collective behaviour, coordination), `rain` (patience, weathering), `meteors` (sudden change, ideas arriving), `phyllotaxis` (growth, compounding); Print & type: `halftone` (breathing print screen), `letterpress` (tumbling glyphs), `scribe` (wandering pen line — drafting), `ridgeline` (pulsar-chart rows — signal in noise), `grain` (film grain — archive, the quietest); Live data: `heartbeat` (the site's live ECG). **Transitions**: a background-capable effect with `role: "transition"` fires a particle sweep on arrival; the seven WIPES — `melt` (dissolves to ink particles), `shatter` (breaks into shards), `inkbleed` (ink floods then clears), `slats` (paper slats — lightest), `dissolve` (halftone cascade), `iris` (clean cinema close/open — formal), `erode` (page eaten from the edge — decay) — replace the whole camera move. Wipes on chapter boundaries ONLY, never consecutive slides; melt/shatter are the boldest, at most once or twice per deck; slats/iris are the lightest. Backgrounds are background-only; wipes are transition-only.
- **Hand-laid slides**: a slide may carry `geometry` ({ blockIdx: {x,y,w} } %) — the owner arranged it by hand in the editor. PRESERVE `geometry` verbatim when revising a deck unless you are replacing that slide's blocks.
- **Side journeys** (`children` + `journey_label`) are for optional depth: worked examples, scenario walk-throughs, appendix-grade material. The default journey is the left→right main pathway; a viewer should never NEED a side journey to follow the argument.
- **Layouts** (the predetermined page designs — vary them for rhythm, the full doc list is in the build tool description): `statement-left`/`statement-right` for a bold aligned headline against whitespace (the default statement pages); `statement` (centered) for openings and codas only; `split`/`split-flip` for argument-beside-evidence (text one side, image/chart/embed the other); `grid` for stat-dense pages; `poster` for a full-bleed image with text overlaid; `full-bleed` for embeds; `center` for title/close; `default` otherwise.

## Enriching a deck from the file vault

After building a first draft, John may ask to enrich it with real content from the site's file vault (e.g. "review @files for things that could add to this"). Workflow:

1. `file_search` across the vault with topic-specific queries (health, policy, AI strategy, relationships, projects).
2. `file_read` on high-relevance hits to extract specifics: data contracts, correlation coefficients, org structures, capability descriptions, design specs.
3. Ground the deck's claims with the extracted facts — replace indicative numbers with real ones, add specific data sources, cite actual documents.
4. Build the updated version (see pitfalls below on update tool issues).

## Revising an existing deck ("regenerate X but…", "change the deck to…")

1. `presentation_list` to find the slug if not given.
2. `presentation_get_spec` — returns the deck in exactly the spec shape the update tool accepts.
3. Apply the user's requested changes to that spec (rewrite copy, add/remove/reorder slides, change blocks, restructure sub-decks). Preserve what they didn't ask to change.
4. Show the revised outline in chat with a one-line summary of WHAT CHANGED, wait for yes.
5. `presentation_update_from_spec` — replaces the slides wholesale; slug, URL and share links survive. Paste `data.summaryMarkdown` verbatim.

## Pitfalls — tool quirks (learned the hard way)

- **`presentation_update_from_spec` via `mcp_jkai_jkai_extended` silently rejects valid JSON** — returns "slides must be a non-empty array" even with a correctly-formed slides array. This is a serialisation issue in the extended tool bridge, not a spec problem. **Workaround:** use the native `mcp_jkai_presentation_build_from_spec` MCP tool with a new slug (v2, v3, etc.) and delete the old deck if desired.
- **`presentation_source_image` via `mcp_jkai_jkai_extended` drops `image_url`** — the import op returns "image_url required" despite the parameter being passed. Same bridge issue. **Workaround:** use the native MCP tool directly (`mcp_jkai_jkai_extended` with `operation: "invoke"` sometimes works, but if it fails, fall back to the native `mcp_jkai_presentation_source_image` if available, or build without the image).
- **`statRow` blocks are bare — no `kicker` or `text`.** The `statRow` block type only accepts a `stats` array. Adding `kicker` or `text` causes a validation error: "Unrecognized keys". If you need a header above a stat row, use a separate `headline` block first.
- **`statRow` does not support `headline` keys.** Only `stats: [{n, label}]`. Structure multi-row readiness tables as separate `statRow` blocks, not one block with extra fields.
- **Block type `type` field is required for all blocks.** The `headline` block's `type` is "headline", not omitted. Always include `type` on every block — the validator rejects typeless blocks.

## Tools

- `presentation_build_from_spec` — create a NEW deck. Args: `{ title, description?, slug?, is_public?, slides: [{ title, layout?, blocks, notes?, children? }] }`. The full block vocabulary is in the tool description.
- `presentation_list` — slugs/titles/visibility of existing decks.
- `presentation_get_spec` — read a deck as an editable spec.
- `presentation_update_from_spec` — rewrite an existing deck from a revised spec (destructive: platform will ask the user to confirm).
- `presentation_source_image` — op search (Openverse + Wikimedia) / import (store site copy → `{src, alt, caption}`) / generate (pollinations.ai).
- Content-gathering: `research_search` (deep-dive facts), `file_search` (drive files), plus the site-signals read tools.

## Player vocabulary (for describing decks to John)

← → or the scroll wheel walk the main pathway (shift+wheel = up/down) — on a slide with build steps the forward press reveals the next staged block first (step dots bottom-right) · ↓ where a pill marks a side journey · ↑/Esc climb back · nav map bottom-left jumps anywhere · F fullscreen · the slide is a fixed 1280×720 canvas that scales with the window (never reflows) · share links are `?t=<token>` and expire only if revoked; the owner can export any deck as a PDF from the editor (also refreshes the link's social card).
