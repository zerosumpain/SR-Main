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

/** Mermaid diagram source plus the caption shown above it. */
export type DiagramArtifact = {
  type: 'diagram';
  /** Mermaid source, including its leading graph/sequenceDiagram/... header. */
  code: string;
  caption?: string;
};

export type Artifact = ChartArtifact | TableArtifact | DiagramArtifact;

/** Envelope returned by any tool that produced an artifact. */
export type ArtifactToolData = {
  artifact: Artifact;
  /** Short human-readable summary shown to the LLM in lieu of the full spec. */
  summary: string;
};

export function isArtifact(v: unknown): v is Artifact {
  if (!v || typeof v !== 'object') return false;
  const t = (v as { type?: unknown }).type;
  return t === 'chart' || t === 'table' || t === 'diagram';
}
