import { isArtifact, type Artifact } from '$lib/workflows/site-tools/artifact-types';

/**
 * The rich parts of a jkai turn, reduced to what the iPhone app can draw
 * natively: charts, tables and diagrams from the visualise tools, and the
 * sources a turn cited.
 *
 * Reduced on the SERVER, not shipped raw. A chart here is a Vega-Lite spec,
 * and the phone draws with Swift Charts, which has no Vega-Lite reader. So the
 * spec is read once, here, where it is written: a single mark with an x and a
 * y field becomes `{ mark, x, y, color, rows }`, which is most of what
 * `render_chart` is ever asked for. Anything richer — layers, facets,
 * transforms, aggregates — comes back as `simple: false` with its caption, and
 * the phone offers the web rather than drawing something wrong.
 */

export type NativeAxis = { field: string; title: string; type: 'quantitative' | 'temporal' | 'nominal' | 'ordinal' };

export type NativeArtifact =
  | {
      type: 'chart';
      simple: true;
      mark: 'bar' | 'line' | 'area' | 'point';
      x: NativeAxis;
      y: NativeAxis;
      color: { field: string; title: string } | null;
      rows: Array<Record<string, string | number | null>>;
      caption: string | null;
    }
  | { type: 'chart'; simple: false; caption: string | null }
  | {
      type: 'table';
      columns: Array<{ key: string; label: string; align: 'left' | 'right' | 'center' }>;
      rows: Array<Record<string, string | number | boolean | null>>;
      totalRows: number;
      caption: string | null;
    }
  | { type: 'diagram'; code: string; caption: string | null };

export type NativeSource = {
  kind: 'file' | 'research';
  title: string;
  passage: string;
  url: string | null;
  domain: string | null;
};

/** A phone table past this many rows is a scroll nobody finishes. */
export const TABLE_ROW_CAP = 100;
/** Swift Charts draws thousands happily; the payload is what this guards. */
export const CHART_ROW_CAP = 500;
export const SOURCE_CAP = 12;
const PASSAGE_CAP = 280;

const MARKS: Record<string, 'bar' | 'line' | 'area' | 'point'> = {
  bar: 'bar',
  line: 'line',
  area: 'area',
  point: 'point',
  circle: 'point',
  square: 'point',
};

const AXIS_TYPES = new Set(['quantitative', 'temporal', 'nominal', 'ordinal']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function axis(raw: unknown): NativeAxis | null {
  if (!raw || typeof raw !== 'object') return null;
  const enc = raw as Record<string, unknown>;
  const field = str(enc.field);
  // An aggregate or a bin means the numbers on screen are not the rows sent.
  if (!field || enc.aggregate || enc.bin || enc.timeUnit) return null;
  const type = typeof enc.type === 'string' && AXIS_TYPES.has(enc.type) ? enc.type : 'nominal';
  return { field, title: str(enc.title) ?? field, type: type as NativeAxis['type'] };
}

function cell(v: unknown): string | number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return null;
}

function chart(artifact: Extract<Artifact, { type: 'chart' }>): NativeArtifact {
  const caption = str(artifact.caption);
  const spec = artifact.spec ?? {};
  const fallback: NativeArtifact = { type: 'chart', simple: false, caption };

  if (spec.layer || spec.facet || spec.repeat || spec.concat || spec.hconcat || spec.vconcat || spec.transform) {
    return fallback;
  }
  const markName = typeof spec.mark === 'string' ? spec.mark : str((spec.mark as { type?: unknown } | undefined)?.type);
  const mark = markName ? MARKS[markName] : undefined;
  const enc = (spec.encoding ?? {}) as Record<string, unknown>;
  const x = axis(enc.x);
  const y = axis(enc.y);
  if (!mark || !x || !y) return fallback;

  const colorEnc = enc.color as Record<string, unknown> | undefined;
  const colorField = str(colorEnc?.field);
  const color = colorField ? { field: colorField, title: str(colorEnc?.title) ?? colorField } : null;

  const values = artifact.data?.length
    ? artifact.data
    : Array.isArray((spec.data as { values?: unknown } | undefined)?.values)
      ? ((spec.data as { values: unknown[] }).values)
      : [];
  // Only the encoded fields travel. A row can carry twenty columns the chart
  // never reads, and the phone has no use for them.
  const fields = [x.field, y.field, ...(color ? [color.field] : [])];
  const rows = values
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
    .slice(0, CHART_ROW_CAP)
    .map((r) => Object.fromEntries(fields.map((f) => [f, cell(r[f])])));
  if (rows.length === 0) return fallback;

  return { type: 'chart', simple: true, mark, x, y, color, rows, caption };
}

function table(artifact: Extract<Artifact, { type: 'table' }>): NativeArtifact {
  const columns = (artifact.columns ?? []).map((c) => ({
    key: c.key,
    label: c.label || c.key,
    align: c.align ?? 'left',
  }));
  const rows = (artifact.rows ?? []).slice(0, TABLE_ROW_CAP).map((r) =>
    Object.fromEntries(
      columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return [c.key, null];
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return [c.key, v];
        return [c.key, JSON.stringify(v)];
      }),
    ),
  );
  return { type: 'table', columns, rows, totalRows: artifact.rows?.length ?? 0, caption: str(artifact.caption) };
}

/** Every artifact a turn's tool steps produced, in the order they ran. */
export function nativeArtifacts(toolSteps: unknown): NativeArtifact[] {
  if (!Array.isArray(toolSteps)) return [];
  const out: NativeArtifact[] = [];
  for (const step of toolSteps) {
    const result = (step as { result?: { data?: { artifact?: unknown } } } | null)?.result;
    const artifact = result?.data?.artifact;
    if (!isArtifact(artifact)) continue;
    if (artifact.type === 'chart') out.push(chart(artifact));
    else if (artifact.type === 'table') out.push(table(artifact));
    else out.push({ type: 'diagram', code: artifact.code, caption: str(artifact.caption) });
  }
  return out;
}

function clip(text: unknown): string {
  const flat = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return flat.length > PASSAGE_CAP ? `${flat.slice(0, PASSAGE_CAP - 1)}…` : flat;
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * The files and research a turn cited — `fileRefs` and `researchRefs`, the
 * same metadata the web's source chips read.
 *
 * A research ref keeps its URL, so the phone can open the page. A file ref
 * does not get one: the web opens it through `/api/files/...`, which is behind
 * the session gate, and the passage is what the reader wanted anyway.
 */
export function nativeSources(metadata: Record<string, unknown>): NativeSource[] {
  const out: NativeSource[] = [];
  const seen = new Set<string>();
  const push = (source: NativeSource) => {
    const key = `${source.kind}|${source.title}|${source.url ?? ''}`;
    if (seen.has(key) || out.length >= SOURCE_CAP) return;
    seen.add(key);
    out.push(source);
  };

  for (const ref of Array.isArray(metadata.researchRefs) ? metadata.researchRefs : []) {
    const r = (ref ?? {}) as Record<string, unknown>;
    push({
      kind: 'research',
      title: str(r.sourceTitle) ?? str(r.domain) ?? str(r.sessionTopic) ?? 'Research',
      passage: clip(r.passage),
      url: str(r.sourceUrl),
      domain: str(r.domain),
    });
  }
  for (const ref of Array.isArray(metadata.fileRefs) ? metadata.fileRefs : []) {
    const r = (ref ?? {}) as Record<string, unknown>;
    const source = str(r.source);
    push({
      kind: 'file',
      title: source ? basename(source) : 'File',
      passage: clip(r.passage),
      url: null,
      domain: null,
    });
  }
  return out;
}
