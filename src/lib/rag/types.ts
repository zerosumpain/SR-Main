// RAG engine types — "Interact using model" over Drive files.
// The index is a flat list of embedded chunks serialized to Azure Blob as
// NDJSON; retrieval is an in-memory dot product over unit-normalized vectors.

export type RagChunk = {
  /** `<collectionId>#<ordinal>` — globally unique within a collection. */
  id: string;
  /** The chunk text that was embedded. */
  text: string;
  /** Unit-normalized embedding vector. */
  vector: number[];
  /** Display source — the originating file name. */
  source: string;
  /** Ordinal within the whole collection (stable citation key). */
  ord: number;
  /** Character span within the source document (for provenance). */
  charStart: number;
  charEnd: number;
};

/** Sidecar manifest describing how an index was built. */
export type RagIndexMeta = {
  collection: string;
  model: string;
  dim: number;
  count: number;
  chunkChars: number;
  overlapChars: number;
  normalized: true;
};

/** A retrieved chunk plus its similarity score. */
export type RagHit = RagChunk & { score: number };

/** A citation surfaced back to the UI. */
export type RagCitation = { n: number; source: string; ord: number };

export const CHUNK_CHARS = 1000;
export const OVERLAP_CHARS = 150;
export const RETRIEVE_TOP_K = 10;
/** Minimum cosine similarity (dot product of unit vectors) to keep a hit. */
export const RETRIEVE_MIN_SIM = 0.2;
/** Cap on characters injected per retrieved passage. */
export const MAX_PASSAGE_CHARS = 1400;
