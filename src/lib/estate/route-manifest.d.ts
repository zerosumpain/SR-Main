declare module 'virtual:sr-route-manifest' {
  /** Emitted at build time by vite-plugins/route-manifest.mjs. */
  export const ROUTE_MANIFEST: Array<{
    path: string;
    kind: 'api' | 'page';
    methods: string[];
  }>;
}
