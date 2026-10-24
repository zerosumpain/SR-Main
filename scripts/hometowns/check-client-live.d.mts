// Types for check-client-live.mjs (imported by its unit test).
export declare const DEFAULT_SITE: string;
export declare const HASH_META: string;
export declare function generatedHash(dir?: string): string;
export declare function pageUrl(site: string, hash: string): string;
export declare function pageHashMarker(html: string): string | null;
export declare function checkClientLive(options: {
  hash: string;
  site?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; url: string; problem?: string }>;
