# Inspector Table + Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-JSON dumps in the canvas node inspector with the existing table-first `InspectorBody` renderer, extended with click-through drill-down for nested objects/arrays so jagged or nested data stays scannable instead of falling back to a wall of JSON.

**Architecture:** `InspectorBody.svelte` already detects shape (kv, array-of-objects, CSV, media URLs, …) and renders tables. Today it bails to a `<pre>JSON.stringify</pre>` for any cell whose value is itself an object/array. We extend it to render those cells as click-to-expand pills (`{3 fields}`, `[12 items]`) that recursively render the nested value through `InspectorBody` itself, capped at depth 4. Beyond the cap, a "View raw JSON" button drops to the existing `CollapsibleOutput` as the final escape hatch. Then we route every input/output render site in `src/routes/jkai/canvas/[slug]/+page.svelte` (currently 13 `<CollapsibleOutput text={pretty(…)}>` calls) through `InspectorBody` instead.

**Tech Stack:** SvelteKit, Svelte 5 runes, existing `$lib/canvas/InspectorBody.svelte`, existing `$lib/canvas/CollapsibleOutput.svelte`. No new dependencies.

**Out of scope (deliberate, do NOT add):** new `BasicConfigField` types (`account-ref`, `secret-ref`, `model-ref`, `node-output-ref`), template-textarea inline preview, pre-run output-shape ghost table, per-integration switch audit. These are tracked as follow-ups but not part of this plan.

---

## File Structure

**Modified files:**

- `src/lib/canvas/InspectorBody.svelte` — extend the renderer:
  - Accept new optional props: `depth?: number` (default 0), `maxDepth?: number` (default 4).
  - Replace inline `<pre>JSON.stringify(v, null, 2)</pre>` cells with a `<NestedCell>` button that toggles an expanded inline panel rendering the nested value through `InspectorBody` recursively (passing `depth + 1`).
  - When an expanded child would exceed `maxDepth`, render a "View raw JSON" button that opens a small `CollapsibleOutput` with `JSON.stringify(value, null, 2)` instead of recursing further.
  - Add cell click-to-copy with a brief flash, and `title` attributes on truncated cells so the full value is visible on hover.
  - Keep all existing format detection and special renderers (image/video/audio/web/HTML/CSV) untouched.

- `src/routes/jkai/canvas/[slug]/+page.svelte` — replace every input/output render site with `InspectorBody`:
  - Line 3514: edge inspector — `inspectorFrom.outputData`.
  - Line 3528: edge inspector — `inspectorTo.inputData`.
  - Lines 3950, 3966, 4034, 4066, 4088, 4122, 4132, 4162, 4330, 4430: node context-menu I/O sections (`menuNode.inputData` / `menuNode.outputData`, plus the one `intelFocus` derivative at 4430).
  - Existing `<InspectorBody data={n.inputData} />` at line 2974 remains as-is.
  - `CollapsibleOutput` import stays — it's still used by `InspectorBody`'s deep-fallback and by the error-text rendering.

**No new files. No deletions. No test files** (the existing project has no Svelte component test infrastructure for canvas components — `*.test.ts` exists only for chat / job-store TS modules. Verification is visual on the dev server, called out per task.).

---

## Task 1: Extend `InspectorBody` with depth-aware recursion props

**Files:**
- Modify: `src/lib/canvas/InspectorBody.svelte`

- [ ] **Step 1: Add `depth` and `maxDepth` props**

In the runtime `<script lang="ts">` block (around line 113), change:

```ts
let { data }: { data: unknown } = $props();
```

to:

```ts
let {
  data,
  depth = 0,
  maxDepth = 4,
}: { data: unknown; depth?: number; maxDepth?: number } = $props();
```

These props are additive — every existing call site passes only `data`, so defaults preserve current behaviour.

- [ ] **Step 2: Verify the dev server still builds**

Run from `~/strange_rambling_svelte/`:

```bash
npm run dev
```

Open `http://homeserv:5173/jkai/canvas/<any-existing-canvas-slug>` and click a node to open its context menu. Expected: panel renders unchanged (depth/maxDepth defaults match prior behaviour).

- [ ] **Step 3: Commit**

```bash
git add src/lib/canvas/InspectorBody.svelte
git commit -m "feat(inspector): add depth/maxDepth props to InspectorBody"
```

---

## Task 2: Replace inline JSON cells with click-to-expand nested cells

**Files:**
- Modify: `src/lib/canvas/InspectorBody.svelte`

- [ ] **Step 1: Add a per-row expansion state map and a self-reference for recursion**

In the runtime `<script lang="ts">` block, after the existing `$derived` declarations (around line 133), add:

```ts
// Tracks which nested cells are currently expanded.
// Key shape: `${rowKey}:${cellKey}` for kv-rows, `${rowIndex}:${columnKey}` for tables.
const expanded = $state(new Set<string>());

function toggle(key: string) {
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
}

function isComplexCell(v: unknown): boolean {
  return v !== null && typeof v === 'object';
}

function pillLabel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length} ${v.length === 1 ? 'item' : 'items'}]`;
  if (v && typeof v === 'object') {
    const n = Object.keys(v as Record<string, unknown>).length;
    return `{${n} ${n === 1 ? 'field' : 'fields'}}`;
  }
  return '';
}
```

Svelte 5 supports recursive component references via `<svelte:self>` (still works in Svelte 5 even if marked legacy in newer minors). If `svelte-check` flags `<svelte:self>` as deprecated in this codebase's Svelte version, replace it with a normal self-import — at the top of the runtime `<script>` add `import InspectorBody from './InspectorBody.svelte';` and use `<InspectorBody data={…} depth={depth + 1} {maxDepth} />` in the templates instead. The semantics are identical.

- [ ] **Step 2: Update the kv-table cell rendering to use expand-pill + recursive render**

Replace the kv block (currently lines 171–187, the `{:else if format === 'json-obj'}` branch):

```svelte
{:else if format === 'json-obj'}
  <table class="kv">
    <tbody>
      {#each objRows as [k, v] (k)}
        <tr>
          <th>{k}</th>
          <td>
            {#if v && typeof v === 'object'}
              <pre class="sub">{JSON.stringify(v, null, 2)}</pre>
            {:else}
              {cellText(v)}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
```

with:

```svelte
{:else if format === 'json-obj'}
  <table class="kv">
    <tbody>
      {#each objRows as [k, v] (k)}
        {@const cellKey = `kv:${k}`}
        {@const isOpen = expanded.has(cellKey)}
        <tr>
          <th>{k}</th>
          <td>
            {#if isComplexCell(v)}
              <button
                type="button"
                class="pill"
                aria-expanded={isOpen}
                onclick={() => toggle(cellKey)}
              >
                <span class="pill-label">{pillLabel(v)}</span>
                <span class="pill-caret">{isOpen ? '▾' : '▸'}</span>
              </button>
              {#if isOpen}
                <div class="nested">
                  {#if depth + 1 >= maxDepth}
                    <CollapsibleOutput text={JSON.stringify(v, null, 2)} />
                  {:else}
                    <svelte:self data={v} depth={depth + 1} {maxDepth} />
                  {/if}
                </div>
              {/if}
            {:else}
              <button
                type="button"
                class="copy-cell"
                title={cellText(v)}
                onclick={() => copyCell(cellText(v), cellKey)}
              >{cellText(v)}{#if copiedKey === cellKey}<span class="copied">copied</span>{/if}</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
```

- [ ] **Step 3: Add the matching click-to-copy state (used by the cell button above)**

In the runtime `<script>` after the helpers added in Step 1, add:

```ts
let copiedKey = $state<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function copyCell(value: string, key: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(value).catch(() => {});
  }
  copiedKey = key;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedKey = null;
  }, 900);
}
```

- [ ] **Step 4: Update the array-of-objects table cell rendering identically**

Replace the array-of-objects block (currently lines 188–208, the `{:else if format === 'json-array-of-objects'}` branch):

```svelte
{:else if format === 'json-array-of-objects'}
  <div class="scroll-x">
    <table class="tbl">
      <thead>
        <tr>
          {#each tableKeys as k (k)}
            <th>{k}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each tableRows as r, i (i)}
          <tr>
            {#each tableKeys as k (k)}
              <td>{cellText(r[k])}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
```

with:

```svelte
{:else if format === 'json-array-of-objects'}
  <div class="scroll-x">
    <table class="tbl">
      <thead>
        <tr>
          {#each tableKeys as k (k)}
            <th>{k}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each tableRows as r, i (i)}
          {@const rowHasOpen = tableKeys.some((k) => expanded.has(`row:${i}:${k}`))}
          <tr class:row-open={rowHasOpen}>
            {#each tableKeys as k (k)}
              {@const v = r[k]}
              {@const cellKey = `row:${i}:${k}`}
              {@const isOpen = expanded.has(cellKey)}
              <td class:cell-open={isOpen}>
                {#if v === undefined}
                  <span class="missing">—</span>
                {:else if isComplexCell(v)}
                  <button
                    type="button"
                    class="pill"
                    aria-expanded={isOpen}
                    onclick={() => toggle(cellKey)}
                  >
                    <span class="pill-label">{pillLabel(v)}</span>
                    <span class="pill-caret">{isOpen ? '▾' : '▸'}</span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="copy-cell"
                    title={cellText(v)}
                    onclick={() => copyCell(cellText(v), cellKey)}
                  >{cellText(v)}{#if copiedKey === cellKey}<span class="copied">copied</span>{/if}</button>
                {/if}
              </td>
            {/each}
          </tr>
          {#each tableKeys as k (k)}
            {@const v = r[k]}
            {@const cellKey = `row:${i}:${k}`}
            {#if expanded.has(cellKey) && isComplexCell(v)}
              <tr class="nested-row">
                <td colspan={tableKeys.length}>
                  <div class="nested nested-inline">
                    <span class="nested-crumb">{k}</span>
                    {#if depth + 1 >= maxDepth}
                      <CollapsibleOutput text={JSON.stringify(v, null, 2)} />
                    {:else}
                      <svelte:self data={v} depth={depth + 1} {maxDepth} />
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        {/each}
      </tbody>
    </table>
  </div>
```

This keeps the parent row visible and inserts the expanded payload as a full-width row beneath it (one nested row per expanded cell — keeps multiple drill-downs from the same parent legible).

- [ ] **Step 5: Import `CollapsibleOutput` for the deep-fallback path**

At the top of the runtime `<script lang="ts">` (right after `let { … } = $props();`), import the existing component:

```ts
import CollapsibleOutput from './CollapsibleOutput.svelte';
```

- [ ] **Step 6: Add styles for pills, expanded cells, and the nested row**

Append to the `<style>` block (before the closing `</style>`):

```css
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: var(--bg);
  color: var(--text-muted);
  border: 1px solid var(--card-border);
  border-radius: 2px;
  cursor: pointer;
  outline: none;
}
.pill:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.pill[aria-expanded='true'] {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(196, 87, 10, 0.08);
}
.pill-caret {
  font-size: 9px;
  line-height: 1;
}
.copy-cell {
  display: inline;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  position: relative;
}
.copy-cell:hover {
  color: var(--accent);
}
.copied {
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.missing {
  color: var(--text-ghost);
  font-style: italic;
}
.nested {
  margin-top: 6px;
  padding: 6px 8px;
  border-left: 2px solid var(--accent);
  background: rgba(255, 255, 255, 0.02);
}
.nested-inline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nested-crumb {
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-ghost);
}
.nested-row td {
  background: var(--bg);
  border-top: none;
  padding: 0 8px 8px;
}
.row-open td {
  border-bottom: none;
}
.cell-open {
  background: rgba(196, 87, 10, 0.06);
}
```

- [ ] **Step 7: Manual smoke test in the dev server**

`npm run dev` (if not already running) and open a canvas with at least one already-run node whose output contains nested objects (any `gmail-fetch`, `stealth-scrape`, or `llm-call` node will do). Click the node, open its context menu. Expected:

- Top-level object renders as the existing kv-table (no change for flat fields).
- A nested object value (e.g. `metadata`, `headers`) shows a `{N fields} ▸` pill instead of the raw `{ … }` JSON `<pre>`.
- Clicking the pill expands it inline below the cell, recursively rendered.
- Click again collapses.
- Single-value cells flash "copied" and copy to clipboard on click.

If the canvas only renders flat data, open the inspector on an `llm-call` node — its output always has nested `usage`, `meta`, etc.

- [ ] **Step 8: Commit**

```bash
git add src/lib/canvas/InspectorBody.svelte
git commit -m "feat(inspector): click-to-expand nested cells with depth-cap fallback"
```

---

## Task 3: Route node context-menu I/O sections through `InspectorBody`

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (multiple discrete sites)

> Each step below replaces one or two adjacent call sites. They are independent, ordered top-to-bottom in the file. Line numbers are at time of writing — search by surrounding context if they've drifted.

- [ ] **Step 1: Replace edge-inspector output and input sites (lines ~3514, ~3528)**

Find the existing block:

```svelte
{#if inspectorFrom.outputData !== undefined}
  <CollapsibleOutput text={pretty(inspectorFrom.outputData)} />
{/if}
```

Replace with:

```svelte
{#if inspectorFrom.outputData !== undefined}
  <InspectorBody data={inspectorFrom.outputData} />
{/if}
```

And similarly the next one a few lines down:

```svelte
{#if inspectorTo.inputData !== undefined}
  <CollapsibleOutput text={pretty(inspectorTo.inputData)} />
{/if}
```

Replace with:

```svelte
{#if inspectorTo.inputData !== undefined}
  <InspectorBody data={inspectorTo.inputData} />
{/if}
```

- [ ] **Step 2: Replace `kind === 'parse'` I/O sites (lines ~3950, ~3966)**

Find the surrounding `{:else if menuNode.kind === 'parse'}` block. Two sites to replace:

```svelte
{#if menuNode.inputData !== undefined}
  <CollapsibleOutput text={pretty(menuNode.inputData)} />
{:else}
  <pre class="ghost">// no run yet — press ▶ Run to pipe data</pre>
{/if}
```

becomes:

```svelte
{#if menuNode.inputData !== undefined}
  <InspectorBody data={menuNode.inputData} />
{:else}
  <pre class="ghost">// no run yet — press ▶ Run to pipe data</pre>
{/if}
```

And the matching outputData site in the same block — same shape, same replacement: `pretty(menuNode.outputData)` → `data={menuNode.outputData}`, component swap.

- [ ] **Step 3: Replace `kind === 'output'` I/O sites (lines ~4034, ~4066, ~4088)**

In the `{:else if menuNode.kind === 'output'}` branch, three call sites — apply the same `<CollapsibleOutput text={pretty(X)} />` → `<InspectorBody data={X} />` replacement to each. The surrounding `{#if … !== undefined}` / `{:else}` ghost-pre blocks are unchanged.

- [ ] **Step 4: Replace remaining context-menu I/O sites (lines ~4122, ~4132, ~4162)**

Same mechanical swap applied to:
- The site at ~4122 (`menuNode.inputData`)
- The site at ~4132 (`menuNode.outputData`)
- The site at ~4162 (`menuNode.outputData`)

- [ ] **Step 5: Replace `kind === 'intel'` input site (line ~4330)**

Same swap: `<CollapsibleOutput text={pretty(menuNode.inputData)} />` → `<InspectorBody data={menuNode.inputData} />`.

- [ ] **Step 6: Replace `intel-focus` output site (line ~4430)**

This one passes a derived value, not the raw outputData. Replace:

```svelte
<CollapsibleOutput text={pretty((menuNode.outputData as any)?.intelFocus ?? menuNode.outputData)} />
```

with:

```svelte
<InspectorBody data={(menuNode.outputData as Record<string, unknown> | undefined)?.intelFocus ?? menuNode.outputData} />
```

(Replace `as any` with the safer cast while we're touching it — `intelFocus` is unknown structure but indexing through `Record<string, unknown>` is enough to avoid the lint while still passing the value through to `InspectorBody`, which accepts `unknown`.)

- [ ] **Step 7: Verify no orphaned `CollapsibleOutput text={pretty(…)}` calls remain in the canvas page**

Run:

```bash
grep -n "CollapsibleOutput text={pretty(" /home/john/strange_rambling_svelte/src/routes/jkai/canvas/\[slug\]/+page.svelte
```

Expected output: nothing. (If any remain, replace them — they were missed.)

`CollapsibleOutput` may still appear in the file for error-text sections; those are not `pretty(...)` wraps and stay as-is.

- [ ] **Step 8: Confirm `InspectorBody` and `CollapsibleOutput` imports are still both needed**

`InspectorBody` is now used widely; the `CollapsibleOutput` import (line 44) should remain because:
- The error-text rendering blocks still use raw `<pre class="error-text">…</pre>` (unrelated to CollapsibleOutput, no action needed).
- `InspectorBody` itself imports `CollapsibleOutput` for the deep-fallback (Task 2 step 5).

If, after Step 7, no `CollapsibleOutput` references remain in the canvas page, delete its import. Otherwise leave it.

Run:

```bash
grep -n "CollapsibleOutput" /home/john/strange_rambling_svelte/src/routes/jkai/canvas/\[slug\]/+page.svelte
```

If the only match is the import line itself, remove the import. Otherwise leave it untouched.

- [ ] **Step 9: Type-check the canvas page**

Run from `~/strange_rambling_svelte/`:

```bash
npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -A 3 "canvas/\[slug\]" | head -40
```

Expected: no errors referencing the canvas page. Warnings unrelated to this change can be ignored. If type errors appear (likely around the `intelFocus` cast in Step 6), tighten the cast as needed but keep the value being passed into `data` unchanged.

- [ ] **Step 10: Manual smoke test of every node-kind context menu**

`npm run dev` and at `http://homeserv:5173/jkai/canvas/<slug>`:

1. Right-click an `input` (trigger) node → INPUT/OUTPUT sections render as kv-tables / scalar boxes / "no run yet" ghost text.
2. Right-click a `parse` node after a run → both sections render.
3. Right-click a downstream/`output` node after a run → both sections render. If the upstream produced an array of objects, you should see a multi-row table with sticky header.
4. Click an edge between two nodes → edge inspector shows source-output and target-input as `InspectorBody`.
5. Right-click an `intel-query` node → input section renders.
6. Where data has nested objects, click a `{N fields}` pill → expands inline.
7. Where data has arrays of objects with nested cells, click an `[N items]` pill in a row → expands inline as a sub-row.
8. Click a flat cell → flashes "copied" briefly, value is in clipboard.
9. Where the underlying data is a URL to an image (e.g. a scraper screenshot output), the panel renders the image (already-supported behaviour, now reachable from the menu).

- [ ] **Step 11: Commit**

```bash
git add src/routes/jkai/canvas/\[slug\]/+page.svelte
git commit -m "feat(canvas): route node I/O panels through InspectorBody"
```

---

## Task 4: Final verification + deploy

**Files:** none to modify — verification only.

- [ ] **Step 1: Re-run type check end-to-end**

```bash
cd ~/strange_rambling_svelte
npx svelte-check --tsconfig ./tsconfig.json
```

Expected: no new errors introduced by this change. Existing warnings/errors unrelated to `InspectorBody` or the canvas page can be ignored.

- [ ] **Step 2: Build to make sure the production bundle compiles**

```bash
cd ~/strange_rambling_svelte
npm run build
```

Expected: build completes successfully. SvelteKit will warn on any unused imports — fix them if introduced.

- [ ] **Step 3: Push and deploy**

```bash
cd ~/strange_rambling_svelte
git push
~/strange_rambling_svelte/scripts/deploy.sh
```

Expected: deploy script completes, site reachable at `https://strangeramblings.com`. (Per project memory: always deploy after pushing.)

- [ ] **Step 4: Spot-check on production**

Open `https://strangeramblings.com/jkai/canvas/<existing-slug>`, repeat the relevant subset of the smoke tests from Task 3 Step 10 — expect identical behaviour to dev.

---

## Follow-ups (NOT in this plan)

Tracked here so they don't get lost; create separate plans when picking each up:

1. New `BasicConfigField` types: `account-ref` (replaces `accountId: number` raw inputs in `gmail-send`, `gmail-reply`, etc.), `secret-ref` (vault picker), `model-ref` (Vertex/OpenRouter dropdown), `node-output-ref` (pick upstream field instead of typing `{{input.x}}` blind).
2. Inline live preview under every `template-textarea`, rendered against the upstream node's last `outputData`.
3. Pre-run output-shape ghost table — when no run has happened yet, show the declared `outputs[]` / `getOutputSchema` as a ghosted table preview instead of `// pending`.
4. Per-integration switch audit — pick 3–4 high-traffic integration nodes (whatsapp, gmail-send, stealth-scrape) and add the 2–3 missing switches that genuinely change behaviour.
