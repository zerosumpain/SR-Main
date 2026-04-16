# JKAI Multimedia Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give JKAI a lightweight tool path that answers chat messages with inline charts, maps, and tables — without going through the autonomous builder.

**Architecture:** Three layers. Layer 1: three primitive render tools (`render_chart`, `render_map`, `render_table`) that accept specs and return `Artifact` payloads. Layer 2: `author_ephemeral_tool` compiles and runs LLM-authored handler code once per turn. Layer 3: `promote_ephemeral_tool` persists a successful ephemeral into the existing `customTools` table via the existing `custom-tool-loader` plumbing. Artifacts ride on `orchestratorChats.metadata.toolSteps[].result.data.artifact` (existing shape extended) and render inline via new Svelte components in `$lib/components/jkai/artifacts/`.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Drizzle ORM (PostgreSQL), Vitest, Vega-Lite via `vega-embed`, Leaflet (CDN-loaded in static vendor dir, matching `/live`).

**Spec:** `docs/superpowers/specs/2026-04-16-jkai-multimedia-tools-design.md`

---

## Task 1: Add vitest npm script + vega-embed dependency

**Files:**
- Modify: `package.json`
- Verify: `vite.config.ts` (already has vitest config pointing at `tests/**/*.test.ts`)

- [ ] **Step 1: Add `test` script to `package.json`**

Open `package.json` and add inside the `scripts` object, right after `"check:watch"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 2: Add `vega-embed` to dependencies**

```bash
cd ~/strange_rambling_svelte
npm install vega-embed
```

Expected: installs `vega-embed`, `vega`, `vega-lite` as transitive deps; `package.json` and `package-lock.json` updated.

- [ ] **Step 3: Verify install**

```bash
cd ~/strange_rambling_svelte
npm run test -- --reporter=verbose 2>&1 | head -5
```

Expected: vitest runs (exits 0 with "No test files found" or runs existing tests), not a script error.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add package.json package-lock.json
git commit -m "chore: add vitest npm script and vega-embed dep for multimedia tools"
```

---

## Task 2: Define `Artifact` types

**Files:**
- Create: `src/lib/workflows/site-tools/artifact-types.ts`
- Test: `tests/lib/workflows/site-tools/artifact-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/artifact-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isArtifact, type Artifact } from '$lib/workflows/site-tools/artifact-types';

describe('isArtifact', () => {
  it('accepts a chart artifact', () => {
    const a: Artifact = {
      type: 'chart',
      spec: { mark: 'line', encoding: {} },
      data: [{ x: 1, y: 2 }],
    };
    expect(isArtifact(a)).toBe(true);
  });

  it('accepts a map artifact with a single points layer', () => {
    const a: Artifact = {
      type: 'map',
      layers: [{ kind: 'points', points: [{ lat: 51.5, lng: -0.1 }] }],
    };
    expect(isArtifact(a)).toBe(true);
  });

  it('accepts a table artifact', () => {
    const a: Artifact = {
      type: 'table',
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ name: 'alice' }],
    };
    expect(isArtifact(a)).toBe(true);
  });

  it('rejects a plain object', () => {
    expect(isArtifact({})).toBe(false);
    expect(isArtifact({ type: 'nope' })).toBe(false);
    expect(isArtifact(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/artifact-types.test.ts
```

Expected: FAIL — module `$lib/workflows/site-tools/artifact-types` does not exist.

- [ ] **Step 3: Implement `artifact-types.ts`**

Create `src/lib/workflows/site-tools/artifact-types.ts`:

```ts
// Artifact shape for multimedia tool responses.
// Rendered inline in the JKAI chat via components in
// src/lib/components/jkai/artifacts/.

export type ChartArtifact = {
  type: 'chart';
  /** Vega-Lite spec. Data may be embedded here or passed separately. */
  spec: Record<string, unknown>;
  /** Inline data rows. Handler merges into spec.data.values at render time. */
  data: unknown[];
  caption?: string;
};

export type MapPointsLayer = {
  kind: 'points';
  points: Array<{ lat: number; lng: number; label?: string }>;
};

export type MapTrackLayer = {
  kind: 'track';
  points: Array<{ lat: number; lng: number }>;
};

export type MapHeatmapLayer = {
  kind: 'heatmap';
  points: Array<{ lat: number; lng: number; weight?: number }>;
};

export type MapLayer = MapPointsLayer | MapTrackLayer | MapHeatmapLayer;

export type MapArtifact = {
  type: 'map';
  center?: [number, number];
  zoom?: number;
  layers: MapLayer[];
  caption?: string;
};

export type TableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
};

export type TableArtifact = {
  type: 'table';
  columns: TableColumn[];
  rows: Array<Record<string, unknown>>;
  caption?: string;
};

export type Artifact = ChartArtifact | MapArtifact | TableArtifact;

/** Envelope returned by any tool that produced an artifact. */
export type ArtifactToolData = {
  artifact: Artifact;
  /** Short human-readable summary shown to the LLM in lieu of the full spec. */
  summary: string;
};

export function isArtifact(v: unknown): v is Artifact {
  if (!v || typeof v !== 'object') return false;
  const t = (v as { type?: unknown }).type;
  return t === 'chart' || t === 'map' || t === 'table';
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/artifact-types.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/artifact-types.ts tests/lib/workflows/site-tools/artifact-types.test.ts
git commit -m "feat(jkai): add Artifact type definitions for multimedia tool responses"
```

---

## Task 3: `render_table` primitive

**Files:**
- Create: `src/lib/workflows/site-tools/tools/visualise.ts`
- Test: `tests/lib/workflows/site-tools/visualise-render-table.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/visualise-render-table.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  // Registry self-registers on import. Force-load visualise module.
  await import('$lib/workflows/site-tools/tools/visualise');
});

describe('render_table', () => {
  it('is registered in the visualise toolset', () => {
    const t = getTool('render_table');
    expect(t).toBeDefined();
    expect(t!.toolset).toBe('visualise');
  });

  it('returns a table artifact with a summary', async () => {
    const res = await executeTool('render_table', {
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'age',  label: 'Age', align: 'right' },
      ],
      rows: [
        { name: 'Alice', age: 30 },
        { name: 'Bob',   age: 25 },
      ],
      caption: 'People',
    });
    expect(res.success).toBe(true);
    const data = res.data as { artifact: { type: string; columns: unknown[]; rows: unknown[] }; summary: string };
    expect(data.artifact.type).toBe('table');
    expect(data.artifact.columns).toHaveLength(2);
    expect(data.artifact.rows).toHaveLength(2);
    expect(data.summary).toMatch(/2 rows/);
    expect(data.summary).toMatch(/name/i);
  });

  it('rejects rows that aren\'t objects', async () => {
    const res = await executeTool('render_table', {
      columns: [{ key: 'x', label: 'X' }],
      rows: [1, 2, 3] as unknown[],
    });
    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-render-table.test.ts
```

Expected: FAIL — module `tools/visualise` not found.

- [ ] **Step 3: Implement visualise.ts with `render_table`**

Create `src/lib/workflows/site-tools/tools/visualise.ts`:

```ts
// src/lib/workflows/site-tools/tools/visualise.ts
// Primitive renderer tools. Each returns an ArtifactToolData envelope so
// ChatArea can render the output inline. Kept dependency-free on the server;
// client components pull in vega-embed / leaflet at render time.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import type { Artifact, ArtifactToolData, TableColumn } from '../artifact-types';

function ok(artifact: Artifact, summary: string): ToolResult {
  const data: ArtifactToolData = { artifact, summary };
  return { success: true, data };
}

function fail(error: string): ToolResult {
  return { success: false, error };
}

// -------- render_table --------

register({
  name: 'render_table',
  description:
    'Render a structured table inline in the chat. Use for tabular data (lists of metrics, comparisons, rankings). Prefer this over a markdown table when data has >3 rows.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      columns: {
        type: 'array',
        description: 'Column definitions.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Row property key.' },
            label: { type: 'string', description: 'Human-readable header.' },
            align: { type: 'string', enum: ['left', 'right', 'center'] },
          },
          required: ['key', 'label'],
        },
      },
      rows: {
        type: 'array',
        description: 'Rows as objects keyed by column `key`.',
        items: { type: 'object' },
      },
      caption: { type: 'string', description: 'Optional caption shown above the table.' },
    },
    required: ['columns', 'rows'],
  },
  handler: async (args): Promise<ToolResult> => {
    const columns = args.columns as TableColumn[] | undefined;
    const rows = args.rows as unknown[] | undefined;
    const caption = args.caption as string | undefined;
    if (!Array.isArray(columns) || columns.length === 0) {
      return fail('columns must be a non-empty array');
    }
    if (!Array.isArray(rows)) {
      return fail('rows must be an array');
    }
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i] || typeof rows[i] !== 'object' || Array.isArray(rows[i])) {
        return fail(`rows[${i}] must be an object`);
      }
    }
    const artifact: Artifact = {
      type: 'table',
      columns,
      rows: rows as Array<Record<string, unknown>>,
      caption,
    };
    const colNames = columns.map((c) => c.key).join(', ');
    const summary = `Table: ${rows.length} rows × ${columns.length} columns (${colNames})`;
    return ok(artifact, summary);
  },
});
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-render-table.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/visualise.ts tests/lib/workflows/site-tools/visualise-render-table.test.ts
git commit -m "feat(jkai): add render_table primitive for inline table artifacts"
```

---

## Task 4: `render_chart` primitive

**Files:**
- Modify: `src/lib/workflows/site-tools/tools/visualise.ts`
- Test: `tests/lib/workflows/site-tools/visualise-render-chart.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/visualise-render-chart.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
});

describe('render_chart', () => {
  it('is registered in the visualise toolset', () => {
    const t = getTool('render_chart');
    expect(t).toBeDefined();
    expect(t!.toolset).toBe('visualise');
  });

  it('returns a chart artifact with a summary derived from the spec', async () => {
    const res = await executeTool('render_chart', {
      spec: {
        mark: 'line',
        encoding: {
          x: { field: 'date', type: 'temporal' },
          y: { field: 'hours', type: 'quantitative', title: 'Sleep (hrs)' },
        },
      },
      data: [
        { date: '2026-04-10', hours: 7.2 },
        { date: '2026-04-11', hours: 6.4 },
        { date: '2026-04-12', hours: 8.1 },
      ],
      caption: 'Sleep last 3 nights',
    });
    expect(res.success).toBe(true);
    const data = res.data as { artifact: { type: string; spec: Record<string, unknown>; data: unknown[] }; summary: string };
    expect(data.artifact.type).toBe('chart');
    expect(data.artifact.data).toHaveLength(3);
    expect(data.summary).toMatch(/line/i);
    expect(data.summary).toMatch(/3 (points|data)/i);
    expect(data.summary).toMatch(/6\.4|8\.1/); // min or max surfaced
  });

  it('rejects a non-object spec', async () => {
    const res = await executeTool('render_chart', { spec: 'not a spec', data: [] });
    expect(res.success).toBe(false);
  });

  it('allows data to be embedded in spec.data.values instead of a separate `data` arg', async () => {
    const res = await executeTool('render_chart', {
      spec: {
        mark: 'bar',
        data: { values: [{ a: 1 }, { a: 2 }] },
        encoding: { y: { field: 'a', type: 'quantitative' } },
      },
      data: [],
    });
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-render-chart.test.ts
```

Expected: FAIL — `render_chart` not registered.

- [ ] **Step 3: Add `render_chart` to visualise.ts**

Append to `src/lib/workflows/site-tools/tools/visualise.ts` (after the `render_table` block):

```ts
// -------- render_chart --------

function summariseChart(spec: Record<string, unknown>, data: unknown[]): string {
  const mark =
    typeof spec.mark === 'string'
      ? spec.mark
      : typeof (spec.mark as { type?: unknown } | undefined)?.type === 'string'
        ? (spec.mark as { type: string }).type
        : 'chart';

  const enc = (spec.encoding ?? {}) as Record<string, { field?: string; title?: string; type?: string }>;
  const yInfo = enc.y;
  const yField = yInfo?.field;
  const yTitle = yInfo?.title ?? yField;

  const effective = data.length > 0
    ? data
    : Array.isArray((spec.data as { values?: unknown[] } | undefined)?.values)
      ? ((spec.data as { values: unknown[] }).values)
      : [];

  let rangePart = '';
  if (yField && effective.length > 0) {
    const nums: number[] = [];
    for (const row of effective) {
      if (row && typeof row === 'object') {
        const v = (row as Record<string, unknown>)[yField];
        if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
      }
    }
    if (nums.length > 0) {
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      rangePart = ` (${yTitle ?? 'y'}: ${min}–${max})`;
    }
  }

  return `${mark} chart: ${effective.length} data points${rangePart}`;
}

register({
  name: 'render_chart',
  description:
    'Render a chart inline in the chat using a Vega-Lite spec. Prefer this over describing data in prose when the user asks to visualise, plot, or chart. Supply the data either as the `data` argument or inside `spec.data.values`.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        description: 'Vega-Lite spec. Omit the outer $schema; it is added client-side.',
      },
      data: {
        type: 'array',
        description: 'Inline data rows. Merged into spec.data.values at render time if present.',
      },
      caption: { type: 'string', description: 'Optional caption shown below the chart.' },
    },
    required: ['spec'],
  },
  handler: async (args): Promise<ToolResult> => {
    const spec = args.spec as Record<string, unknown> | undefined;
    const data = (args.data as unknown[] | undefined) ?? [];
    const caption = args.caption as string | undefined;

    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return fail('spec must be a Vega-Lite spec object');
    }
    if (!Array.isArray(data)) {
      return fail('data must be an array if provided');
    }

    const artifact: Artifact = {
      type: 'chart',
      spec,
      data,
      caption,
    };
    const summary = summariseChart(spec, data);
    return ok(artifact, summary);
  },
});
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-render-chart.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/visualise.ts tests/lib/workflows/site-tools/visualise-render-chart.test.ts
git commit -m "feat(jkai): add render_chart primitive with spec+data summary"
```

---

## Task 5: `render_map` primitive

**Files:**
- Modify: `src/lib/workflows/site-tools/tools/visualise.ts`
- Test: `tests/lib/workflows/site-tools/visualise-render-map.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/visualise-render-map.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
});

describe('render_map', () => {
  it('is registered in the visualise toolset', () => {
    const t = getTool('render_map');
    expect(t).toBeDefined();
    expect(t!.toolset).toBe('visualise');
  });

  it('returns a map artifact with a summary describing layers', async () => {
    const res = await executeTool('render_map', {
      layers: [
        { kind: 'track', points: [{ lat: 51.5, lng: -0.1 }, { lat: 51.6, lng: -0.2 }] },
        { kind: 'points', points: [{ lat: 51.55, lng: -0.15, label: 'start' }] },
      ],
      caption: 'Today\'s run',
    });
    expect(res.success).toBe(true);
    const data = res.data as { artifact: { type: string; layers: unknown[] }; summary: string };
    expect(data.artifact.type).toBe('map');
    expect(data.artifact.layers).toHaveLength(2);
    expect(data.summary).toMatch(/1 track/);
    expect(data.summary).toMatch(/1 points layer|1 point/);
  });

  it('rejects empty layers', async () => {
    const res = await executeTool('render_map', { layers: [] });
    expect(res.success).toBe(false);
  });

  it('rejects a layer with no points', async () => {
    const res = await executeTool('render_map', {
      layers: [{ kind: 'points', points: [] }],
    });
    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-render-map.test.ts
```

Expected: FAIL — `render_map` not registered.

- [ ] **Step 3: Add `render_map` to visualise.ts**

Append to `src/lib/workflows/site-tools/tools/visualise.ts`:

```ts
// -------- render_map --------

type MapLayerArg = {
  kind: 'points' | 'track' | 'heatmap';
  points: Array<{ lat: number; lng: number; label?: string; weight?: number }>;
};

function summariseMap(layers: MapLayerArg[]): string {
  const counts = { points: 0, track: 0, heatmap: 0 };
  let total = 0;
  for (const l of layers) {
    counts[l.kind]++;
    total += l.points.length;
  }
  const parts: string[] = [];
  if (counts.track) parts.push(`${counts.track} track${counts.track > 1 ? 's' : ''}`);
  if (counts.points) parts.push(`${counts.points} points layer${counts.points > 1 ? 's' : ''}`);
  if (counts.heatmap) parts.push(`${counts.heatmap} heatmap layer${counts.heatmap > 1 ? 's' : ''}`);
  return `Map: ${parts.join(', ')} — ${total} point${total === 1 ? '' : 's'} total`;
}

register({
  name: 'render_map',
  description:
    'Render an interactive map inline in the chat. Use for GPS data: locations, routes, heatmaps. Center/zoom auto-fit from point bounds if omitted.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      layers: {
        type: 'array',
        description: 'One or more layers. Each layer has a kind and a points array.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['points', 'track', 'heatmap'] },
            points: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  label: { type: 'string' },
                  weight: { type: 'number', description: 'Only used for heatmap layers.' },
                },
                required: ['lat', 'lng'],
              },
            },
          },
          required: ['kind', 'points'],
        },
      },
      center: {
        type: 'array',
        description: 'Optional [lat, lng] center. Auto-fit bounds if omitted.',
        items: { type: 'number' },
      },
      zoom: { type: 'number', description: 'Optional zoom level (1–18).' },
      caption: { type: 'string' },
    },
    required: ['layers'],
  },
  handler: async (args): Promise<ToolResult> => {
    const layers = args.layers as MapLayerArg[] | undefined;
    const center = args.center as [number, number] | undefined;
    const zoom = args.zoom as number | undefined;
    const caption = args.caption as string | undefined;

    if (!Array.isArray(layers) || layers.length === 0) {
      return fail('layers must be a non-empty array');
    }
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l || typeof l !== 'object') return fail(`layers[${i}] must be an object`);
      if (!['points', 'track', 'heatmap'].includes(l.kind)) {
        return fail(`layers[${i}].kind must be 'points' | 'track' | 'heatmap'`);
      }
      if (!Array.isArray(l.points) || l.points.length === 0) {
        return fail(`layers[${i}].points must be a non-empty array`);
      }
      for (let j = 0; j < l.points.length; j++) {
        const p = l.points[j];
        if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') {
          return fail(`layers[${i}].points[${j}] must have numeric lat and lng`);
        }
      }
    }

    const artifact: Artifact = {
      type: 'map',
      center,
      zoom,
      layers: layers as Artifact extends { type: 'map'; layers: infer L } ? L : never,
      caption,
    };
    const summary = summariseMap(layers);
    return ok(artifact, summary);
  },
});
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-render-map.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/visualise.ts tests/lib/workflows/site-tools/visualise-render-map.test.ts
git commit -m "feat(jkai): add render_map primitive with track/points/heatmap layers"
```

---

## Task 6: Wire `visualise` toolset into registry + make it always active

**Files:**
- Modify: `src/lib/workflows/site-tools/registry.ts`
- Modify: `src/lib/workflows/chat/general-chat.ts`
- Test: `tests/lib/workflows/site-tools/visualise-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/visualise-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getToolsetManifest } from '$lib/workflows/site-tools/registry';

describe('visualise toolset', () => {
  it('appears in the manifest with a description and 3 tools', () => {
    const m = getToolsetManifest();
    const v = m.find((t) => t.toolset === 'visualise');
    expect(v).toBeDefined();
    expect(v!.description).toMatch(/chart|map|table/i);
    const names = v!.tools.map((t) => t.name).sort();
    expect(names).toEqual(['render_chart', 'render_map', 'render_table']);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-registry.test.ts
```

Expected: FAIL — `visualise` missing from manifest (tools file not imported by registry).

- [ ] **Step 3: Import `visualise` from `registry.ts` and add its description**

Edit `src/lib/workflows/site-tools/registry.ts`.

Add an import alongside the existing `./tools/*` imports (after `./tools/home-assistant`):

```ts
import './tools/visualise';
```

In the `toolsetDescriptions` object, add:

```ts
    visualise: 'Inline visual responses — render charts (Vega-Lite), maps (Leaflet), and tables directly in the chat',
```

- [ ] **Step 4: Make `visualise` always-on in general-chat**

Open `src/lib/workflows/chat/general-chat.ts` and find the block around line 111–115 that populates `activeTools` from inferred toolsets. Just before or after that block, ensure the visualise toolset is always loaded. Example — find:

```ts
  // Keyword pre-classification: auto-activate likely toolsets
```

Right after the loop that pushes tools by toolset, add a forced include for visualise. Look for a line like:

```ts
    activeTools.push(...getToolsetDefinitions(ts));
```

After the enclosing loop ends, add:

```ts
  // Visualise tools are always available — the LLM should be able to reach
  // for render_chart/render_map/render_table whenever it wants to answer
  // with a multimedia response.
  if (!activatedToolsets.has('visualise')) {
    activeTools.push(...getToolsetDefinitions('visualise'));
    activatedToolsets.add('visualise');
  }
```

If `activatedToolsets` has a different name in this file, use whatever `Set<string>` already tracks loaded toolsets. If none exists, just append the definitions unconditionally:

```ts
  activeTools.push(...getToolsetDefinitions('visualise'));
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/visualise-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full test suite — verify nothing regressed**

```bash
cd ~/strange_rambling_svelte
npm run test
```

Expected: all previous tests still pass.

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/registry.ts src/lib/workflows/chat/general-chat.ts tests/lib/workflows/site-tools/visualise-registry.test.ts
git commit -m "feat(jkai): register visualise toolset and make it always-on in general chat"
```

---

## Task 7: `author_ephemeral_tool` meta-tool

**Files:**
- Create: `src/lib/workflows/site-tools/tools/ephemeral-tools.ts`
- Modify: `src/lib/workflows/site-tools/registry.ts` (import ephemeral-tools)
- Test: `tests/lib/workflows/site-tools/author-ephemeral-tool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/author-ephemeral-tool.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { getTool, executeTool } from '$lib/workflows/site-tools/registry';

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
  await import('$lib/workflows/site-tools/tools/ephemeral-tools');
});

describe('author_ephemeral_tool', () => {
  it('is registered', () => {
    expect(getTool('author_ephemeral_tool')).toBeDefined();
  });

  it('runs a handler that composes a primitive via platform.call', async () => {
    const res = await executeTool('author_ephemeral_tool', {
      name: 'rand_points_map',
      description: 'Renders a map of a few random London points',
      parameters: { type: 'object', properties: {} },
      handlerCode: `
        const points = [
          { lat: 51.5, lng: -0.1 },
          { lat: 51.51, lng: -0.12 },
        ];
        return await platform.call('render_map', {
          layers: [{ kind: 'points', points }],
        });
      `,
      callArgs: {},
    });
    expect(res.success).toBe(true);
    const data = res.data as {
      artifact?: { type?: string };
      summary?: string;
      __ephemeral__?: { handlerCode: string; proposedName: string };
    };
    expect(data.artifact?.type).toBe('map');
    expect(data.__ephemeral__?.proposedName).toBe('rand_points_map');
    expect(data.__ephemeral__?.handlerCode).toMatch(/render_map/);
  });

  it('fails cleanly on a handlerCode syntax error', async () => {
    const res = await executeTool('author_ephemeral_tool', {
      name: 'broken',
      description: 'broken',
      parameters: { type: 'object', properties: {} },
      handlerCode: 'this is not valid JS ;;;;;',
      callArgs: {},
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/syntax|parse|unexpected/i);
  });

  it('does NOT register the ephemeral tool in the main registry', async () => {
    await executeTool('author_ephemeral_tool', {
      name: 'should_not_persist',
      description: 'x',
      parameters: { type: 'object', properties: {} },
      handlerCode: `return { success: true, data: { artifact: { type: 'table', columns: [{key:'x',label:'X'}], rows: [{x:1}] }, summary: 'one' } };`,
      callArgs: {},
    });
    expect(getTool('should_not_persist')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/author-ephemeral-tool.test.ts
```

Expected: FAIL — `author_ephemeral_tool` not registered.

- [ ] **Step 3: Implement ephemeral-tools.ts**

Create `src/lib/workflows/site-tools/tools/ephemeral-tools.ts`:

```ts
// src/lib/workflows/site-tools/tools/ephemeral-tools.ts
// Meta-tools that let the LLM author one-shot tools and, later, promote
// them into the persistent customTools registry.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';

type JSONSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

type PlatformCall = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
type Handler = (
  args: Record<string, unknown>,
  fetch: typeof globalThis.fetch,
  platform: { call: PlatformCall },
) => Promise<ToolResult>;

const MAX_EPHEMERAL_DEPTH = 5;
let currentDepth = 0;

function compileHandler(code: string): Handler {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction('args', 'fetch', 'platform', code) as Handler;
}

async function buildEphemeralPlatform(callerName: string): Promise<{ call: PlatformCall }> {
  return {
    async call(name, args) {
      if (currentDepth >= MAX_EPHEMERAL_DEPTH) {
        return {
          success: false,
          error: `ephemeral platform.call depth limit (${MAX_EPHEMERAL_DEPTH}) exceeded while calling "${name}" from "${callerName}".`,
        };
      }
      const { executeTool } = await import('../registry');
      currentDepth++;
      try {
        return await executeTool(name, args);
      } finally {
        currentDepth--;
      }
    },
  };
}

// -------- author_ephemeral_tool --------

register({
  name: 'author_ephemeral_tool',
  description:
    'Author and run a one-shot tool for this turn only. Use when no existing tool fits and the task needs data fetching / transformation before rendering. Handler receives (args, fetch, platform) where platform.call invokes any registered tool (e.g. render_chart). Return an ArtifactToolData envelope `{ artifact, summary }` for multimedia responses.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Proposed tool name, snake_case. Only persisted if promoted.' },
      description: { type: 'string', description: 'What the tool does (visible to future tool selection if promoted).' },
      parameters: {
        type: 'object',
        description: 'JSON Schema describing the tool\'s parameters.',
      },
      handlerCode: {
        type: 'string',
        description: 'Async JS body. Has access to args, fetch, platform. Return { success, data?, error? }.',
      },
      callArgs: {
        type: 'object',
        description: 'Arguments to pass to the handler for this invocation.',
      },
    },
    required: ['name', 'description', 'parameters', 'handlerCode', 'callArgs'],
  },
  handler: async (args): Promise<ToolResult> => {
    const name = args.name as string;
    const description = args.description as string;
    const parameters = args.parameters as JSONSchema;
    const handlerCode = args.handlerCode as string;
    const callArgs = (args.callArgs as Record<string, unknown>) ?? {};

    if (!name || typeof name !== 'string') return { success: false, error: 'name is required' };
    if (!handlerCode || typeof handlerCode !== 'string') {
      return { success: false, error: 'handlerCode is required' };
    }

    let compiled: Handler;
    try {
      compiled = compileHandler(handlerCode);
    } catch (err) {
      return { success: false, error: `handlerCode syntax error: ${err instanceof Error ? err.message : String(err)}` };
    }

    const platform = await buildEphemeralPlatform(name);

    let result: ToolResult;
    try {
      result = await compiled(callArgs, globalThis.fetch, platform);
    } catch (err) {
      return { success: false, error: `ephemeral handler threw: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
      return { success: false, error: 'ephemeral handler must return { success, data?, error? }' };
    }

    if (!result.success) return result;

    // Attach the ephemeral sidecar to data so the chat persistence layer
    // can extract it and store it on the message row for later promotion.
    const existingData = (result.data as Record<string, unknown> | undefined) ?? {};
    const enrichedData = {
      ...existingData,
      __ephemeral__: {
        handlerCode,
        parameters,
        proposedName: name,
        proposedDescription: description,
      },
    };
    return { success: true, data: enrichedData };
  },
});
```

- [ ] **Step 4: Import ephemeral-tools from registry.ts**

In `src/lib/workflows/site-tools/registry.ts`, after the existing tool imports (after `./tools/visualise`), add:

```ts
import './tools/ephemeral-tools';
```

- [ ] **Step 5: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/author-ephemeral-tool.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/ephemeral-tools.ts src/lib/workflows/site-tools/registry.ts tests/lib/workflows/site-tools/author-ephemeral-tool.test.ts
git commit -m "feat(jkai): add author_ephemeral_tool meta-tool for one-shot LLM-authored tools"
```

---

## Task 8: `promote_ephemeral_tool` meta-tool + live registration

**Files:**
- Modify: `src/lib/workflows/site-tools/tools/ephemeral-tools.ts`
- Test: `tests/lib/workflows/site-tools/promote-ephemeral-tool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/site-tools/promote-ephemeral-tool.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock the db before importing anything that reads it
vi.mock('$lib/db', () => {
  const state = { inserted: [] as unknown[], byId: new Map<string, Record<string, unknown>>() };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            return state.byId.size > 0 ? [...state.byId.values()] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
      },
    }),
  };
  return { db, __state: state };
});

// Provide a fake orchestratorChats row: message with an ephemeral sidecar
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, eq: () => ({}), and: () => ({}), sql: () => ({}) };
});

beforeAll(async () => {
  await import('$lib/workflows/site-tools/tools/visualise');
  await import('$lib/workflows/site-tools/tools/ephemeral-tools');
});

describe('promote_ephemeral_tool', () => {
  it('is registered', async () => {
    const { getTool } = await import('$lib/workflows/site-tools/registry');
    expect(getTool('promote_ephemeral_tool')).toBeDefined();
  });

  // Full DB-integration behaviour is covered by the API route test in Task 10.
  // Here we just verify the tool surface and that name-collision errors are
  // caught without blowing up.
  it('requires messageId + toolCallId', async () => {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('promote_ephemeral_tool', { messageId: '', toolCallId: '' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/messageId|toolCallId/i);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/promote-ephemeral-tool.test.ts
```

Expected: FAIL — `promote_ephemeral_tool` not registered.

- [ ] **Step 3: Implement `promote_ephemeral_tool` in ephemeral-tools.ts**

Append to `src/lib/workflows/site-tools/tools/ephemeral-tools.ts`:

```ts
// -------- promote_ephemeral_tool --------

import { db } from '$lib/db';
import { orchestratorChats, customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildHandler } from '../custom-tool-loader';

type EphemeralSidecar = {
  handlerCode: string;
  parameters: JSONSchema;
  proposedName?: string;
  proposedDescription?: string;
};

type StoredToolStep = {
  id?: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: { data?: Record<string, unknown> };
  ephemeral?: EphemeralSidecar;
};

register({
  name: 'promote_ephemeral_tool',
  description:
    'Persist a previously-run ephemeral tool into the reusable custom tools registry. Use only after an ephemeral tool has run successfully in this conversation.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'orchestrator_chats.id of the assistant message where the ephemeral ran.' },
      toolCallId: { type: 'string', description: 'The step id (or tool name if id absent) within that message\'s toolSteps.' },
      name: { type: 'string', description: 'Override name. Defaults to sidecar.proposedName.' },
      description: { type: 'string', description: 'Override description. Defaults to sidecar.proposedDescription.' },
      toolset: { type: 'string', description: 'Optional toolset. Defaults to "visualise".' },
    },
    required: ['messageId', 'toolCallId'],
  },
  handler: async (args): Promise<ToolResult> => {
    const messageId = args.messageId as string;
    const toolCallId = args.toolCallId as string;
    const nameOverride = args.name as string | undefined;
    const descOverride = args.description as string | undefined;
    const toolsetName = (args.toolset as string | undefined) ?? 'visualise';

    if (!messageId) return { success: false, error: 'messageId is required' };
    if (!toolCallId) return { success: false, error: 'toolCallId is required' };

    const rows = await db
      .select()
      .from(orchestratorChats)
      .where(eq(orchestratorChats.id, messageId))
      .limit(1);
    const msg = rows[0];
    if (!msg) return { success: false, error: `message ${messageId} not found` };

    const meta = (msg.metadata as { toolSteps?: StoredToolStep[] } | null) ?? {};
    const steps = meta.toolSteps ?? [];
    const step = steps.find((s) => s.id === toolCallId) ?? steps.find((s) => s.tool === toolCallId);
    if (!step) return { success: false, error: `tool step ${toolCallId} not found on message ${messageId}` };
    const sidecar = step.ephemeral;
    if (!sidecar) {
      return { success: false, error: `tool step ${toolCallId} has no ephemeral sidecar — not an ephemeral run` };
    }

    const finalName = nameOverride ?? sidecar.proposedName;
    const finalDesc = descOverride ?? sidecar.proposedDescription;
    if (!finalName) return { success: false, error: 'no name available (no override, no sidecar.proposedName)' };
    if (!finalDesc) return { success: false, error: 'no description available (no override, no sidecar.proposedDescription)' };

    // Name collision check
    const existing = await db
      .select()
      .from(customTools)
      .where(eq(customTools.name, finalName))
      .limit(1);
    if (existing.length > 0) {
      return {
        success: false,
        error: `a custom tool named "${finalName}" already exists — pass a different \`name\` override`,
      };
    }

    await db.insert(customTools).values({
      name: finalName,
      description: finalDesc,
      toolset: toolsetName,
      parameters: sidecar.parameters,
      handlerCode: sidecar.handlerCode,
      enabled: true,
    });

    // Register live so the LLM can use it immediately without a process restart
    register({
      name: finalName,
      description: finalDesc,
      toolset: toolsetName,
      category: 'Custom Tool',
      parameters: sidecar.parameters,
      handler: buildHandler(finalName, sidecar.handlerCode),
    });

    return {
      success: true,
      data: { name: finalName, description: finalDesc, toolset: toolsetName },
    };
  },
});
```

Note: the existing `custom-tool-loader.ts` already exports `buildHandler` (see line 133 in that file).

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/site-tools/promote-ephemeral-tool.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/tools/ephemeral-tools.ts tests/lib/workflows/site-tools/promote-ephemeral-tool.test.ts
git commit -m "feat(jkai): add promote_ephemeral_tool meta-tool with live registry insert"
```

---

## Task 9: Thread the `__ephemeral__` sidecar through chat persistence

**Files:**
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts`
- Test: `tests/lib/workflows/orchestrator/chat-ephemeral-sidecar.test.ts`

The goal: when the orchestrator finishes a turn and persists the assistant message's `toolSteps`, any step whose `result.data.__ephemeral__` is set must have that field lifted out into `step.ephemeral` on the stored metadata — so `promote_ephemeral_tool` can find it later.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/orchestrator/chat-ephemeral-sidecar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractEphemeralSidecar } from '$lib/workflows/chat/ephemeral-sidecar';

describe('extractEphemeralSidecar', () => {
  it('moves __ephemeral__ out of result.data into step.ephemeral', () => {
    const step = {
      id: 'step-1',
      tool: 'author_ephemeral_tool',
      args: {},
      status: 'done' as const,
      result: {
        success: true,
        data: {
          artifact: { type: 'chart' },
          summary: 'x',
          __ephemeral__: {
            handlerCode: 'return { success: true };',
            parameters: { type: 'object', properties: {} },
            proposedName: 'foo',
            proposedDescription: 'does foo',
          },
        },
      },
    };
    const out = extractEphemeralSidecar(step);
    expect(out.ephemeral).toEqual({
      handlerCode: 'return { success: true };',
      parameters: { type: 'object', properties: {} },
      proposedName: 'foo',
      proposedDescription: 'does foo',
    });
    const data = (out.result as { data: Record<string, unknown> }).data;
    expect('__ephemeral__' in data).toBe(false);
    expect(data.artifact).toBeDefined();
  });

  it('is a no-op for non-ephemeral steps', () => {
    const step = {
      id: 'step-2',
      tool: 'render_chart',
      args: {},
      status: 'done' as const,
      result: { success: true, data: { artifact: { type: 'chart' }, summary: 'x' } },
    };
    const out = extractEphemeralSidecar(step);
    expect(out.ephemeral).toBeUndefined();
    expect(out).toEqual(step);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/orchestrator/chat-ephemeral-sidecar.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the helper**

Create `src/lib/workflows/chat/ephemeral-sidecar.ts`:

```ts
// src/lib/workflows/chat/ephemeral-sidecar.ts
// Helper to lift an ephemeral tool's sidecar out of result.data into a
// dedicated `ephemeral` property on the stored tool step. Keeps the LLM's
// view of tool results free of implementation-detail fields when rehydrating
// history, and gives promote_ephemeral_tool a stable path to find the
// handler code later.

type EphemeralSidecar = {
  handlerCode: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  proposedName?: string;
  proposedDescription?: string;
};

export type StoredToolStep = {
  id?: string;
  tool: string;
  args?: Record<string, unknown>;
  status?: 'running' | 'done' | 'error';
  result?: { success?: boolean; data?: Record<string, unknown>; error?: string };
  ephemeral?: EphemeralSidecar;
};

export function extractEphemeralSidecar(step: StoredToolStep): StoredToolStep {
  const data = step.result?.data;
  if (!data || typeof data !== 'object') return step;
  const sidecar = data.__ephemeral__ as EphemeralSidecar | undefined;
  if (!sidecar) return step;

  const { __ephemeral__: _drop, ...cleanedData } = data;
  void _drop;
  return {
    ...step,
    result: { ...step.result, data: cleanedData },
    ephemeral: sidecar,
  };
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/workflows/orchestrator/chat-ephemeral-sidecar.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Wire the helper into chat persistence**

Edit `src/routes/api/workflows/orchestrator/chat/+server.ts`. At the top, add:

```ts
import { extractEphemeralSidecar } from '$lib/workflows/chat/ephemeral-sidecar';
```

Find the block (around line 165) that builds `assistantMetadata`:

```ts
        const assistantMetadata = job.toolSteps.length > 0 ? { toolSteps: job.toolSteps } : undefined;
```

Replace with:

```ts
        const cleanedToolSteps = job.toolSteps.map((s) => extractEphemeralSidecar(s));
        const assistantMetadata = cleanedToolSteps.length > 0 ? { toolSteps: cleanedToolSteps } : undefined;
```

- [ ] **Step 6: Run full test suite — verify no regression**

```bash
cd ~/strange_rambling_svelte
npm run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/chat/ephemeral-sidecar.ts src/routes/api/workflows/orchestrator/chat/+server.ts tests/lib/workflows/orchestrator/chat-ephemeral-sidecar.test.ts
git commit -m "feat(jkai): lift ephemeral sidecar onto stored tool step metadata"
```

---

## Task 10: `POST /api/jkai/tools/promote` endpoint

**Files:**
- Create: `src/routes/api/jkai/tools/promote/+server.ts`
- Test: `tests/lib/jkai/promote-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/promote-endpoint.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/workflows/site-tools/registry', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    executeTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name !== 'promote_ephemeral_tool') throw new Error(`unexpected tool: ${name}`);
      if (!args.messageId) return { success: false, error: 'messageId is required' };
      return { success: true, data: { name: 'render_sleep_chart', toolset: 'visualise' } };
    }),
  };
});

describe('POST /api/jkai/tools/promote', () => {
  it('returns 200 and the promoted tool info on success', async () => {
    const { POST } = await import('../../../src/routes/api/jkai/tools/promote/+server');
    const req = new Request('http://localhost/api/jkai/tools/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'm1', toolCallId: 'step-1' }),
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('render_sleep_chart');
  });

  it('returns 400 when messageId is missing', async () => {
    const { POST } = await import('../../../src/routes/api/jkai/tools/promote/+server');
    const req = new Request('http://localhost/api/jkai/tools/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolCallId: 'step-1' }),
    });
    const res = await POST({ request: req } as never);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/jkai/promote-endpoint.test.ts
```

Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement the endpoint**

Create `src/routes/api/jkai/tools/promote/+server.ts`:

```ts
// src/routes/api/jkai/tools/promote/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { executeTool } from '$lib/workflows/site-tools/registry';

type PromoteBody = {
  messageId?: string;
  toolCallId?: string;
  name?: string;
  description?: string;
  toolset?: string;
};

export const POST: RequestHandler = async ({ request }) => {
  let body: PromoteBody;
  try {
    body = (await request.json()) as PromoteBody;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.messageId) return json({ error: 'messageId is required' }, { status: 400 });
  if (!body.toolCallId) return json({ error: 'toolCallId is required' }, { status: 400 });

  const res = await executeTool('promote_ephemeral_tool', {
    messageId: body.messageId,
    toolCallId: body.toolCallId,
    name: body.name,
    description: body.description,
    toolset: body.toolset,
  });

  if (!res.success) return json({ error: res.error ?? 'promotion failed' }, { status: 400 });
  return json(res.data ?? {});
};
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/jkai/promote-endpoint.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/jkai/tools/promote/+server.ts tests/lib/jkai/promote-endpoint.test.ts
git commit -m "feat(jkai): add POST /api/jkai/tools/promote endpoint"
```

---

## Task 11: `GET /api/jkai/tools` endpoint (list persisted custom tools)

**Files:**
- Create: `src/routes/api/jkai/tools/+server.ts`
- Test: `tests/lib/jkai/list-tools-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/list-tools-endpoint.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          orderBy: async () => [
            { id: 'a', name: 'render_sleep_chart', description: 'sleep', toolset: 'visualise', enabled: true, runCount: 3, errorCount: 0, lastRunAt: null, createdAt: new Date('2026-04-16') },
          ],
        }),
      }),
    },
  };
});

describe('GET /api/jkai/tools', () => {
  it('returns the list of persisted custom tools', async () => {
    const { GET } = await import('../../../src/routes/api/jkai/tools/+server');
    const res = await GET({} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools[0].name).toBe('render_sleep_chart');
    expect(body.tools[0].handlerCode).toBeUndefined(); // don't leak code
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/jkai/list-tools-endpoint.test.ts
```

Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement the endpoint**

Create `src/routes/api/jkai/tools/+server.ts`:

```ts
// src/routes/api/jkai/tools/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(customTools).orderBy(desc(customTools.createdAt));
  // Strip handler code — this endpoint is for display, not for exposing
  // executable source to the browser.
  const tools = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    toolset: r.toolset,
    enabled: r.enabled,
    runCount: r.runCount,
    errorCount: r.errorCount,
    lastRunAt: r.lastRunAt,
    createdAt: r.createdAt,
  }));
  return json({ tools });
};
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/jkai/list-tools-endpoint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/jkai/tools/+server.ts tests/lib/jkai/list-tools-endpoint.test.ts
git commit -m "feat(jkai): add GET /api/jkai/tools endpoint (list persisted custom tools)"
```

---

## Task 12: `TableArtifact.svelte`

**Files:**
- Create: `src/lib/components/jkai/artifacts/TableArtifact.svelte`

- [ ] **Step 1: Scaffold the component**

Create `src/lib/components/jkai/artifacts/TableArtifact.svelte`:

```svelte
<script lang="ts">
  import type { TableArtifact } from '$lib/workflows/site-tools/artifact-types';

  let { artifact }: { artifact: TableArtifact } = $props();

  let sortKey = $state<string | null>(null);
  let sortDir = $state<'asc' | 'desc'>('asc');

  const sortedRows = $derived.by(() => {
    if (!sortKey) return artifact.rows;
    const key = sortKey;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...artifact.rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return -1 * dir;
      if (bv == null) return 1 * dir;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  });

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
  }

  function fmt(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  }
</script>

<figure class="table-artifact">
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
  <div class="scroll">
    <table>
      <thead>
        <tr>
          {#each artifact.columns as col (col.key)}
            <th
              class:align-right={col.align === 'right'}
              class:align-center={col.align === 'center'}
              onclick={() => toggleSort(col.key)}
            >
              {col.label}
              {#if sortKey === col.key}
                <span class="sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as row}
          <tr>
            {#each artifact.columns as col (col.key)}
              <td
                class:align-right={col.align === 'right'}
                class:align-center={col.align === 'center'}
              >
                {fmt(row[col.key])}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</figure>

<style>
  .table-artifact {
    margin: 0.5rem 0;
    border: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    border-radius: 6px;
    overflow: hidden;
    max-width: 100%;
  }
  figcaption {
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    background: rgb(var(--muted-rgb, 240 240 240) / 0.4);
    border-bottom: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
  }
  .scroll {
    max-height: 400px;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th {
    position: sticky;
    top: 0;
    background: rgb(var(--bg-rgb, 255 255 255));
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  td {
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.2);
  }
  tr:last-child td { border-bottom: none; }
  .align-right { text-align: right; }
  .align-center { text-align: center; }
  .sort-indicator { margin-left: 0.25rem; font-size: 0.7rem; }
</style>
```

- [ ] **Step 2: Smoke-check the component builds**

```bash
cd ~/strange_rambling_svelte
npm run check 2>&1 | grep -E 'TableArtifact|error' | head -20
```

Expected: no `TableArtifact`-related errors.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/jkai/artifacts/TableArtifact.svelte
git commit -m "feat(jkai): add TableArtifact svelte component"
```

---

## Task 13: `ChartArtifact.svelte` (dynamic vega-embed)

**Files:**
- Create: `src/lib/components/jkai/artifacts/ChartArtifact.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/components/jkai/artifacts/ChartArtifact.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChartArtifact } from '$lib/workflows/site-tools/artifact-types';

  let { artifact }: { artifact: ChartArtifact } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  function buildFullSpec() {
    const base: Record<string, unknown> = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      autosize: { type: 'fit', contains: 'padding' },
      ...artifact.spec,
    };
    // If caller passed data separately and spec doesn't already have data, merge.
    if (artifact.data && artifact.data.length > 0) {
      const specData = (base.data as { values?: unknown[] } | undefined);
      if (!specData || !specData.values || specData.values.length === 0) {
        base.data = { values: artifact.data };
      }
    }
    return base;
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: embed } = await import('vega-embed');
        if (cancelled || !container) return;
        await embed(container, buildFullSpec() as never, {
          actions: { export: true, source: false, compiled: false, editor: false },
          renderer: 'canvas',
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="chart-artifact">
  <div class="chart-container" bind:this={container}></div>
  {#if error}
    <p class="error">Chart failed to render: {error}</p>
  {/if}
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
</figure>

<style>
  .chart-artifact {
    margin: 0.5rem 0;
    padding: 0.5rem;
    border: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    border-radius: 6px;
    max-width: 100%;
    overflow: hidden;
  }
  .chart-container {
    width: 100%;
    min-height: 240px;
    max-height: 400px;
  }
  figcaption {
    font-size: 0.8rem;
    margin-top: 0.4rem;
    color: rgb(var(--muted-fg-rgb, 100 100 100));
    text-align: center;
  }
  .error {
    color: #b00;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
</style>
```

- [ ] **Step 2: Smoke-check**

```bash
cd ~/strange_rambling_svelte
npm run check 2>&1 | grep -E 'ChartArtifact|error' | head -20
```

Expected: no ChartArtifact-related errors.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/jkai/artifacts/ChartArtifact.svelte
git commit -m "feat(jkai): add ChartArtifact svelte component with vega-embed"
```

---

## Task 14: `MapArtifact.svelte` (Leaflet via static vendor)

**Files:**
- Create: `src/lib/components/jkai/artifacts/MapArtifact.svelte`

Leaflet is loaded from `/vendor/leaflet.min.js` + `/vendor/leaflet.min.css` (the same pattern used by `/live`). Both files already exist in `static/vendor/`.

- [ ] **Step 1: Verify leaflet vendor files exist**

```bash
cd ~/strange_rambling_svelte
ls static/vendor/leaflet.min.js static/vendor/leaflet.min.css
```

Expected: both files listed. If missing, download from https://leafletjs.com/download.html (v1.9.x), place at those paths, and commit separately before continuing.

- [ ] **Step 2: Create the component**

Create `src/lib/components/jkai/artifacts/MapArtifact.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { MapArtifact } from '$lib/workflows/site-tools/artifact-types';

  // Loose global typing — Leaflet loaded via static script tag, not npm.
  type LeafletGlobal = {
    map: (el: HTMLElement, opts?: Record<string, unknown>) => unknown;
    tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    marker: (latlng: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => { bindTooltip: (t: string) => unknown } };
    polyline: (coords: Array<[number, number]>, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown; getBounds: () => unknown };
    circleMarker: (latlng: [number, number], opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
    latLngBounds: (corners: Array<[number, number]>) => { extend: (p: [number, number]) => unknown };
  };

  let { artifact }: { artifact: MapArtifact } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  function ensureLeafletLoaded(): Promise<LeafletGlobal> {
    const existing = (globalThis as unknown as { L?: LeafletGlobal }).L;
    if (existing) return Promise.resolve(existing);

    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/vendor/leaflet.min.css';
      link.dataset.leaflet = 'true';
      document.head.appendChild(link);
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          const L = (globalThis as unknown as { L?: LeafletGlobal }).L;
          L ? resolve(L) : reject(new Error('Leaflet loaded but window.L missing'));
        });
        return;
      }
      const script = document.createElement('script');
      script.src = '/vendor/leaflet.min.js';
      script.dataset.leaflet = 'true';
      script.onload = () => {
        const L = (globalThis as unknown as { L?: LeafletGlobal }).L;
        L ? resolve(L) : reject(new Error('Leaflet loaded but window.L missing'));
      };
      script.onerror = () => reject(new Error('Failed to load /vendor/leaflet.min.js'));
      document.head.appendChild(script);
    });
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = await ensureLeafletLoaded();
        if (cancelled || !container) return;
        const map = L.map(container, { scrollWheelZoom: false }) as unknown as {
          setView: (c: [number, number], z: number) => unknown;
          fitBounds: (b: unknown, opts?: Record<string, unknown>) => unknown;
        };
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(map);

        const allPoints: Array<[number, number]> = [];
        for (const layer of artifact.layers) {
          if (layer.kind === 'points') {
            for (const p of layer.points) {
              const m = L.marker([p.lat, p.lng]).addTo(map);
              if (p.label) m.bindTooltip(p.label);
              allPoints.push([p.lat, p.lng]);
            }
          } else if (layer.kind === 'track') {
            const coords = layer.points.map((p) => [p.lat, p.lng] as [number, number]);
            L.polyline(coords, { color: '#2563eb', weight: 3 }).addTo(map);
            allPoints.push(...coords);
          } else {
            // heatmap — fallback to weighted circle markers (no external plugin in v1)
            for (const p of layer.points) {
              const w = typeof p.weight === 'number' ? p.weight : 1;
              L.circleMarker([p.lat, p.lng], {
                radius: Math.min(Math.max(w * 4, 3), 20),
                fillColor: '#ef4444',
                color: '#b91c1c',
                weight: 1,
                fillOpacity: 0.5,
              }).addTo(map);
              allPoints.push([p.lat, p.lng]);
            }
          }
        }

        if (artifact.center && artifact.zoom != null) {
          map.setView(artifact.center, artifact.zoom);
        } else if (allPoints.length > 0) {
          const [head, ...rest] = allPoints;
          const bounds = L.latLngBounds([head, head]);
          for (const p of rest) bounds.extend(p);
          map.fitBounds(bounds, { padding: [20, 20] });
        } else {
          (map as unknown as { setView: (c: [number, number], z: number) => unknown }).setView([51.5, -0.1], 12);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="map-artifact">
  <div class="map-container" bind:this={container}></div>
  {#if error}
    <p class="error">Map failed to render: {error}</p>
  {/if}
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
</figure>

<style>
  .map-artifact {
    margin: 0.5rem 0;
    border: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    border-radius: 6px;
    overflow: hidden;
    max-width: 100%;
  }
  .map-container {
    width: 100%;
    height: 360px;
  }
  figcaption {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    color: rgb(var(--muted-fg-rgb, 100 100 100));
    border-top: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
  }
  .error {
    color: #b00;
    padding: 0.5rem;
    font-size: 0.85rem;
    margin: 0;
  }
</style>
```

- [ ] **Step 3: Smoke-check**

```bash
cd ~/strange_rambling_svelte
npm run check 2>&1 | grep -E 'MapArtifact|error' | head -20
```

Expected: no MapArtifact-related errors.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/jkai/artifacts/MapArtifact.svelte
git commit -m "feat(jkai): add MapArtifact svelte component using static leaflet vendor"
```

---

## Task 15: `Artifact.svelte` dispatcher

**Files:**
- Create: `src/lib/components/jkai/artifacts/Artifact.svelte`

- [ ] **Step 1: Create the dispatcher**

Create `src/lib/components/jkai/artifacts/Artifact.svelte`:

```svelte
<script lang="ts">
  import type { Artifact } from '$lib/workflows/site-tools/artifact-types';
  import ChartArtifact from './ChartArtifact.svelte';
  import MapArtifact from './MapArtifact.svelte';
  import TableArtifact from './TableArtifact.svelte';

  let { artifact }: { artifact: Artifact } = $props();
</script>

{#if artifact.type === 'chart'}
  <ChartArtifact {artifact} />
{:else if artifact.type === 'map'}
  <MapArtifact {artifact} />
{:else if artifact.type === 'table'}
  <TableArtifact {artifact} />
{/if}
```

- [ ] **Step 2: Smoke-check**

```bash
cd ~/strange_rambling_svelte
npm run check 2>&1 | grep -E 'Artifact|error' | head -20
```

Expected: no Artifact-related errors.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/jkai/artifacts/Artifact.svelte
git commit -m "feat(jkai): add Artifact dispatcher component"
```

---

## Task 16: Render artifacts inline in `ChatArea.svelte`

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte`

Goal: for each assistant message, when any tool step has `result.data.artifact`, render that artifact above the text bubble (one artifact per qualifying step, in tool-call order).

- [ ] **Step 1: Read the current ChatArea rendering block**

```bash
cd ~/strange_rambling_svelte
grep -n "allToolCalls\|ChatMessage\|{#each messages" src/lib/components/jkai/ChatArea.svelte | head -20
```

Note the line of the `{#each messages as m}` template loop.

- [ ] **Step 2: Extend the `ToolStep` interface + add a helper**

In the `<script lang="ts">` block, find the `ToolStep` interface (line 20). Replace it with:

```ts
  import Artifact from '$lib/components/jkai/artifacts/Artifact.svelte';
  import type { Artifact as ArtifactT } from '$lib/workflows/site-tools/artifact-types';
  import { isArtifact } from '$lib/workflows/site-tools/artifact-types';

  interface ToolStep {
    id?: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    expanded?: boolean;
    ephemeral?: {
      handlerCode: string;
      parameters: unknown;
      proposedName?: string;
      proposedDescription?: string;
    };
  }

  function artifactsForMessage(m: Message): ArtifactT[] {
    if (!m.toolSteps) return [];
    const out: ArtifactT[] = [];
    for (const step of m.toolSteps) {
      const r = step.result as { data?: { artifact?: unknown } } | undefined;
      if (r?.data?.artifact && isArtifact(r.data.artifact)) {
        out.push(r.data.artifact);
      }
    }
    return out;
  }
```

(Keep the existing `Message` interface as-is — `toolSteps: ToolStep[]` already matches.)

- [ ] **Step 3: Render artifacts in the message loop**

Find the `{#each messages as m}` block (usually paired with `<ChatMessage ... />`). Just before or around the `<ChatMessage ... />` render for assistant messages, emit the artifact list. If the existing loop looks like:

```svelte
    {#each messages as m (m.id)}
      <ChatMessage message={m} ... />
    {/each}
```

Change it to:

```svelte
    {#each messages as m (m.id)}
      {#if m.role === 'assistant'}
        {#each artifactsForMessage(m) as artifact, i (i)}
          <Artifact {artifact} />
        {/each}
      {/if}
      <ChatMessage message={m} ... />
    {/each}
```

Preserve whatever props `ChatMessage` currently receives — don't change that.

- [ ] **Step 4: Smoke-check**

```bash
cd ~/strange_rambling_svelte
npm run check 2>&1 | grep -E 'ChatArea|error' | head -20
```

Expected: no `ChatArea`-related errors.

- [ ] **Step 5: Manual dev-server test**

```bash
cd ~/strange_rambling_svelte
npm run dev
```

Then browse `http://homeserv:5173/jkai`, open a new conversation, ask: **"Render a test table with columns name and age and rows alice=30, bob=25."**

Expected: the LLM calls `render_table`, and a sortable table renders above the assistant reply.

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/jkai/ChatArea.svelte
git commit -m "feat(jkai): render tool-call artifacts inline in ChatArea"
```

---

## Task 17: Parse `[[suggest-promote: ...]]` markers + "Save as tool" UX

**Files:**
- Create: `src/lib/components/jkai/PromoteToolBanner.svelte`
- Modify: `src/lib/components/jkai/ChatArea.svelte`
- Test: `tests/lib/jkai/promote-marker-parse.test.ts`

- [ ] **Step 1: Write the failing parser test**

Create `tests/lib/jkai/promote-marker-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePromoteMarkers, stripPromoteMarkers } from '$lib/jkai/promote-marker';

describe('parsePromoteMarkers', () => {
  it('extracts a single marker', () => {
    const text = 'Here is your chart. [[suggest-promote: step-3 as "render_sleep_chart"]]';
    const markers = parsePromoteMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].toolCallId).toBe('step-3');
    expect(markers[0].proposedName).toBe('render_sleep_chart');
  });

  it('extracts multiple markers', () => {
    const text = '[[suggest-promote: a as "tool_a"]] and [[suggest-promote: b as "tool_b"]]';
    expect(parsePromoteMarkers(text)).toHaveLength(2);
  });

  it('returns empty array when no markers', () => {
    expect(parsePromoteMarkers('hello world')).toEqual([]);
  });
});

describe('stripPromoteMarkers', () => {
  it('removes all markers from text', () => {
    const text = 'Here. [[suggest-promote: x as "y"]] Done.';
    expect(stripPromoteMarkers(text)).toBe('Here.  Done.');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/jkai/promote-marker-parse.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/lib/jkai/promote-marker.ts`:

```ts
// src/lib/jkai/promote-marker.ts
// Parse and strip [[suggest-promote: <toolCallId> as "<name>"]] markers
// emitted by the LLM in assistant replies. The marker opts the user into
// a one-click promote action; absence of the marker means no suggestion.

export type PromoteMarker = { toolCallId: string; proposedName: string };

const MARKER_RE = /\[\[suggest-promote:\s*([^\s\]]+)\s+as\s+"([^"]+)"\s*\]\]/g;

export function parsePromoteMarkers(text: string): PromoteMarker[] {
  const out: PromoteMarker[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    out.push({ toolCallId: m[1], proposedName: m[2] });
  }
  return out;
}

export function stripPromoteMarkers(text: string): string {
  return text.replace(MARKER_RE, '');
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd ~/strange_rambling_svelte
npm run test -- tests/lib/jkai/promote-marker-parse.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Create the promote banner component**

Create `src/lib/components/jkai/PromoteToolBanner.svelte`:

```svelte
<script lang="ts">
  import type { PromoteMarker } from '$lib/jkai/promote-marker';

  let { messageId, marker }: { messageId: string; marker: PromoteMarker } = $props();

  let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let errorMsg = $state<string | null>(null);
  let editing = $state(false);
  let nameInput = $state(marker.proposedName);

  async function promote() {
    status = 'saving';
    errorMsg = null;
    try {
      const res = await fetch('/api/jkai/tools/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          toolCallId: marker.toolCallId,
          name: nameInput,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      status = 'saved';
    } catch (err) {
      status = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="promote-banner" class:saved={status === 'saved'}>
  {#if status === 'saved'}
    <span>✓ Saved as <code>{nameInput}</code></span>
  {:else}
    <span>Save this as a reusable tool?</span>
    {#if editing}
      <input bind:value={nameInput} placeholder="tool_name" />
    {:else}
      <code>{nameInput}</code>
      <button onclick={() => (editing = true)} type="button" class="link">rename</button>
    {/if}
    <button onclick={promote} disabled={status === 'saving'} type="button" class="primary">
      {status === 'saving' ? 'Saving…' : 'Save as tool'}
    </button>
    {#if errorMsg}
      <span class="error">{errorMsg}</span>
    {/if}
  {/if}
</div>

<style>
  .promote-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    margin: 0.4rem 0;
    font-size: 0.85rem;
    border: 1px dashed rgb(var(--border-rgb, 200 200 200) / 0.6);
    border-radius: 6px;
    background: rgb(var(--muted-rgb, 240 240 240) / 0.3);
  }
  .promote-banner.saved {
    border-style: solid;
    opacity: 0.7;
  }
  .primary {
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    background: rgb(var(--accent-rgb, 37 99 235));
    color: white;
    border: none;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .link {
    background: none;
    border: none;
    color: rgb(var(--accent-rgb, 37 99 235));
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  input {
    padding: 0.2rem 0.4rem;
    font: inherit;
  }
  code {
    font-family: monospace;
    background: rgb(var(--muted-rgb, 240 240 240) / 0.6);
    padding: 0 0.3rem;
    border-radius: 3px;
  }
  .error { color: #b00; }
</style>
```

- [ ] **Step 6: Wire the banner into ChatArea**

Open `src/lib/components/jkai/ChatArea.svelte`. Add imports in the script block:

```ts
  import PromoteToolBanner from '$lib/components/jkai/PromoteToolBanner.svelte';
  import { parsePromoteMarkers, stripPromoteMarkers } from '$lib/jkai/promote-marker';
```

Add a helper near `artifactsForMessage`:

```ts
  function promoteMarkersForMessage(m: Message) {
    if (m.role !== 'assistant') return [];
    return parsePromoteMarkers(m.content);
  }
```

In the loop added in Task 16, emit banners after the artifact list (before `<ChatMessage>`). Change the body to use `stripPromoteMarkers` so the raw markers aren't shown. Easiest approach: pre-compute a `displayContent` per message. Inside the `{#each messages as m}` loop, use:

```svelte
    {#each messages as m (m.id)}
      {#if m.role === 'assistant'}
        {#each artifactsForMessage(m) as artifact, i (i)}
          <Artifact {artifact} />
        {/each}
        {#each promoteMarkersForMessage(m) as marker (marker.toolCallId)}
          <PromoteToolBanner messageId={m.id} {marker} />
        {/each}
      {/if}
      <ChatMessage
        message={{ ...m, content: m.role === 'assistant' ? stripPromoteMarkers(m.content) : m.content }}
        ...
      />
    {/each}
```

(Preserve the existing props being passed to `ChatMessage`; only `message` is modified to strip markers.)

- [ ] **Step 7: Smoke-check**

```bash
cd ~/strange_rambling_svelte
npm run check 2>&1 | grep -E 'ChatArea|PromoteToolBanner|error' | head -20
```

Expected: no related errors.

- [ ] **Step 8: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/jkai/promote-marker.ts src/lib/components/jkai/PromoteToolBanner.svelte src/lib/components/jkai/ChatArea.svelte tests/lib/jkai/promote-marker-parse.test.ts
git commit -m "feat(jkai): parse suggest-promote markers and render inline Save-as-tool banner"
```

---

## Task 18: Update system prompt (`03-tools.md`) with the layer ladder

**Files:**
- Modify: `data/prompts/03-tools.md`

- [ ] **Step 1: Append a new section to `03-tools.md`**

Edit `data/prompts/03-tools.md`. Append the following section at the end of the file:

```markdown

## Visualising data in chat (Layer ladder)

You have three ways to respond with multimedia. Always prefer the cheapest layer that fits.

**Layer 1 — Primitive renderers (preferred for 80% of "visualise X" requests).**
Call one of:
- `render_chart({ spec, data?, caption? })` — Vega-Lite. Supply either a full spec with `spec.data.values`, or the spec + a separate `data` array.
- `render_map({ layers, center?, zoom?, caption? })` — Leaflet. Layers can be `points`, `track`, or `heatmap`.
- `render_table({ columns, rows, caption? })` — sortable table.

Typical flow: call a data tool (e.g. `health_sleep_stats`) → construct a minimal spec → call the renderer with that data. One or two tool calls per turn.

**Layer 2 — Author a one-shot tool (`author_ephemeral_tool`).**
Use when the response requires data fetching or transformation that doesn't map to a single primitive call. Provide `name`, `description`, `parameters` (JSON Schema), `handlerCode`, and `callArgs`. Inside `handlerCode`, the `platform.call('<tool_name>', args)` helper lets you compose existing tools (including the primitives).

Your handler should return `{ success: true, data: { artifact, summary } }` — same envelope as the primitives. If the task feels reusable (parameterisable, likely to recur), emit this marker in your reply text so the user can save the tool:

```
[[suggest-promote: <the ephemeral tool's step id> as "<snake_case_name>"]]
```

The marker is invisible to the user (stripped at render time) but renders a one-click "Save as tool" banner above your message. Only emit it when promotion is genuinely useful — recurring, parameterisable, not a one-off.

**Layer 3 — The autonomous builder (`builds_start`).**
Only for multi-file web apps with UI, routes, and state beyond what fits in a single chart/map/table. Do NOT reach for the builder for a "visualise this data" request — that's always Layer 1 or Layer 2.

### Examples

User: *"Show my sleep for the last week as a chart"*
→ `health_sleep_stats({ days: 7 })` → `render_chart({ spec: { mark: 'line', encoding: { x: { field: 'date', type: 'temporal' }, y: { field: 'duration_hrs', type: 'quantitative', title: 'Sleep (hrs)' } } }, data, caption: 'Sleep — last 7 days' })` → prose reply.

User: *"Every morning summarise yesterday's training and show it as a chart + table"*
→ `author_ephemeral_tool({ name: 'training_daily_summary', handlerCode: '/* fetch + platform.call(render_chart) + platform.call(render_table) */', ... })` → emit `[[suggest-promote: <id> as "training_daily_summary"]]` in the reply.

User: *"Build me a calorie tracker app"*
→ `builds_start(...)` — Layer 3, not Layer 1/2.
```

- [ ] **Step 2: If the deploy script syncs `data/` to VPS, note it**

```bash
cd ~/strange_rambling_svelte
grep -n "data/" scripts/deploy.sh | head -5
```

Expected: a `rsync` or `scp` line referencing `data/`. If none: the plan executor should add one. Otherwise: deploy will pick up the new prompt automatically.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add data/prompts/03-tools.md
git commit -m "docs(jkai): add visualise layer ladder to orchestrator system prompt"
```

---

## Task 19: End-to-end manual verification + deploy

**Files:** none new.

- [ ] **Step 1: Full test suite green**

```bash
cd ~/strange_rambling_svelte
npm run test
```

Expected: all tests pass.

- [ ] **Step 2: Type check clean**

```bash
cd ~/strange_rambling_svelte
npm run check
```

Expected: no errors.

- [ ] **Step 3: Dev server manual E2E**

```bash
cd ~/strange_rambling_svelte
npm run dev
```

In browser at `http://homeserv:5173/jkai` (per the repo's dev-access preference), verify each of these in a new conversation:

1. **Table primitive** — "Show me my last 3 blog posts as a table with title and date columns." Expect: table renders above the assistant text.
2. **Chart primitive** — "Plot my sleep duration for the last 7 days as a line chart." Expect: line chart renders, summary in the drawer shows "line chart: N data points (...)".
3. **Map primitive** — "Show my 5 most recent runs on a map as tracks." Expect: map with polylines renders; auto-fits bounds.
4. **Ephemeral tool** — "Create a tool that pulls my training load for the last 14 days and shows it as a chart with a 7-day rolling average overlay, then suggest I save it." Expect: `author_ephemeral_tool` runs, chart renders, `[[suggest-promote: ...]]` marker becomes a "Save as tool" banner.
5. **Promotion** — click the banner. Expect: `POST /api/jkai/tools/promote` succeeds, banner flips to "✓ Saved as render_training_load_chart". Open a new conversation; ask "Use render_training_load_chart" — the tool should now be available.
6. **History rehydration** — refresh the page on the conversation from (4). The artifacts should still render inline (persisted via `metadata.toolSteps[].result.data.artifact`).

- [ ] **Step 4: Push & deploy**

```bash
cd ~/strange_rambling_svelte
git push origin master
./scripts/deploy.sh
```

Expected: deploy script completes; https://strangeramblings.com/jkai serves the new UI; same flows work against production data.

- [ ] **Step 5: Final commit if any tweaks were made during E2E**

```bash
cd ~/strange_rambling_svelte
git status
# commit anything outstanding with an appropriate message
```

---

## Self-Review

**Spec coverage:**
- Three-layer architecture → Tasks 3–5 (primitives), Task 7 (ephemeral), Task 8 (promotion) ✓
- Artifact types → Task 2 ✓
- `visualise` toolset always-on → Task 6 ✓
- Ephemeral sidecar on stored tool step → Task 9 (persistence) + Task 7 (producer) + Task 8 (consumer) ✓
- `POST /api/jkai/tools/promote` → Task 10 ✓
- `GET /api/jkai/tools` → Task 11 ✓
- Artifact Svelte components → Tasks 12–15 ✓
- ChatArea rendering → Task 16 ✓
- `[[suggest-promote: ...]]` marker parsing + banner → Task 17 ✓
- System prompt update → Task 18 ✓
- E2E + deploy → Task 19 ✓

**Placeholder scan:** no TBDs, no "similar to task N" back-references, no "add error handling" hand-waves. All code is inline.

**Type consistency:** `Artifact`, `ArtifactToolData`, `TableColumn`, `MapLayer`, `StoredToolStep`, `PromoteMarker`, `EphemeralSidecar` referenced consistently across tasks. `extractEphemeralSidecar` signature matches its caller in Task 9 Step 5.

**Scope check:** one feature, single plan — not multiple independent subsystems.

**Known deferrals (explicit in spec non-goals, not plan gaps):** no image artifacts, no iframe/HTML, no interactive widgets, no custom-tool management UI, no export/edit.

