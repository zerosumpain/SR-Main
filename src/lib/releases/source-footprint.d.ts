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
      revision: string | null;
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
