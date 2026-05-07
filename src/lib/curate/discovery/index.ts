// src/lib/curate/discovery/index.ts
//
// Barrel + DiscoveryToolkit interface + defaultToolkit() factory.
// The curate engine imports this and passes a DiscoveryToolkit instance to
// the discovery phase so tools can be swapped out in tests.

export { webSearch, webFetch, clearWebCaches } from './web';
export type { SearchResult, FetchResult } from './web';

export { queryLibraryDocs, clearContext7Cache } from './context7';
export type { DocExcerpt, LibraryDocsResult } from './context7';

export { readNode, readPanel, readPackageJson, listAvailableNodes } from './repo-readers';
export type { NodeSources, PackageJsonDeps } from './repo-readers';

export { srDocsRead } from './sr-docs-reader';
export type { SrDocsEntry } from './sr-docs-reader';

// ── DiscoveryToolkit interface ────────────────────────────────────────────

import type { SearchResult, FetchResult } from './web';
import type { LibraryDocsResult } from './context7';
import type { NodeSources, PackageJsonDeps } from './repo-readers';
import type { SrDocsEntry } from './sr-docs-reader';

export interface DiscoveryToolkit {
  /** Search the web for the given query. Returns title/url/snippet triples. */
  webSearch(query: string): Promise<SearchResult[]>;

  /** Fetch a URL and return its readable text content. */
  webFetch(url: string): Promise<FetchResult>;

  /**
   * Fetch documentation excerpts for an npm library.
   * Searches for library-specific docs to inform the proposal.
   */
  queryLibraryDocs(libraryName: string, query: string): Promise<LibraryDocsResult>;

  /**
   * Read an existing workflow node's definition + executor source.
   * Returns null if the node type does not exist.
   */
  readNode(type: string): Promise<NodeSources | null>;

  /**
   * Read a panel Svelte component by name.
   * Returns null if the component does not exist.
   */
  readPanel(componentName: string): Promise<string | null>;

  /** Return the project's dependencies and devDependencies from package.json. */
  readPackageJson(): Promise<PackageJsonDeps>;

  /** List all available node type names in the project. */
  listAvailableNodes(): Promise<string[]>;

  /**
   * Read files from the sr-docs internal workflow corpus.
   * Pass a filename, glob pattern, or "*" for all files.
   */
  srDocsRead(globOrPath: string): Promise<SrDocsEntry[]>;
}

// ── defaultToolkit ────────────────────────────────────────────────────────

import { webSearch, webFetch } from './web';
import { queryLibraryDocs } from './context7';
import { readNode, readPanel, readPackageJson, listAvailableNodes } from './repo-readers';
import { srDocsRead } from './sr-docs-reader';

/**
 * Returns a DiscoveryToolkit instance wired up with the real implementations.
 * Each call returns the same logical instance (functions are referentially
 * stable module exports) — safe to call multiple times.
 */
export function defaultToolkit(): DiscoveryToolkit {
  return {
    webSearch,
    webFetch,
    queryLibraryDocs,
    readNode,
    readPanel,
    readPackageJson,
    listAvailableNodes,
    srDocsRead,
  };
}
