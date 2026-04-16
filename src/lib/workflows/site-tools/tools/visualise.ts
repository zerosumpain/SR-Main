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
