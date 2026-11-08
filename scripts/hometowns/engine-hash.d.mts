// Types for engine-hash.mjs (imported by the engine's ENGINE_HASH staleness test).
export declare const ENGINE_DIR: string;
export declare const GENERATED: string;
export declare function engineFiles(dir?: string): string[];
export declare function computeEngineHash(dir?: string): string;
export declare function generatedSource(hash: string): string;
