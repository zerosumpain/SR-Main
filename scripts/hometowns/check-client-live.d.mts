// Types for check-client-live.mjs (imported by its unit test).
export declare const DEFAULT_SITE: string;
export declare const ENGINE_META: string;
export declare const PAGE_META: string;
export declare function generatedHash(dir?: string): string;
export declare function generatedPageHash(root?: string): string;
export declare function pageUrl(site: string, pageHash: string): string;
export declare function engineHashMarker(html: string): string | null;
export declare function pageHashMarker(html: string): string | null;
export declare function checkClientLive(options: {
  pageHash: string;
  engineHash: string;
  site?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; url: string; problem?: string }>;
