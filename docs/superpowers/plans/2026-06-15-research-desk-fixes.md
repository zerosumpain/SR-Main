Both cross-cutting files confirmed. The C and E diagnoses are slightly in tension on the InspectorDrawer structure — E's portal.ts fix is the safety net; C's single-root restructure is the structural fix. I'll merge them so the portal.ts hardening covers all consumers AND the InspectorDrawer becomes a single portaled root. Here's the consolidated plan.

# Research Desk — Consolidated Fix Plan

5 diagnoses, 3 distinct root causes after merging. **C (drawer-interaction) and E (back-nav-freeze) share one underlying defect** (the portal action + InspectorDrawer's two-sibling overlay structure) and are fixed together — not double-fixed. Edits are grouped by file so they never conflict.

---

## Root causes (after merge)

| ID | Symptom | Root cause | Fix locus |
|----|---------|-----------|-----------|
| **C + E** | Drawer scrim eats clicks; page frozen after BACK | **One defect, two faces.** InspectorDrawer portals the `.scrim` and `.drawer` as **two independent siblings** to `<body>` (`InspectorDrawer.svelte:71-72`), and `portal.ts` `destroy()` (`portal.ts:43-50`) only re-parents to `originalParent` *if still connected* — it never `remove()`s. Toggle-close is fragile (stacking); nav-teardown orphans a full-viewport scrim that blocks all input. | `portal.ts` (action hardening, fixes all consumers) + `InspectorDrawer.svelte` (single portaled root) |
| **B** | Desk jank during streaming | ~5ms fixed-timer SSE flush + `get cards()` allocating a fresh array each read → ~8 deriveds re-run, O(N) `organisedLayout`, ~4×N `posOf`, N×520ms morph transitions per flush. | `store.svelte.ts` + `ResearchDesk.svelte` |
| **D** | Explore-further navigates silently | No defect — missing confirm/explain affordance before `goto`. | `InspectorDrawer.svelte` |
| **A** | Confidence/credibility badges unwired | Tested `display.ts` canon never imported by desk components. | `ArtefactCard.svelte`, `LeftFeed.svelte`, `InspectorDrawer.svelte` |

> **Merge note:** Do **not** apply E's `node.remove()` fix *and* leave InspectorDrawer as two siblings as the "real" fix, nor apply C's single-root and skip the portal.ts hardening. **Both are needed but each does a distinct job:** the portal.ts change is the universal safety net (also protects `BuildViewModal` + `MobileBottomSheet` from the same nav-leak); the single-root restructure fixes the stacking/click-interception that portal.ts alone does *not* address. Together they collapse C+E into one coherent fix.

---

## Ordered checklist, grouped by file

### 1. `src/lib/canvas/portal.ts` — hardens ALL portal consumers (fixes E; foundation for C) ⟶ **unit-test first**

- [ ] **Make `destroy()` unconditionally detach the managed node.** Root cause: `destroy()` (`portal.ts:43-50`) is a no-op when `originalParent.isConnected === false` (page torn down during `goto`), orphaning the scrim in `<body>`. Keep the re-parent branch (normal toggle-close, where Svelte expects to find the node at `originalParent`), and add the cleanup else-branch:

  ```js
  destroy() {
    if (originalParent && originalParent.isConnected && node.parentNode !== originalParent) {
      originalParent.appendChild(node);
    } else if (node.parentNode && node.parentNode !== originalParent) {
      node.remove();
    }
  }
  ```
- **Verify (unit):** `portal.test.ts` — (a) toggle case: parent still connected → node restored to `originalParent`, zero orphans in target; (b) nav case: detach `originalParent` first, then `destroy()` → **zero** orphaned nodes in `<body>` (the diagnosis already reproduced 1 orphan here). Write this test **failing first**.
- **Verify (UI, post-deploy):** open inspector → trigger explore-further `goto` (`InspectorDrawer.svelte:50`) → on the next page (and after BACK), the page is interactive (no invisible blocker).

### 2. `src/lib/canvas/intelligence/desk/InspectorDrawer.svelte` — single portaled root (C) + explore-further UX (D) + badge wiring (A)

All three touch this file; do them in this order so markup edits don't collide.

- [ ] **(C) Collapse scrim+drawer into ONE portaled root.** Root cause: two independent `use:portal={'body'}` siblings (`:71-72`) with z-index 90 vs 91 (`:140-154`) → fragile stacking, full-viewport scrim intercepts clicks. Mirror the proven `BuildViewModal.svelte:60` / `MobileBottomSheet.svelte:84` pattern:
  - Wrap the `{#if open && artefact}` body in `<div class="insp-root" use:portal={'body'}> … </div>`.
  - Remove `use:portal` from `.scrim` (`:71`) and `.drawer` (`:72`); they become nested children.
  - CSS: `.insp-root { position:fixed; inset:0; z-index:90; pointer-events:none; }`; `.scrim { position:absolute; inset:0; pointer-events:auto; }` (painted first, keeps `onclick={onclose}`); `.drawer { position:absolute; top/right/bottom:0; pointer-events:auto; }` (painted second → sits above by DOM order; drop the 91 vs 90 dependency). Keep the `slidein` keyframe and Escape handler (`:67`, already correct).
- [ ] **(D) Convert the one-click explore button into a 3-phase in-drawer flow.** Root cause: `exploreFurther()` (`:35-56`) does fetch-then-`goto` with no confirm. Replace boolean `exploring` with `let explorePhase = $state<'idle'|'confirm'|'starting'>('idle')` (keep `exploreErr`); add `let focusNote = $state('')`.
  - **idle:** primary button `⤓ Explore further` → `onclick = () => explorePhase='confirm'` (no fetch). Gating `disabled={!exploreType}`.
  - **confirm:** render an explanation card *inside* `.d-foot` (`:124-135`, reuse drawer surface — not a new modal): heading `EXPLORE FURTHER`, body quoting the source (`artefact.content` for fact / `artefact.name` for entity, truncated ~140 chars), optional `<textarea>` bound to `focusNote`, `Cancel`/`Start run →` buttons.
  - **starting:** POST `{type: exploreType, itemId: artefact.id, ...(focusNote.trim() ? {additionalContext: focusNote.trim()} : {})}` to the unchanged endpoint → on 201 `goto(/deepdive/${child.id})`; on error set `exploreErr` and drop back to `confirm` (preserve note for retry).
  - **Extract pure helpers** (so logic is testable, component stays thin): `buildExplorePrompt(artefact) → { kind, snippet, heading } | null` and `buildExplorePayload(exploreType, itemId, focusNote)`.
- [ ] **(A) Wire confidence/credibility badges.** Root cause: `display.ts` canon never imported. `import { confidenceColor, confidenceLabel, credibilityBadge } from '$lib/deepdive/display';`
  - Credibility dd (`:87`): lead with `{@const cb = credibilityBadge(String(artefact.credibilityType))}` chip, then keep `· {fmtPct(artefact.credibilityScore)}`.
  - Fact bar (`:92-95`): `{@const cc = confidenceColor(Number(artefact.confidence))}` → `style:background={cc}` on `.d-conffill` (remove the flat `background:var(--accent)` at `:179` so inline wins), append `{confidenceLabel(Number(artefact.confidence))}` to `.d-confnum` `style:color={cc}`.
  - Add `.d-credbadge` CSS (font-mono, 1px solid `var(--bc)`).

- **Verify (unit):** `buildExplorePrompt` (fact→`content`, entity→`name`, truncation, null for other kinds); `buildExplorePayload` (omits `additionalContext` when blank, trims when present). `display.ts` itself is already covered by `display.test.ts`.
- **Verify (UI, post-deploy):** open a card → click `✕` / scrim / a Related item each respond (C); fact/entity card shows badge + colour-coded confidence (A); explore shows confirm card, `Cancel` resets, `Start run →` navigates (D).

### 3. `src/lib/canvas/intelligence/desk/store.svelte.ts` — flush coalescer (B, fix 1) ⟶ **unit-test first**

- [ ] **Replace the fixed 5ms leading timer with a trailing debounce + max-wait.** Root cause: `STREAM_FLUSH_MS = 5` (`:203`) + leading-edge `scheduleFlush` (`:229-231`) → up to ~200 flushes/sec, each a wholesale `cardMap = next` (`:233-247`) that invalidates every reader. Extract a pure `makeCoalescer(idleMs ≈ 16, maxMs ≈ 120–150, fn)` helper (own `.ts` or in-file); drive `flush()` through it.
- **Verify (unit):** vitest fake timers (mirror `store.test.ts` / `accumulation.test.ts`) — a burst of N items inside `maxMs` → **1** flush; an idle item flushes within `idleMs`; latency bounded by `maxMs`. Write **failing first**.
- **Verify (UI):** heavy deepdive run feels smooth; flush count drops ~10–30×.

### 4. `src/lib/canvas/intelligence/ResearchDesk.svelte` — position memo + morph gating (B, fixes 2 & 3) — *layered, only if jank persists after #3*

- [ ] **(B fix 2) Compute `posOf` once per card per flush.** Root cause: `get cards()` (`store.svelte.ts:411-413`) returns a fresh array each read → ~8 deriveds re-run (`:74,102,264,279,286,297,307,324`); `posOf` called ~4×N across `entityById` (`:357-365`), `minimap` (`:597-634`), card `{#each}` (`:724-725`), minimap `{#each}` (`:745-746`). Build one `positionById = $derived(new Map(visibleCards.map(c => [c.id, posOf(c)])))` and read it everywhere; memoize `posOf` keyed on position-relevant fields (id + deskState/category/canvasX/canvasY/pinned + mode + a version token of `organised`/`coreBounds`/`dragOverrides`).
- [ ] **(B fix 3) Limit morph transitions to cards that moved.** Root cause: `class:morphing` + `transition: transform 520ms` (`:728`, CSS `:829-831`) re-arms across many nodes because `organised` rebuilds wholesale each flush. Gate `morphing` to the GATHER→SYNTHESIZE mode switch, or only when prev vs current position actually differs.
- **Verify:** `scatterPosition`/`organisedLayout` already have `layout.test.ts`; the memo cache (pure, keyed on position fields) gets a small unit test. Smoothness is UI-only → manual verify on a large streaming run.

---

## Testability summary

| Fix | Unit-testable (write failing test first) | UI-only (manual verify post-deploy) |
|-----|------|------|
| #1 portal.ts `destroy()` | **Yes** — `portal.test.ts`, nav-orphan + toggle-clean | frozen-after-BACK end-to-end |
| #2 C single-root | callback wiring only | hit-testing / stacking (click ✕/scrim/related) |
| #2 D explore flow | **Yes** — `buildExplorePrompt` / `buildExplorePayload` | drawer phases + navigation |
| #2 A badges | `display.ts` already covered | Svelte markup / CSS |
| #3 B coalescer | **Yes** — fake-timer burst/idle/max-wait | perceived smoothness |
| #4 B memo/morph | pure position cache | jank on large desks |

---

## Risks & ordering dependencies

1. **Do #1 before the C part of #2.** The single-root restructure relies on clean portal teardown; landing portal.ts hardening first means the restructured drawer is covered by the same nav-leak safety net, and you can unit-prove #1 independently of any Svelte change.
2. **portal.ts is shared — regression-check the other two consumers.** The `destroy()` change also runs for `BuildViewModal.svelte:60` and `MobileBottomSheet.svelte:84`. The `else if (node.parentNode && node.parentNode !== originalParent)` guard is conservative (only removes a node that was genuinely portaled out and whose original parent is gone), so the normal toggle-close path is unchanged — but smoke-test the BuildViewModal open/close and the mobile bottom sheet after this edit.
3. **#2 internal ordering:** apply C (single-root wrap) → D (footer phases, which edits `.d-foot`) → A (badge markup). D and A both touch the drawer body/footer; doing the structural wrap first avoids re-matching moved blocks.
4. **B is staged:** ship #3 (coalescer) alone first — it's the smallest change with the largest effect and is fully unit-testable. Only add #4 (memo + morph gating) if profiling still shows jank; #4 is the higher-risk change (touches the hot render path and derived graph).
5. **A decision point (flag, don't silently diverge):** `display.ts` returns literal hex (`#2d7d46` green, etc.), **not** the `--success/--warn/--error` tokens the task text references (e.g. helper green `#2d7d46` vs token `--success #2d7a3a`). Honour the helper output verbatim (it is the tested canon) and use tokens only for chip border/structure. Aligning the hex to tokens would require updating `display.test.ts` expectations → out of scope for this additive pass.
6. **`severityColor` (`display.ts:42-46`) has no desk consumer** — leave it unused; do not invent a render site.
7. **No backend/schema/route changes** anywhere in this plan. The explore endpoint (`/api/deepdive/[id]/explore/+server.ts`) already accepts `additionalContext`; `confidence`/`credibilityScore` are already `0..1 doublePrecision` (`schema.ts:418/:397`) matching the helper domains.
8. **Repro caveat (from C diagnosis):** the running `:5173` is a built/preview server that 500s on `/deepdive/[id]`; UI verification needs a real dev rebuild or a prod deploy (per repo policy, deploy then verify on `strangeramblings.com`). Plan the unit tests (#1, D helpers, #3) to carry the load-bearing correctness so you're not blocked on the live repro.