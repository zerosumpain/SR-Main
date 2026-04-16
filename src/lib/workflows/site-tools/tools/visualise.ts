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
