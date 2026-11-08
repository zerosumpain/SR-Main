declare module 'virtual:sr-source-footprint' {
  export type FootprintCount = { lines: number; files: number };
  export const SOURCE_FOOTPRINT: {
    lines: number;
    files: number;
    categories: { code: FootprintCount; documentation: FootprintCount; tests: FootprintCount };
    repositories: Array<{
      id: string;
      name: string;
      url: string;
      role: string;
      /** Where the running app can be opened, when it is known (porkserv manifest `liveUrl`). */
      liveUrl?: string;
      revision: string | null;
      /** The measured commit's date. Absent in snapshots taken before 2026-11-08. */
      updatedAt?: string | null;
      measuredAt: string;
      source: string;
      code: FootprintCount;
      documentation: FootprintCount;
      tests: FootprintCount;
    }>;
    measuredAt: string;
    snapshotAt: string | null;
  };
}
