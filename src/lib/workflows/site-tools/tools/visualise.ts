// src/lib/workflows/site-tools/tools/visualise.ts
// Primitive renderer tools. Each returns an ArtifactToolData envelope so
// ChatArea can render the output inline. Kept dependency-free on the server;
// client components pull in vega-embed / leaflet at render time.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import type { Artifact, ArtifactToolData, TableColumn } from '../artifact-types';
import { geocodePlace, geocodePlaces } from '../geocode';

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
    'Render a structured table inline in the chat — sortable, and it does not bloat the reply the way a markdown table does. Prefer it over a markdown table whenever there are more than three rows of like-shaped records (metrics, comparisons, rankings).',
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
    'Render a chart inline in the chat using a Vega-Lite spec. Reach for it whenever the answer is a quantity over time, a comparison, or a distribution — three or more numbers you would otherwise narrate in prose is a chart, whether or not the user used the word. Supply the data either as the `data` argument or inside `spec.data.values`. Keep the spec minimal: colour, fonts, grid, legend and sorting come from the site design system underneath your spec, so do not set them.',
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

type MapPointArg = {
  lat?: number;
  lng?: number;
  /** A place NAME, resolved server-side when lat/lng are absent. */
  place?: string;
  label?: string;
  weight?: number;
};

type MapLayerArg = {
  kind: 'points' | 'track' | 'heatmap';
  points: MapPointArg[];
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
    'Render an interactive map inline in the chat. Reach for it whenever the answer is somewhere on Earth — a location, a route, a spread of points — not only when the user asks for a map. Center/zoom auto-fit from point bounds if omitted.',
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
                description:
                  'Either coordinates (`lat` + `lng`) or a `place` name to look up. PREFER `place` — a name is looked up against OpenStreetMap and plotted exactly, where a coordinate written from memory is usually wrong by a street or more.',
                properties: {
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  place: {
                    type: 'string',
                    description:
                      'Place name to geocode, e.g. "Norwich Cathedral" or "Mousehold Heath, Norwich". Used when lat/lng are omitted. Include the town or county — the more specific, the better the hit.',
                  },
                  label: { type: 'string' },
                  weight: { type: 'number', description: 'Only used for heatmap layers.' },
                },
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
      near: {
        type: 'array',
        description:
          'Optional [lat, lng] hint for resolving `place` names. Strongly recommended when the names are ambiguous — "Snowdon" alone resolves to Montreal, not Wales.',
        items: { type: 'number' },
      },
      caption: { type: 'string' },
    },
    required: ['layers'],
  },
  handler: async (args): Promise<ToolResult> => {
    const layers = args.layers as MapLayerArg[] | undefined;
    const center = args.center as [number, number] | undefined;
    const zoom = args.zoom as number | undefined;
    const near = args.near as [number, number] | undefined;
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
        if (!p || typeof p !== 'object') return fail(`layers[${i}].points[${j}] must be an object`);
        const hasCoords = typeof p.lat === 'number' && typeof p.lng === 'number';
        const hasPlace = typeof p.place === 'string' && p.place.trim().length > 1;
        if (!hasCoords && !hasPlace) {
          return fail(
            `layers[${i}].points[${j}] needs either numeric lat and lng, or a "place" name to look up`,
          );
        }
      }
    }

    // Resolve every `place` in one pass. Batched deliberately: geocodePlaces
    // de-duplicates and paces itself against Nominatim's one-per-second policy,
    // which a per-point lookup inside the loop below would not.
    const wanted: string[] = [];
    for (const l of layers) {
      for (const p of l.points) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
          if (typeof p.place === 'string') wanted.push(p.place);
        }
      }
    }
    const resolved = new Map<string, { lat: number; lng: number; label: string } | null>();
    if (wanted.length > 0) {
      for (const r of await geocodePlaces(wanted, near ? { near } : {})) {
        resolved.set(r.place.trim().toLowerCase(), r.hit);
      }
    }

    // A place that would not resolve fails the whole call. Plotting the rest
    // would draw a map that looks complete and is quietly missing somewhere —
    // the exact failure this lookup exists to prevent.
    const unresolved: string[] = [];
    const plotted: MapLayerArg[] = layers.map((l) => ({
      kind: l.kind,
      points: l.points.map((p) => {
        if (typeof p.lat === 'number' && typeof p.lng === 'number') {
          return { lat: p.lat, lng: p.lng, label: p.label, weight: p.weight };
        }
        const hit = resolved.get((p.place ?? '').trim().toLowerCase());
        if (!hit) {
          unresolved.push(p.place ?? '(unnamed)');
          return { lat: 0, lng: 0 };
        }
        // Nominatim's label is kept when the caller supplied none, so the
        // tooltip says which "Newcastle" it actually plotted.
        return { lat: hit.lat, lng: hit.lng, label: p.label ?? hit.label, weight: p.weight };
      }),
    }));

    if (unresolved.length > 0) {
      return fail(
        `could not find ${unresolved.map((u) => JSON.stringify(u)).join(', ')} — add the town or county to the name, or pass lat/lng directly` +
          (near ? '' : ', or set `near` to bias the lookup'),
      );
    }

    const artifact: Artifact = {
      type: 'map',
      center,
      zoom,
      layers: plotted as Artifact extends { type: 'map'; layers: infer L } ? L : never,
      caption,
    };
    const summary = summariseMap(plotted);
    return ok(artifact, summary);
  },
});

// -------- render_diagram --------

/** The mermaid diagram headers worth advertising. A model that writes anything
 *  else still gets rendered — mermaid decides — but the enum keeps the prompt
 *  honest about what the chat is good at. */
const DIAGRAM_KINDS = [
  'flowchart',
  'sequenceDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'classDiagram',
  'gantt',
  'timeline',
  'mindmap',
  'journey',
  'pie',
] as const;

register({
  name: 'render_diagram',
  description:
    'Render a Mermaid diagram inline in the chat — flowcharts, sequence, state, ER, class, gantt, timeline, mindmap. Use when the answer is a STRUCTURE or a PROCESS (how components relate, what order steps happen in, a state machine) rather than a quantity. For quantities use render_chart; for places use render_map.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description:
          'Mermaid source including its header line, e.g. "flowchart TD\\n  A[Start] --> B{Check}\\n  B -->|yes| C[Done]". Do NOT wrap it in a markdown code fence.',
      },
      caption: { type: 'string', description: 'Optional caption shown above the diagram.' },
    },
    required: ['code'],
  },
  handler: async (args): Promise<ToolResult> => {
    const raw = args.code as string | undefined;
    const caption = args.caption as string | undefined;

    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return fail('code must be a non-empty Mermaid source string');
    }
    // Models reach for a fence out of habit; mermaid chokes on the backticks.
    // Stripping one is kinder than failing the call over punctuation.
    const code = raw
      .trim()
      .replace(/^```(?:mermaid)?\s*\n?/i, '')
      .replace(/\n?```$/, '')
      .trim();
    if (!code) return fail('code was an empty Mermaid fence');

    const header = code.split('\n', 1)[0]?.trim() ?? '';
    const kind = DIAGRAM_KINDS.find((k) => header.toLowerCase().startsWith(k.toLowerCase()));
    // `graph` is flowchart's older spelling and still the one models write most.
    if (!kind && !/^(graph|gitGraph|quadrantChart|requirementDiagram|C4Context)\b/i.test(header)) {
      return fail(
        `first line must be a Mermaid diagram header (got ${JSON.stringify(header.slice(0, 40))}). Expected one of: ${DIAGRAM_KINDS.join(', ')}`,
      );
    }

    const artifact: Artifact = { type: 'diagram', code, caption };
    const lines = code.split('\n').length;
    const summary = `${kind ?? header.split(/\s+/)[0]} diagram: ${lines} lines`;
    return ok(artifact, summary);
  },
});

// -------- geocode_place --------

register({
  name: 'geocode_place',
  description:
    'Look up the coordinates of a place by name, against OpenStreetMap. Use it whenever you need a lat/lng and do not have one from a tool — never write coordinates from memory, which are routinely wrong by a street or a country. render_map can take a `place` directly, so this is for the other cases: a distance calculation, a weather lookup, a trail start.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      place: {
        type: 'string',
        description:
          'The place name, as specific as you can make it — "Norwich Cathedral, Norfolk" beats "the cathedral".',
      },
      near: {
        type: 'array',
        description:
          'Optional [lat, lng] hint. Worth passing whenever the name is ambiguous: "Snowdon" alone resolves to Montreal.',
        items: { type: 'number' },
      },
    },
    required: ['place'],
  },
  handler: async (args): Promise<ToolResult> => {
    const place = args.place as string | undefined;
    const near = args.near as [number, number] | undefined;
    if (typeof place !== 'string' || place.trim().length < 2) {
      return fail('place must be a non-empty name');
    }
    const hit = await geocodePlace(place, near ? { near } : {});
    if (!hit) {
      return fail(
        `could not find ${JSON.stringify(place)} — add the town or county, or pass a \`near\` hint`,
      );
    }
    return {
      success: true,
      data: {
        lat: hit.lat,
        lng: hit.lng,
        // The matched label, so a wrong hit is caught here rather than on a map.
        label: hit.label,
        source: hit.source,
      },
    };
  },
});
