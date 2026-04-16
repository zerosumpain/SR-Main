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
