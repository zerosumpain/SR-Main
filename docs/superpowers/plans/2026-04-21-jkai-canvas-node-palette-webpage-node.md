# jkai Canvas Node Palette + Webpage Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the jkai canvas `+ node` dropdown with a unified, context-aware Node Palette, and add a new Webpage node that renders live pages with a transparent headless-browser (Playwright) fallback.

**Architecture:** A single Svelte 5 `NodePalette` component is invoked by four triggers (⌘K/`/`, right-click, long-press, drag-from-handle-into-empty-space) and operates in two modes — strict-downstream (filter by source output types) and workflow-ranked (rank candidates by compatibility with nodes already on the canvas). Every node type in `adapter.ts` gains `handles: { inputs, outputs }` metadata to drive both the filter and the scoring. A new `WebpageNode` renders URLs in an iframe; if the probed site blocks framing, the iframe transparently falls back to a Playwright-rendered stream served by a sidecar container on homeserv.

**Tech Stack:** Svelte 5 (Runes), SvelteKit, Drizzle/Postgres (schema unchanged), Vitest for unit tests, `@mozilla/readability` (already installed), Playwright-chromium sidecar via `docker-compose.webframe.yml`, `@xyflow/svelte` is NOT used (the canvas is a custom SVG implementation in `/jkai/canvas/[slug]/+page.svelte`).

**Spec:** `docs/superpowers/specs/2026-04-21-jkai-canvas-node-palette-webpage-node-design.md`

---

## File Structure

**New files:**

- `src/lib/canvas/handles.ts` — `HandleKind`, `HandleSpec`, `compatibility()`, `scoreCandidate()`, `rankForWorkflow()`
- `src/lib/canvas/recents.ts` — localStorage-backed recent-palette-pick helper
- `src/lib/canvas/NodePalette.svelte` — unified picker component
- `src/lib/canvas/nodes/WebpageNode.svelte` — webpage node body renderer
- `src/lib/canvas/OpenAsWebpageButton.svelte` — reusable "spawn webpage node from URL" affordance
- `src/routes/api/webframe/probe/+server.ts` — framing-permissiveness probe
- `src/routes/api/webframe/render/+server.ts` — Playwright-rendered stream + SSE
- `src/routes/api/webframe/event/+server.ts` — client → server input forwarding
- `src/routes/api/webframe/extract/+server.ts` — Readability extraction
- `services/webframe/Dockerfile`
- `services/webframe/package.json`
- `services/webframe/server.ts`
- `docker-compose.webframe.yml`
- `tests/lib/canvas/handles.test.ts`
- `tests/lib/canvas/recents.test.ts`
- `tests/routes/api/webframe/probe.test.ts`
- `tests/routes/api/webframe/extract.test.ts`

**Modified files:**

- `src/lib/canvas/adapter.ts` — add `handles` metadata for every existing node type, register new `webpage` type
- `src/lib/canvas/intelligence/ResearchResultNode.svelte` — embed `<OpenAsWebpageButton>` next to each citation
- `src/routes/jkai/canvas/[slug]/+page.svelte` — remove old `+ node` pill + two-level dropdown; wire four palette triggers; render typed input handles; populate `sourceHandle`/`targetHandle` on edge creation; render new `WebpageNode` when `type === 'webpage'`
- `src/routes/api/workflows/[id]/nodes/+server.ts` — allow `type = "webpage"` through validation
- `.env.example` — document `PUBLIC_CANVAS_NEW_PALETTE` feature flag and `WEBFRAME_SERVICE_URL`

**No DB migration.** `workflow_nodes.type` is freeform TEXT; `workflow_edges.sourceHandle` / `targetHandle` are already nullable TEXT.

---

## Phase A — Handle type system (pure functions, no UI)

### Task A1: Handle metadata + compatibility + scoring (`handles.ts`)

**Files:**
- Create: `src/lib/canvas/handles.ts`
- Test: `tests/lib/canvas/handles.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/canvas/handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  compatibility,
  scoreCandidate,
  rankForWorkflow,
  type HandleKind,
  type NodeHandles,
} from '$lib/canvas/handles';

const chat: NodeHandles = {
  inputs: [{ id: 'trigger', kinds: ['trigger-signal', 'text'] }],
  outputs: [{ id: 'out', kinds: ['text'] }],
};
const llm: NodeHandles = {
  inputs: [{ id: 'in', kinds: ['text'] }],
  outputs: [{ id: 'out', kinds: ['text'] }],
};
const webpage: NodeHandles = {
  inputs: [{ id: 'src', kinds: ['url', 'research-result', 'text'] }],
  outputs: [
    { id: 'currentUrl', kinds: ['url'] },
    { id: 'selectedText', kinds: ['text'] },
    { id: 'extractedText', kinds: ['text'] },
  ],
};
const stats: NodeHandles = {
  inputs: [{ id: 'data', kinds: ['dataset'] }],
  outputs: [],
};

describe('compatibility', () => {
  it('returns 1 when any output kind intersects any input kind', () => {
    expect(compatibility(chat.outputs, llm.inputs)).toBe(1);
  });
  it('returns 0 when no output kinds intersect', () => {
    expect(compatibility(chat.outputs, stats.inputs)).toBe(0);
  });
  it("treats 'any' as wildcard on either side", () => {
    const anyIn: NodeHandles['inputs'] = [{ id: 'x', kinds: ['any'] }];
    expect(compatibility(chat.outputs, anyIn)).toBe(1);
    const anyOut: NodeHandles['outputs'] = [{ id: 'x', kinds: ['any'] }];
    expect(compatibility(anyOut, stats.inputs)).toBe(1);
  });
  it('handles empty output arrays', () => {
    expect(compatibility([], llm.inputs)).toBe(0);
  });
});

describe('scoreCandidate', () => {
  it('sums compatibility across all canvas nodes', () => {
    const onCanvas = [chat, chat, llm]; // all output text
    expect(scoreCandidate(llm, onCanvas, 0, 0)).toBe(3);
  });
  it('adds recent-usage boost capped at +3', () => {
    expect(scoreCandidate(llm, [], 5, 0)).toBe(3); // capped
    expect(scoreCandidate(llm, [], 2, 0)).toBe(2);
  });
  it('adds default-weight tiebreaker', () => {
    expect(scoreCandidate(llm, [], 0, 0.5)).toBeCloseTo(0.5);
  });
});

describe('rankForWorkflow', () => {
  it('returns top N candidates sorted by score', () => {
    const candidates = [
      { type: 'llm-call', handles: llm, defaultWeight: 0.5 },
      { type: 'stats-summary', handles: stats, defaultWeight: 0 },
      { type: 'webpage', handles: webpage, defaultWeight: 0.2 },
    ];
    const ranked = rankForWorkflow(candidates, [chat], {}, 2);
    expect(ranked.map((c) => c.type)).toEqual(['llm-call', 'webpage']);
  });
  it('samples the 50 most recent nodes when >50 on canvas', () => {
    const many = Array.from({ length: 100 }, () => stats); // 100 stats, no text outputs
    const candidates = [{ type: 'llm-call', handles: llm, defaultWeight: 0 }];
    const ranked = rankForWorkflow(candidates, many, {}, 1);
    // llm-call scores 0 (stats has no outputs) — should still be in ranked list
    expect(ranked.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/canvas/handles.test.ts`
Expected: FAIL with "Cannot find module '$lib/canvas/handles'"

- [ ] **Step 3: Implement `handles.ts`**

Create `src/lib/canvas/handles.ts`:

```ts
export type HandleKind =
  | 'text'
  | 'url'
  | 'image'
  | 'json'
  | 'dataset'
  | 'research-result'
  | 'intel-session'
  | 'trigger-signal'
  | 'any';

export type HandleSpec = {
  id: string;
  kinds: HandleKind[];
  label?: string;
  required?: boolean;
};

export type NodeHandles = {
  inputs: HandleSpec[];
  outputs: HandleSpec[];
};

export type CandidateType = {
  type: string;
  handles: NodeHandles;
  defaultWeight: number;
};

const MAX_WORKFLOW_SAMPLE = 50;
const USAGE_BOOST_CAP = 3;

export function compatibility(
  outputs: HandleSpec[],
  inputs: HandleSpec[]
): 0 | 1 {
  if (outputs.length === 0 || inputs.length === 0) return 0;
  const outKinds = new Set(outputs.flatMap((o) => o.kinds));
  const inKinds = new Set(inputs.flatMap((i) => i.kinds));
  if (outKinds.has('any') || inKinds.has('any')) return 1;
  for (const k of outKinds) if (inKinds.has(k)) return 1;
  return 0;
}

export function scoreCandidate(
  candidate: NodeHandles,
  canvasNodes: NodeHandles[],
  recentUsageCount: number,
  defaultWeight: number
): number {
  const sample =
    canvasNodes.length > MAX_WORKFLOW_SAMPLE
      ? canvasNodes.slice(-MAX_WORKFLOW_SAMPLE)
      : canvasNodes;
  const compatSum = sample.reduce(
    (sum, n) => sum + compatibility(n.outputs, candidate.inputs),
    0
  );
  const boost = Math.min(recentUsageCount, USAGE_BOOST_CAP);
  return compatSum + boost + defaultWeight;
}

export function rankForWorkflow(
  candidates: CandidateType[],
  canvasNodes: NodeHandles[],
  recents: Record<string, number>,
  topN: number
): CandidateType[] {
  const scored = candidates.map((c) => ({
    candidate: c,
    score: scoreCandidate(
      c.handles,
      canvasNodes,
      recents[c.type] ?? 0,
      c.defaultWeight
    ),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.candidate);
}

export function filterDownstream(
  candidates: CandidateType[],
  sourceOutputs: HandleSpec[]
): CandidateType[] {
  return candidates.filter(
    (c) => compatibility(sourceOutputs, c.handles.inputs) === 1
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/canvas/handles.test.ts`
Expected: PASS, 9 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/handles.ts tests/lib/canvas/handles.test.ts
git commit -m "feat(canvas): add handle type + compatibility/ranking helpers"
```

---

### Task A2: Recent-pick helper (`recents.ts`)

**Files:**
- Create: `src/lib/canvas/recents.ts`
- Test: `tests/lib/canvas/recents.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/canvas/recents.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordPick, getRecentCounts, RECENTS_KEY, MAX_RECENTS } from '$lib/canvas/recents';

describe('recents', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('records picks and returns counts', () => {
    recordPick('llm-call');
    recordPick('llm-call');
    recordPick('chat');
    const counts = getRecentCounts();
    expect(counts['llm-call']).toBe(2);
    expect(counts['chat']).toBe(1);
  });

  it('caps recent history at MAX_RECENTS', () => {
    for (let i = 0; i < MAX_RECENTS + 5; i++) recordPick('chat');
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY)!);
    expect(raw.length).toBe(MAX_RECENTS);
  });

  it('returns empty counts when localStorage is unset', () => {
    expect(getRecentCounts()).toEqual({});
  });

  it('handles corrupted storage gracefully', () => {
    localStorage.setItem(RECENTS_KEY, 'not-json');
    expect(getRecentCounts()).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/canvas/recents.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement `recents.ts`**

Create `src/lib/canvas/recents.ts`:

```ts
export const RECENTS_KEY = 'canvasPaletteRecents';
export const MAX_RECENTS = 20;

function load(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(arr: string[]) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(RECENTS_KEY, JSON.stringify(arr));
}

export function recordPick(type: string) {
  const arr = load();
  arr.push(type);
  while (arr.length > MAX_RECENTS) arr.shift();
  save(arr);
}

export function getRecentCounts(): Record<string, number> {
  const arr = load();
  const counts: Record<string, number> = {};
  for (const t of arr) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/canvas/recents.test.ts`
Expected: PASS, 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/recents.ts tests/lib/canvas/recents.test.ts
git commit -m "feat(canvas): add localStorage-backed palette recents helper"
```

---

### Task A3: Populate `handles` on every node type in `adapter.ts`

**Files:**
- Modify: `src/lib/canvas/adapter.ts` (full file — add `handles` field to every node type definition and register the new `webpage` type)

- [ ] **Step 1: Read `adapter.ts` completely**

Run: `wc -l src/lib/canvas/adapter.ts && head -40 src/lib/canvas/adapter.ts`
Make sure you understand the `NodeTypeMeta` / registry shape before editing.

- [ ] **Step 2: Extend the registry type**

Update the type exported from `adapter.ts` so every node definition carries `handles`:

```ts
import type { NodeHandles } from './handles';

export type NodeTypeMeta = {
  // ...existing fields (type, label, description, group, defaults, etc.)
  handles: NodeHandles;
  defaultWeight?: number; // 0 if omitted
};
```

- [ ] **Step 3: Fill `handles` for every existing node type**

For each node type currently defined in the adapter, add a `handles` object using the following table as authoritative. When in doubt, use `any`.

| Type prefix / family | inputs | outputs |
|---|---|---|
| `trigger` (any trigger) | `[]` | `[{ id: 'signal', kinds: ['trigger-signal'] }]` |
| `chat` | `[{ id: 'trigger', kinds: ['trigger-signal','text'] }]` | `[{ id: 'out', kinds: ['text'] }]` |
| `llm-call`, `llm-*` | `[{ id: 'in', kinds: ['text','json'] }]` | `[{ id: 'out', kinds: ['text'] }]` |
| `parse-*`, `transform-*` | `[{ id: 'in', kinds: ['text','json'] }]` | `[{ id: 'out', kinds: ['text','json'] }]` |
| `intelligence`, `intel-*` | `[{ id: 'in', kinds: ['text'] }]` | `[{ id: 'out', kinds: ['intel-session','text'] }]` |
| `research-result` | `[{ id: 'in', kinds: ['text','intel-session'] }]` | `[{ id: 'result', kinds: ['research-result','text'] }]` |
| `stats-summary`, `stats-*` | `[{ id: 'data', kinds: ['dataset','json'] }]` | `[]` |
| `inspector` | `[{ id: 'in', kinds: ['any'] }]` | `[]` |
| `integration-*` | `[{ id: 'in', kinds: ['any'] }]` | `[{ id: 'out', kinds: ['any'] }]` |
| `observability-*` | `[{ id: 'in', kinds: ['any'] }]` | `[]` |

For any type the table doesn't cover, use `inputs: [{ id: 'in', kinds: ['any'] }], outputs: [{ id: 'out', kinds: ['any'] }]` and leave a `// TODO: refine` comment.

- [ ] **Step 4: Register the new `webpage` type**

Add to the "Intel & Web" group:

```ts
{
  type: 'webpage',
  label: 'Webpage',
  description: 'Render a live webpage inside the canvas (falls back to a proxy for sites that block framing).',
  group: 'Intel & Web',
  defaults: {
    config: { url: '', mode: null, size: { w: 720, h: 480 } },
  },
  handles: {
    inputs: [{ id: 'src', kinds: ['url', 'research-result', 'text'] }],
    outputs: [
      { id: 'currentUrl', kinds: ['url'] },
      { id: 'selectedText', kinds: ['text'] },
      { id: 'extractedText', kinds: ['text'] },
    ],
  },
  defaultWeight: 0.3,
}
```

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: no new errors. If `NodeTypeMeta.handles` is now required and some types slipped through, add them before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/adapter.ts
git commit -m "feat(canvas): add handle types to every node type; register webpage type"
```

---

## Phase B — Node Palette UI

### Task B1: NodePalette component

**Files:**
- Create: `src/lib/canvas/NodePalette.svelte`

- [ ] **Step 1: Create the component scaffold**

```svelte
<script lang="ts">
  import type { NodeHandles, HandleSpec, CandidateType } from './handles';
  import { rankForWorkflow, filterDownstream } from './handles';
  import { getRecentCounts, recordPick } from './recents';
  import { adapter } from './adapter';

  type Mode =
    | { kind: 'workflow-ranked' }
    | { kind: 'strict-downstream'; sourceType: string; sourceOutputs: HandleSpec[] };

  type Props = {
    open: boolean;
    anchor: { x: number; y: number } | 'center';
    mode: Mode;
    canvasNodes: { type: string }[];
    onPick: (type: string) => void;
    onClose: () => void;
  };

  let { open, anchor, mode, canvasNodes, onPick, onClose }: Props = $props();

  let query = $state('');
  let activeIndex = $state(0);

  const allCandidates: CandidateType[] = $derived(
    adapter.allTypes().map((t) => ({
      type: t.type,
      handles: t.handles,
      defaultWeight: t.defaultWeight ?? 0,
    }))
  );

  const canvasHandles: NodeHandles[] = $derived(
    canvasNodes
      .map((n) => adapter.byType(n.type)?.handles)
      .filter((h): h is NodeHandles => !!h)
  );

  const recents = $derived(getRecentCounts());

  const visible = $derived.by(() => {
    let candidates = allCandidates;
    if (mode.kind === 'strict-downstream') {
      candidates = filterDownstream(candidates, mode.sourceOutputs);
      if (candidates.length === 0) candidates = allCandidates; // degrade
    }
    const suggested = rankForWorkflow(candidates, canvasHandles, recents, 6);
    const q = query.trim().toLowerCase();
    const rest = q
      ? candidates.filter((c) => {
          const meta = adapter.byType(c.type)!;
          return (
            meta.label.toLowerCase().includes(q) ||
            meta.description.toLowerCase().includes(q) ||
            meta.type.toLowerCase().includes(q)
          );
        })
      : candidates;
    return { suggested, rest };
  });

  function pick(type: string) {
    recordPick(type);
    onPick(type);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') activeIndex++;
    if (e.key === 'ArrowUp') activeIndex = Math.max(0, activeIndex - 1);
    if (e.key === 'Enter') {
      const flat = [...visible.suggested, ...visible.rest];
      if (flat[activeIndex]) pick(flat[activeIndex].type);
    }
  }

  const style = $derived(
    anchor === 'center'
      ? 'left:50%; top:40%; transform:translate(-50%, -40%);'
      : `left:${anchor.x}px; top:${anchor.y}px;`
  );
</script>

{#if open}
  <div
    class="palette"
    style={style}
    role="dialog"
    aria-label="Node palette"
    onkeydown={onKey}
  >
    <input
      type="text"
      class="palette-search"
      placeholder="Search nodes…"
      bind:value={query}
      autofocus
    />

    {#if mode.kind === 'strict-downstream' && visible.suggested.length === 0}
      <div class="palette-banner">No strict matches — showing all</div>
    {/if}

    {#if visible.suggested.length > 0 && !query}
      <div class="palette-section">
        <div class="palette-section-label">Suggested</div>
        {#each visible.suggested as c, i}
          {@const meta = adapter.byType(c.type)}
          <button class="palette-row" class:active={i === activeIndex} onclick={() => pick(c.type)}>
            <span class="palette-row-label">{meta?.label}</span>
            <span class="palette-row-desc">{meta?.description}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="palette-section">
      <div class="palette-section-label">All nodes</div>
      {#each visible.rest as c, i}
        {@const meta = adapter.byType(c.type)}
        {@const offset = visible.suggested.length}
        <button
          class="palette-row"
          class:active={i + offset === activeIndex}
          onclick={() => pick(c.type)}
        >
          <span class="palette-row-label">{meta?.label}</span>
          <span class="palette-row-desc">{meta?.description}</span>
          {#if recents[c.type]}<span class="palette-row-recent">↺</span>{/if}
        </button>
      {/each}
    </div>
  </div>
  <div class="palette-scrim" onclick={onClose} aria-hidden="true"></div>
{/if}

<style>
  .palette { position: fixed; width: 420px; max-height: 60vh; overflow-y: auto; background: var(--bg-2); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.3); z-index: 1000; display: flex; flex-direction: column; }
  .palette-scrim { position: fixed; inset: 0; z-index: 999; }
  .palette-search { padding: 10px 12px; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--fg); outline: none; }
  .palette-banner { padding: 6px 12px; background: var(--bg-3); color: var(--fg-2); font-size: 12px; }
  .palette-section-label { padding: 6px 12px; text-transform: uppercase; font-size: 11px; color: var(--fg-2); letter-spacing: .05em; }
  .palette-row { display: flex; gap: 8px; align-items: baseline; padding: 8px 12px; text-align: left; background: transparent; border: none; color: var(--fg); cursor: pointer; }
  .palette-row:hover, .palette-row.active { background: var(--bg-3); }
  .palette-row-label { font-weight: 500; }
  .palette-row-desc { color: var(--fg-2); font-size: 12px; flex: 1; }
  .palette-row-recent { color: var(--accent); font-size: 12px; }
</style>
```

- [ ] **Step 2: Expose helpers on `adapter.ts`**

If `adapter.allTypes()` and `adapter.byType(type)` don't already exist, add them near the registry. `allTypes()` returns the full registered list; `byType(type)` returns the meta or `undefined`.

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/NodePalette.svelte src/lib/canvas/adapter.ts
git commit -m "feat(canvas): add NodePalette component (workflow-ranked + strict-downstream modes)"
```

---

### Task B2: Wire palette triggers in the canvas page

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (add trigger handlers, import and render `NodePalette`)

- [ ] **Step 1: Add palette state**

Near the top of the `<script>` block in `+page.svelte`:

```svelte
import NodePalette from '$lib/canvas/NodePalette.svelte';
import { adapter } from '$lib/canvas/adapter.ts';
import type { HandleSpec } from '$lib/canvas/handles.ts';

let paletteOpen = $state(false);
let paletteAnchor: { x: number; y: number } | 'center' = $state('center');
let paletteMode: import('$lib/canvas/NodePalette.svelte').Mode = $state({ kind: 'workflow-ranked' });
let pendingEdgeFromNodeId: string | null = $state(null);
```

- [ ] **Step 2: Implement open/close helpers**

```ts
function openPalette(opts: {
  anchor: typeof paletteAnchor;
  mode: typeof paletteMode;
  fromNodeId?: string | null;
}) {
  paletteAnchor = opts.anchor;
  paletteMode = opts.mode;
  pendingEdgeFromNodeId = opts.fromNodeId ?? null;
  paletteOpen = true;
}
function closePalette() {
  paletteOpen = false;
  pendingEdgeFromNodeId = null;
}
async function onPalettePick(type: string) {
  const pos =
    paletteAnchor === 'center'
      ? viewportCentreInWorldCoords()
      : screenToWorld(paletteAnchor.x, paletteAnchor.y);
  const placement = resolveOverlap(pos);
  const meta = adapter.byType(type);
  const newNode = await addNode(type, meta?.label ?? type, meta?.defaults?.config, placement);
  if (pendingEdgeFromNodeId && newNode) {
    const source = adapter.byType(nodes.find((n) => n.id === pendingEdgeFromNodeId)!.type);
    const target = meta;
    await addEdge({
      sourceNodeId: pendingEdgeFromNodeId,
      targetNodeId: newNode.id,
      sourceHandle: source?.handles.outputs[0]?.id ?? null,
      targetHandle: target?.handles.inputs[0]?.id ?? null,
    });
  }
  closePalette();
}
function resolveOverlap(p: { x: number; y: number }) {
  let { x, y } = p;
  while (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 40)) {
    x += 24; y += 24;
  }
  return { x, y };
}
```

- [ ] **Step 3: Wire ⌘K / `/` keyboard triggers**

```ts
function onGlobalKey(e: KeyboardEvent) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const metaKey = isMac ? e.metaKey : e.ctrlKey;
  const tagName = (e.target as HTMLElement)?.tagName;
  const typing = tagName === 'INPUT' || tagName === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
  if (metaKey && e.key === 'k') {
    e.preventDefault();
    openPalette({ anchor: 'center', mode: { kind: 'workflow-ranked' } });
  } else if (e.key === '/' && !typing) {
    e.preventDefault();
    openPalette({ anchor: 'center', mode: { kind: 'workflow-ranked' } });
  }
}
// in onMount:
window.addEventListener('keydown', onGlobalKey);
// in onDestroy:
window.removeEventListener('keydown', onGlobalKey);
```

- [ ] **Step 4: Wire right-click on empty canvas**

On the canvas viewport div, add:

```svelte
<div
  class="viewport"
  oncontextmenu={(e) => {
    if (e.target !== e.currentTarget) return; // node handles its own context menu
    e.preventDefault();
    openPalette({ anchor: { x: e.clientX, y: e.clientY }, mode: { kind: 'workflow-ranked' } });
  }}
>
```

- [ ] **Step 5: Wire long-press on empty canvas (touch)**

```ts
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressStart: { x: number; y: number } | null = null;
function onTouchStart(e: TouchEvent) {
  if (e.target !== e.currentTarget) return;
  const t = e.touches[0];
  longPressStart = { x: t.clientX, y: t.clientY };
  longPressTimer = setTimeout(() => {
    openPalette({ anchor: { x: t.clientX, y: t.clientY }, mode: { kind: 'workflow-ranked' } });
  }, 450);
}
function onTouchMove(e: TouchEvent) {
  if (!longPressStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - longPressStart.x, t.clientY - longPressStart.y) > 10) {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}
function onTouchEnd() {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressStart = null;
}
```

And add `ontouchstart`, `ontouchmove`, `ontouchend` to the viewport div.

- [ ] **Step 6: Wire drag-from-handle-into-empty-space**

Find the existing handle-drag release logic (around line 1155 where POST `/api/workflows/{id}/edges` happens). If the release is on empty canvas (not on a target node handle), instead of aborting, open the palette:

```ts
function onHandleDragEnd(e: PointerEvent, sourceNodeId: string) {
  const hitNode = nodeUnderPoint(e.clientX, e.clientY);
  if (hitNode) {
    // existing path: create edge
    return;
  }
  const source = adapter.byType(nodes.find((n) => n.id === sourceNodeId)!.type);
  openPalette({
    anchor: { x: e.clientX, y: e.clientY },
    mode: {
      kind: 'strict-downstream',
      sourceType: nodes.find((n) => n.id === sourceNodeId)!.type,
      sourceOutputs: source?.handles.outputs ?? [],
    },
    fromNodeId: sourceNodeId,
  });
}
```

- [ ] **Step 7: Render the palette in the page template**

Near the end of the template:

```svelte
<NodePalette
  open={paletteOpen}
  anchor={paletteAnchor}
  mode={paletteMode}
  canvasNodes={nodes}
  onPick={onPalettePick}
  onClose={closePalette}
/>
```

- [ ] **Step 8: Type-check and run the dev server**

Run: `npm run check && npm run dev`
Open the canvas, try each of the four triggers manually, confirm a node can be created via each.

- [ ] **Step 9: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): wire palette triggers (kbd, right-click, long-press, drag-from-handle)"
```

---

### Task B3: Render typed input/output handles on nodes

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (node rendering block and edge-create logic)

- [ ] **Step 1: Render input handles on the left edge of each node**

Find the node-div rendering block. Alongside the existing right-side output dot, render one left-side dot per `adapter.byType(node.type).handles.inputs` entry (spaced vertically). Add a title/tooltip with `label` and `kinds`.

```svelte
{#each adapter.byType(node.type)?.handles.inputs ?? [] as h, i}
  <div
    class="handle handle-input"
    style:top={`${10 + i * 16}px`}
    data-handle-id={h.id}
    title={`${h.label ?? h.id} (${h.kinds.join(', ')})`}
  ></div>
{/each}
```

Mirror the same for outputs on the right edge.

- [ ] **Step 2: Populate `sourceHandle` / `targetHandle` on edge creation**

In the POST body for `/api/workflows/{id}/edges`, include both `sourceHandle` and `targetHandle` — read from `data-handle-id` on the drag start and drop elements.

- [ ] **Step 3: Enforce compatibility at drop time**

When dropping on a target handle, compute `compatibility(sourceOutputs, targetInputs)`. If 0, flash the target red and show a tooltip `"{sourceKind} output → {targetKind} input: not compatible"`. Provide a right-click `Connect anyway` menu item on the attempted edge that writes NULL handles and skips the compatibility check.

- [ ] **Step 4: Dev-server smoke test**

Run `npm run dev`, open the canvas, try:
- Compatible drag (chat → llm-call): edge is created
- Incompatible drag (chat → stats-summary): target flashes red
- Right-click "Connect anyway" on the incompatible attempt: edge created with NULL handles

- [ ] **Step 5: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): render typed handles and enforce compatibility on edge creation"
```

---

### Task B4: Remove the old `+ node` dropdown

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (delete lines ~1456 and 1494–1565 range — verify line numbers before deleting)

- [ ] **Step 1: Locate the old UI**

Run: `grep -n "composer-pill\|addNodeOpen" src/routes/jkai/canvas/[slug]/+page.svelte`
Confirm the `+ node` pill and the two-level dropdown block.

- [ ] **Step 2: Remove both**

Delete the `<button class="composer-pill">+ node</button>` and the entire `{#if addNodeOpen}...{/if}` dropdown block. Delete the `addNodeOpen` state and all references.

- [ ] **Step 3: Verify the palette is the only entry point**

Run `npm run dev`, confirm no `+ node` pill appears, and that each of the four new triggers still opens the palette.

- [ ] **Step 4: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): remove old + node pill and hierarchical dropdown"
```

---

## Phase C — Webpage node (direct iframe, no proxy yet)

### Task C1: Accept `webpage` type server-side

**Files:**
- Modify: `src/routes/api/workflows/[id]/nodes/+server.ts`

- [ ] **Step 1: Inspect the validator**

Run: `head -60 src/routes/api/workflows/[id]/nodes/+server.ts`
Find the list of accepted `type` values (if any). If it's a freeform TEXT check, no change needed; otherwise add `'webpage'` to the allowed set.

- [ ] **Step 2: Update / confirm**

If a whitelist is in place, add `webpage`. If not, add a comment explaining why `type` remains freeform.

- [ ] **Step 3: Commit (only if changed)**

```bash
git add src/routes/api/workflows/[id]/nodes/+server.ts
git commit -m "feat(api): allow webpage node type through workflows nodes POST"
```

---

### Task C2: WebpageNode component — direct iframe only

**Files:**
- Create: `src/lib/canvas/nodes/WebpageNode.svelte`

- [ ] **Step 1: Component scaffold (direct iframe)**

```svelte
<script lang="ts">
  type Config = { url: string; mode: 'direct' | 'proxied' | null; size: { w: number; h: number } };
  type Props = {
    nodeId: string;
    config: Config;
    onConfigChange: (patch: Partial<Config>) => void;
    onOutput?: (handleId: 'currentUrl' | 'selectedText' | 'extractedText', value: string) => void;
  };
  let { nodeId, config, onConfigChange, onOutput }: Props = $props();

  let urlDraft = $state(config.url ?? '');
  let iframeEl: HTMLIFrameElement | undefined = $state();
  let fullscreen = $state(false);
  let statusText = $state('');
  let statusVisible = $state(false);
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function showStatus(text: string) {
    statusText = text;
    statusVisible = true;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (statusVisible = false), 2000);
  }

  function load() {
    if (!urlDraft) return;
    try {
      new URL(urlDraft);
    } catch {
      showStatus('Invalid URL');
      return;
    }
    onConfigChange({ url: urlDraft, mode: 'direct' });
    // Direct load only in C2 — proxy escalation added in D3
  }

  $effect(() => {
    if (!iframeEl) return;
    function onLoad() {
      showStatus('Loaded · direct');
      onOutput?.('currentUrl', config.url);
    }
    iframeEl.addEventListener('load', onLoad);
    return () => iframeEl?.removeEventListener('load', onLoad);
  });

  $effect(() => {
    function onMsg(e: MessageEvent) {
      if (e.source !== iframeEl?.contentWindow) return;
      if (e.data?.type === 'webframe-selection') {
        onOutput?.('selectedText', String(e.data.text ?? ''));
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });
</script>

<div class="webpage-node" class:fullscreen>
  <div class="header">
    <button onclick={() => iframeEl?.contentWindow?.location.reload()} title="Reload">↻</button>
    <input
      class="url-bar"
      type="text"
      bind:value={urlDraft}
      onkeydown={(e) => e.key === 'Enter' && load()}
      placeholder="https://…"
    />
    <button onclick={load}>Go</button>
    <a href={config.url || '#'} target="_blank" rel="noopener">↗</a>
    <button onclick={() => (fullscreen = !fullscreen)}>{fullscreen ? '✕' : '⤢'}</button>
  </div>
  <div class="viewport" style:width={`${config.size.w}px`} style:height={`${config.size.h}px`}>
    {#if config.url}
      <iframe
        bind:this={iframeEl}
        src={config.url}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        title="Webpage node"
      ></iframe>
    {:else}
      <div class="empty">Enter a URL above to load a page.</div>
    {/if}
  </div>
  {#if statusVisible}<div class="status">{statusText}</div>{/if}
</div>

<style>
  .webpage-node { display: flex; flex-direction: column; background: var(--bg-2); border-radius: 6px; overflow: hidden; }
  .webpage-node.fullscreen { position: fixed; inset: 20px; z-index: 900; }
  .header { display: flex; align-items: center; gap: 6px; padding: 2px 6px; background: var(--bg-3); font-size: 12px; }
  .url-bar { flex: 1; background: transparent; border: none; color: var(--fg); font-size: 12px; outline: none; }
  .viewport iframe { width: 100%; height: 100%; border: none; }
  .empty { color: var(--fg-2); padding: 24px; text-align: center; }
  .status { position: absolute; bottom: 4px; right: 4px; background: var(--bg-3); padding: 2px 6px; font-size: 11px; border-radius: 3px; }
</style>
```

- [ ] **Step 2: Render the new component in `+page.svelte`**

Where nodes are rendered, branch on `type === 'webpage'` and render `<WebpageNode>` with the node's `config` and an `onConfigChange` that POSTs back to `/api/workflows/[id]/nodes/[nodeId]` (or whichever existing patch endpoint is used).

- [ ] **Step 3: Dev-server smoke test**

Add a webpage node via the palette. Type `https://example.com`, press Enter. Confirm iframe loads and "Loaded · direct" briefly shows.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/nodes/WebpageNode.svelte src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): add WebpageNode with direct-iframe rendering"
```

---

## Phase D — Proxy fallback

### Task D1: `/api/webframe/probe` endpoint

**Files:**
- Create: `src/routes/api/webframe/probe/+server.ts`
- Test: `tests/routes/api/webframe/probe.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFramePermissiveness } from '$lib/webframe/probe-parse';

describe('parseFramePermissiveness', () => {
  it('returns canFrame=false when X-Frame-Options is DENY', () => {
    expect(parseFramePermissiveness({ 'x-frame-options': 'DENY' }, 'https://a.com').canFrame).toBe(false);
  });
  it('returns canFrame=false when X-Frame-Options is SAMEORIGIN and our origin differs', () => {
    expect(parseFramePermissiveness({ 'x-frame-options': 'SAMEORIGIN' }, 'https://a.com').canFrame).toBe(false);
  });
  it("returns canFrame=false when CSP frame-ancestors excludes ours", () => {
    expect(
      parseFramePermissiveness(
        { 'content-security-policy': "frame-ancestors 'self' https://other.com" },
        'https://a.com'
      ).canFrame
    ).toBe(false);
  });
  it('returns canFrame=true when headers are silent', () => {
    expect(parseFramePermissiveness({}, 'https://a.com').canFrame).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- tests/routes/api/webframe/probe.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `probe-parse.ts`**

Create `src/lib/webframe/probe-parse.ts`:

```ts
export function parseFramePermissiveness(
  headers: Record<string, string>,
  targetUrl: string
): { canFrame: boolean; reason?: string } {
  const xfo = (headers['x-frame-options'] ?? '').toUpperCase();
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return { canFrame: false, reason: `X-Frame-Options: ${xfo}` };
  const csp = headers['content-security-policy'] ?? '';
  const m = csp.match(/frame-ancestors\s+([^;]+)/i);
  if (m) {
    const allowed = m[1].trim().split(/\s+/);
    if (!allowed.includes('*') && !allowed.some((a) => a === "'self'" || a === new URL(targetUrl).origin))
      return { canFrame: false, reason: `CSP frame-ancestors: ${allowed.join(' ')}` };
  }
  return { canFrame: true };
}
```

- [ ] **Step 4: Implement the `+server.ts`**

Create `src/routes/api/webframe/probe/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { parseFramePermissiveness } from '$lib/webframe/probe-parse';
import { json, error } from '@sveltejs/kit';

const cache = new Map<string, { result: ReturnType<typeof parseFramePermissiveness>; expires: number }>();
const TTL_MS = 10 * 60 * 1000;

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get('url');
  if (!target) throw error(400, 'url required');
  try { new URL(target); } catch { throw error(400, 'invalid url'); }

  const cached = cache.get(target);
  if (cached && cached.expires > Date.now()) return json(cached.result);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 3000);
  try {
    const res = await fetch(target, { method: 'HEAD', signal: ac.signal, redirect: 'follow' });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const result = parseFramePermissiveness(headers, target);
    cache.set(target, { result, expires: Date.now() + TTL_MS });
    return json(result);
  } catch (e) {
    const result = { canFrame: true, reason: 'probe failed, assuming permissive' } as const;
    cache.set(target, { result, expires: Date.now() + TTL_MS });
    return json(result);
  } finally {
    clearTimeout(t);
  }
};
```

- [ ] **Step 5: Run tests + type-check**

Run: `npm test -- tests/routes/api/webframe/probe.test.ts && npm run check`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/webframe/probe-parse.ts src/routes/api/webframe/probe/+server.ts tests/routes/api/webframe/probe.test.ts
git commit -m "feat(webframe): add /api/webframe/probe endpoint with header parsing"
```

---

### Task D2: Playwright sidecar service

**Files:**
- Create: `services/webframe/Dockerfile`
- Create: `services/webframe/package.json`
- Create: `services/webframe/server.ts`
- Create: `docker-compose.webframe.yml`

- [ ] **Step 1: Write `services/webframe/package.json`**

```json
{
  "name": "webframe",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "1.47.0",
    "hono": "^4.0.0",
    "@hono/node-server": "^1.11.0"
  },
  "scripts": { "start": "node --loader ts-node/esm server.ts" }
}
```

- [ ] **Step 2: Write `services/webframe/server.ts`**

A minimal Hono server exposing:

- `GET /render?url=…&session=…` — launches (or reuses) a Chromium page for `session`, navigates to `url`, returns the rendered HTML with all URLs rewritten to absolute (so relative assets resolve).
- `POST /event` — body `{ session, kind, payload }`; dispatches click/scroll/input via `page.evaluate`.
- `GET /html?session=…` — returns current page HTML (for `/api/webframe/extract`).
- Session idle timeout 5 min; hard cap 6 concurrent pages; FIFO queue beyond that.

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type Page } from 'playwright';

const app = new Hono();
const sessions = new Map<string, { page: Page; lastTouched: number }>();
const CAP = 6;
const IDLE_MS = 5 * 60 * 1000;
let browser: Browser | null = null;

async function getBrowser() {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

async function getOrCreateSession(session: string) {
  const existing = sessions.get(session);
  if (existing) { existing.lastTouched = Date.now(); return existing.page; }
  if (sessions.size >= CAP) throw new Error('queue-full');
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  sessions.set(session, { page, lastTouched: Date.now() });
  return page;
}

setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [id, s] of sessions) if (s.lastTouched < cutoff) {
    s.page.context().close().catch(() => {});
    sessions.delete(id);
  }
}, 30_000);

app.get('/render', async (c) => {
  const url = c.req.query('url'); const session = c.req.query('session');
  if (!url || !session) return c.text('url, session required', 400);
  try {
    const page = await getOrCreateSession(session);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const html = await page.content();
    return c.html(html);
  } catch (e: any) {
    if (e.message === 'queue-full') return c.text('queue-full', 503);
    return c.text('render-failed: ' + e.message, 502);
  }
});

app.post('/event', async (c) => {
  const { session, kind, payload } = await c.req.json();
  const s = sessions.get(session);
  if (!s) return c.text('no-session', 404);
  s.lastTouched = Date.now();
  if (kind === 'click') await s.page.mouse.click(payload.x, payload.y);
  else if (kind === 'input') await s.page.keyboard.type(payload.text);
  else if (kind === 'scroll') await s.page.evaluate((d) => window.scrollBy(0, d), payload.dy);
  return c.json({ ok: true });
});

app.get('/html', async (c) => {
  const session = c.req.query('session');
  const s = session ? sessions.get(session) : null;
  if (!s) return c.text('no-session', 404);
  return c.text(await s.page.content());
});

serve({ fetch: app.fetch, port: 3000 });
```

- [ ] **Step 3: Write `services/webframe/Dockerfile`**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.47.0-jammy
WORKDIR /app
COPY package.json .
RUN npm install --no-audit --no-fund
COPY server.ts .
EXPOSE 3000
CMD ["npx","tsx","server.ts"]
```

- [ ] **Step 4: Write `docker-compose.webframe.yml`**

```yaml
services:
  webframe:
    build: ./services/webframe
    container_name: webframe
    restart: unless-stopped
    networks: [default]
    expose: ['3000']
```

- [ ] **Step 5: Bring up + smoke**

Run:
```bash
docker compose -f docker-compose.webframe.yml up --build -d
docker exec webframe curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/render?url=https://example.com&session=smoke"
```
Expected: `200`.

- [ ] **Step 6: Commit**

```bash
git add services/webframe docker-compose.webframe.yml
git commit -m "feat(webframe): add Playwright sidecar service for proxy rendering"
```

---

### Task D3: `/api/webframe/render` + `/api/webframe/event` endpoints

**Files:**
- Create: `src/routes/api/webframe/render/+server.ts`
- Create: `src/routes/api/webframe/event/+server.ts`

- [ ] **Step 1: Environment**

Add to `.env.example`:

```
WEBFRAME_SERVICE_URL=http://webframe:3000
```

- [ ] **Step 2: Implement `/api/webframe/render/+server.ts`**

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get('url'); const session = url.searchParams.get('session');
  if (!target || !session) throw error(400, 'url, session required');
  const svc = env.WEBFRAME_SERVICE_URL;
  if (!svc) throw error(503, 'webframe service not configured');
  const upstream = await fetch(`${svc}/render?url=${encodeURIComponent(target)}&session=${encodeURIComponent(session)}`);
  if (!upstream.ok) throw error(upstream.status, await upstream.text());
  const html = await upstream.text();
  const injected = html.replace(
    '</head>',
    `<script>window.addEventListener('click',e=>parent.postMessage({type:'webframe-click',x:e.clientX,y:e.clientY},'*'));
document.addEventListener('selectionchange',()=>{const t=document.getSelection()?.toString();if(t)parent.postMessage({type:'webframe-selection',text:t},'*')});
window.addEventListener('load',()=>parent.postMessage({type:'webframe-pong'},'*'));</script></head>`
  );
  return new Response(injected, { headers: { 'content-type': 'text/html; charset=utf-8' } });
};
```

- [ ] **Step 3: Implement `/api/webframe/event/+server.ts`**

```ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json();
  const svc = env.WEBFRAME_SERVICE_URL;
  if (!svc) throw error(503, 'webframe service not configured');
  const res = await fetch(`${svc}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw error(res.status, await res.text());
  return json(await res.json());
};
```

- [ ] **Step 4: Type-check**

Run: `npm run check`

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/webframe/render src/routes/api/webframe/event .env.example
git commit -m "feat(webframe): add render + event SvelteKit endpoints proxying Playwright sidecar"
```

---

### Task D4: Escalation logic in WebpageNode

**Files:**
- Modify: `src/lib/canvas/nodes/WebpageNode.svelte`

- [ ] **Step 1: Replace the direct-only `load()` with probe → direct + ping → proxy escalation**

```ts
async function load() {
  if (!urlDraft) return;
  try { new URL(urlDraft); } catch { showStatus('Invalid URL'); return; }
  const probe = await fetch(`/api/webframe/probe?url=${encodeURIComponent(urlDraft)}`).then((r) => r.json());
  if (probe.canFrame) {
    onConfigChange({ url: urlDraft, mode: 'direct' });
    scheduleEscalation(urlDraft); // escalate if no pong within 1s after load, or load never fires within 6s
  } else {
    onConfigChange({ url: urlDraft, mode: 'proxied' });
    showStatus('Loaded · proxied via homeserv');
  }
}

let escalationTimer: ReturnType<typeof setTimeout> | null = null;
let pongReceived = false;
function scheduleEscalation(target: string) {
  pongReceived = false;
  if (escalationTimer) clearTimeout(escalationTimer);
  escalationTimer = setTimeout(() => {
    if (!pongReceived) {
      onConfigChange({ url: target, mode: 'proxied' });
      showStatus('Loaded · proxied via homeserv');
    }
  }, 6000);
}

$effect(() => {
  function onMsg(e: MessageEvent) {
    if (e.source !== iframeEl?.contentWindow) return;
    if (e.data?.type === 'webframe-pong') {
      pongReceived = true;
      showStatus('Loaded · direct');
      if (escalationTimer) clearTimeout(escalationTimer);
    }
    if (e.data?.type === 'webframe-selection') onOutput?.('selectedText', String(e.data.text));
  }
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
});
```

- [ ] **Step 2: Compute the iframe `src` based on `mode`**

```svelte
{@const iframeSrc = config.mode === 'proxied'
  ? `/api/webframe/render?url=${encodeURIComponent(config.url)}&session=${nodeId}`
  : config.url}
<iframe bind:this={iframeEl} src={iframeSrc} ... />
```

- [ ] **Step 3: Show the `proxied` badge**

In the header:

```svelte
{#if config.mode === 'proxied'}<span class="badge">proxied</span>{/if}
```

- [ ] **Step 4: Dev-server smoke**

Run `npm run dev` and a live webframe sidecar via `docker compose -f docker-compose.webframe.yml up -d`. Create a webpage node, try `https://example.com` (direct), then try `https://github.com` (expected: flips to proxied, iframe renders via `/api/webframe/render`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/nodes/WebpageNode.svelte
git commit -m "feat(canvas): WebpageNode probe + auto-escalate to Playwright proxy on blocked pages"
```

---

## Phase E — Extraction + research integration

### Task E1: `/api/webframe/extract` endpoint

**Files:**
- Create: `src/routes/api/webframe/extract/+server.ts`
- Test: `tests/routes/api/webframe/extract.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { extractArticle } from '$lib/webframe/extract';

describe('extractArticle', () => {
  it('extracts main body text from article HTML', () => {
    const html = `<html><body><article><h1>Hello</h1><p>Body text here that is long enough to matter.</p></article></body></html>`;
    const out = extractArticle(html, 'https://a.com');
    expect(out.text).toContain('Body text here');
    expect(out.title).toBe('Hello');
  });
  it('returns empty text when input is junk', () => {
    expect(extractArticle('<html></html>', 'https://a.com').text).toBe('');
  });
});
```

- [ ] **Step 2: Implement `src/lib/webframe/extract.ts`**

```ts
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export function extractArticle(html: string, url: string): { text: string; title: string; byline: string | null } {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const art = reader.parse();
    return { text: art?.textContent?.trim() ?? '', title: art?.title ?? '', byline: art?.byline ?? null };
  } catch {
    return { text: '', title: '', byline: null };
  }
}
```

- [ ] **Step 3: Implement the endpoint**

Create `src/routes/api/webframe/extract/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { extractArticle } from '$lib/webframe/extract';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = (await request.json()) as { url: string; html?: string; session?: string };
  if (!body?.url) throw error(400, 'url required');
  let html = body.html;
  if (!html && body.session) {
    const svc = env.WEBFRAME_SERVICE_URL;
    if (!svc) throw error(503, 'webframe service not configured');
    const res = await fetch(`${svc}/html?session=${encodeURIComponent(body.session)}`);
    if (!res.ok) throw error(res.status, await res.text());
    html = await res.text();
  }
  if (!html) throw error(400, 'html or session required');
  return json(extractArticle(html, body.url));
};
```

- [ ] **Step 4: Run tests + type-check + commit**

```bash
npm test -- tests/routes/api/webframe/extract.test.ts
npm run check
git add src/lib/webframe/extract.ts src/routes/api/webframe/extract tests/routes/api/webframe/extract.test.ts
git commit -m "feat(webframe): add /api/webframe/extract with Readability"
```

---

### Task E2: Wire extraction + outputs into WebpageNode

**Files:**
- Modify: `src/lib/canvas/nodes/WebpageNode.svelte`

- [ ] **Step 1: On load success, fetch extracted text and emit output**

```ts
async function afterLoad() {
  try {
    const body: any = { url: config.url };
    if (config.mode === 'proxied') body.session = nodeId;
    else {
      // direct: read iframe.contentDocument HTML (same-origin only)
      try { body.html = iframeEl?.contentDocument?.documentElement?.outerHTML ?? ''; } catch { body.html = ''; }
    }
    const res = await fetch('/api/webframe/extract', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) {
      const { text } = await res.json();
      if (text) onOutput?.('extractedText', text);
    }
  } catch {}
}
```

Call `afterLoad()` when the pong arrives (direct) or from the render endpoint success path (proxied — fire on iframe `load`).

- [ ] **Step 2: Wire upstream URL auto-load**

In `+page.svelte`, when an edge is created into a webpage node from an upstream node whose output kinds include `url` or `research-result`, or when such an upstream node's config changes, patch the webpage node's `config.url` and trigger `load()`. If multiple upstream sources exist, last-change-wins.

For `text`-kind upstream connections, do NOT auto-navigate — pre-populate `urlDraft` with the first URL-looking substring:

```ts
const m = upstreamText.match(/\bhttps?:\/\/\S+/i);
if (m) urlDraft = m[0];
```

- [ ] **Step 3: Dev smoke + commit**

Run `npm run dev`, create a webpage node, connect a chat node that says "check https://example.com" via `text → src`, confirm URL bar pre-populates but iframe doesn't load until user presses Go. Create a research-result → webpage edge and confirm auto-load.

```bash
git add src/lib/canvas/nodes/WebpageNode.svelte src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): extract + emit outputs; auto-load from upstream url/research-result"
```

---

### Task E3: OpenAsWebpageButton + research-result integration

**Files:**
- Create: `src/lib/canvas/OpenAsWebpageButton.svelte`
- Modify: `src/lib/canvas/intelligence/ResearchResultNode.svelte`

- [ ] **Step 1: Build `OpenAsWebpageButton.svelte`**

```svelte
<script lang="ts">
  type Props = { url: string; sourceNodeId: string; onCreate: (e: { url: string; fromNodeId: string }) => void };
  let { url, sourceNodeId, onCreate }: Props = $props();
  const valid = (() => { try { new URL(url); return true; } catch { return false; } })();
</script>

{#if valid}
  <button class="open-as" title="Open as webpage node" onclick={() => onCreate({ url, fromNodeId: sourceNodeId })}>
    🌐
  </button>
{/if}

<style>
  .open-as { background: transparent; border: none; cursor: pointer; color: var(--fg-2); padding: 0 4px; }
  .open-as:hover { color: var(--accent); }
</style>
```

- [ ] **Step 2: Wire it into `ResearchResultNode.svelte`**

Beside each citation's existing "open in tab" action, render `<OpenAsWebpageButton url={citation.url} sourceNodeId={node.id} onCreate={...} />`. The `onCreate` handler must call the same `addNode` + `addEdge` primitives the palette uses on `+page.svelte` — plumb it via a prop or a context.

- [ ] **Step 3: Implement the `onCreate` handler in `+page.svelte`**

```ts
async function openAsWebpageNode(url: string, fromNodeId: string) {
  const src = nodes.find((n) => n.id === fromNodeId)!;
  const pos = resolveOverlap({ x: src.x + 40, y: src.y });
  const meta = adapter.byType('webpage')!;
  const newNode = await addNode('webpage', 'Webpage', { ...meta.defaults.config, url }, pos);
  const srcMeta = adapter.byType(src.type)!;
  await addEdge({
    sourceNodeId: fromNodeId,
    targetNodeId: newNode.id,
    sourceHandle: srcMeta.handles.outputs[0]?.id ?? null,
    targetHandle: meta.handles.inputs[0]?.id ?? null,
  });
}
```

- [ ] **Step 4: Dev smoke + commit**

Run `npm run dev`. On a research-result node with citations, click 🌐 on a citation — a pre-connected webpage node appears and loads the URL.

```bash
git add src/lib/canvas/OpenAsWebpageButton.svelte src/lib/canvas/intelligence/ResearchResultNode.svelte src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): add OpenAsWebpageButton + research-result citation integration"
```

---

## Phase F — Rollout flag + smoke

### Task F1: Feature flag `canvas.newPalette`

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte`
- Modify: `.env.example`

- [ ] **Step 1: Expose the flag**

`.env.example`:

```
PUBLIC_CANVAS_NEW_PALETTE=true
```

- [ ] **Step 2: Wrap the new triggers + hide the old dropdown path behind it**

```ts
import { env as pubEnv } from '$env/dynamic/public';
const NEW_PALETTE = pubEnv.PUBLIC_CANVAS_NEW_PALETTE !== 'false';
```

In `+page.svelte`, wrap each new trigger (keyboard, right-click, long-press, drag-from-handle-into-empty) with `if (NEW_PALETTE)`. If `NEW_PALETTE === false`, restore a simple fallback `+ node` button that opens the palette in workflow-ranked mode. (The old two-level dropdown is gone — flag-off still uses the palette, just via a single button.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte .env.example
git commit -m "feat(canvas): add PUBLIC_CANVAS_NEW_PALETTE feature flag"
```

---

### Task F2: Final smoke matrix

**Files:** none

- [ ] **Step 1: Start services**

```bash
docker compose -f docker-compose.webframe.yml up -d
npm run dev
```

- [ ] **Step 2: Walk the matrix, confirm each works**

| Step | Expected |
|---|---|
| Press ⌘K anywhere on canvas | Palette opens centred, workflow-ranked |
| Press `/` anywhere (not in input) | Palette opens centred, workflow-ranked |
| Right-click empty canvas | Palette anchored at cursor |
| Long-press empty canvas (touch simulator) | Palette anchored at touch |
| Drag from node output → release on empty canvas | Palette anchored, strict-downstream |
| Drag from node output → release on compatible input handle | Typed edge created |
| Drag from node output → release on incompatible input handle | Red flash + tooltip; Connect-anyway menu works |
| Add `webpage` node, type `https://example.com` | Loads direct, badge absent |
| Add `webpage` node, type `https://github.com` | Auto-escalates, "proxied" badge shows, page interactive |
| On research-result citation, click 🌐 | Pre-connected webpage node opens and loads citation URL |

- [ ] **Step 3: File any regressions as follow-up tasks (outside this plan)**

- [ ] **Step 4: Commit any smoke-test fixes as individual `fix(canvas): …` commits.**

---

## Self-Review Checklist

- [x] **Spec §1** (goals / shape) — covered by the overall task breakdown
- [x] **Spec §2** (interaction model, four triggers, placement) — Tasks B1, B2
- [x] **Spec §3** (handle types, compatibility, scoring, migration) — Tasks A1, A3, B3
- [x] **Spec §4** (webpage node body, pipeline, outputs, persistence) — Tasks C2, D4, E2
- [x] **Spec §5** (research-result integration, `<OpenAsWebpageButton>`) — Task E3
- [x] **Spec §6** (DB unchanged; /api/webframe endpoints; Playwright sidecar) — Tasks C1, D1, D2, D3, E1
- [x] **Spec §7** (error handling, edge cases) — Tasks B3 (incompatible drop), D1 (probe timeout), D2 (queue-full), D4 (escalation), E3 (URL.canParse validation)
- [x] **Spec §8** (testing) — Vitest unit/integration tests on `handles`, `recents`, `probe-parse`, `extract`; manual dev-server smoke per task covers the rest. No Playwright e2e harness added (YAGNI for v1; the project doesn't have one yet).
- [x] **Spec §9** (open questions) — not implemented, correctly deferred

**Known deviations from spec**: `/api/webframe/event` uses simple POST rather than an SSE channel (spec §6.2 mentions SSE). SSE is only useful if we need server-push events back to the client; all input forwarding is client-push → server, so plain POST is sufficient. Flagged here so the reviewer can push back if server-push becomes needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-jkai-canvas-node-palette-webpage-node.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
