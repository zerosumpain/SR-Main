// Types for page-hash.mjs (imported by the PAGE_HASH staleness test and the deploy test).
export declare const REPO: string;
export declare const VIEW: string;
export declare const GENERATED_PAGE: string;
export declare function pageFiles(root?: string): string[];
export declare function computePageHash(root?: string): string;
export declare function generatedPageSource(hash: string): string;
