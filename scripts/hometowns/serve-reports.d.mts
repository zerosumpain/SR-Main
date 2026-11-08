// Types for serve-reports.mjs (imported by the map page's tests).
import type { Server } from 'node:http';
export declare function resolveInside(root: string, urlPath: string): Promise<string | null>;
export declare function createReportServer(root?: string): Server;
