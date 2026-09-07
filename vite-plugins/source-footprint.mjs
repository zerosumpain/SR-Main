import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const ID = 'virtual:sr-source-footprint';
const RESOLVED_ID = '\0' + ID;
const ROOTS = ['src', 'packages', 'services', 'static'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.css', '.html', '.py', '.sql', '.sh']);
const EXCLUDED = new Set(['node_modules', 'dist', '.svelte-kit', 'coverage', 'vendor', 'generated', '__tests__', '__mocks__', 'tests', 'fixtures']);

/** Whether a path belongs to the authored runtime source inventory. @param {string} path */
export function isRuntimeSource(path) {
  const parts = path.replaceAll('\\', '/').split('/');
  return ROOTS.includes(parts[0]) && !parts.some((part) => EXCLUDED.has(part))
    && !/^(packages|services)\/[^/]+\/build\//.test(path)
    && EXTENSIONS.has(extname(path)) && !/\.(test|spec|d)\.[^.]+$|\.min\.[^.]+$/.test(path)
    && !/(^|\/)(?:vite|vitest|svelte|postcss|tailwind)\.config\./.test(path)
    && !/^packages\/[^/]+\/build\.mjs$/.test(path);
}

/** Count physical, non-blank source lines; comments intentionally remain included.
 * @param {string} root
 */
export function measureSource(root) {
  let lines = 0;
  let files = 0;
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name)) walk(path);
      } else if (entry.isFile() && isRuntimeSource(relative(root, path))) {
        lines += readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim()).length;
        files++;
      }
    }
  }
  // Missing roots or unreadable source fail the build instead of publishing a partial total.
  for (const dir of ROOTS) walk(join(root, dir));
  return { lines, files, measuredAt: new Date().toISOString() };
}

/** Embed the inventory in the deployed bundle; no runtime source checkout is required.
 * @returns {import('vite').Plugin}
 */
export function sourceFootprint() {
  let root = process.cwd();
  return {
    name: 'sr-source-footprint',
    configResolved(config) { root = config.root; },
    resolveId(id) { return id === ID ? RESOLVED_ID : null; },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export const SOURCE_FOOTPRINT = ${JSON.stringify(measureSource(root))};`;
    },
    configureServer(server) {
      const invalidate = (/** @type {string} */ file) => {
        if (!isRuntimeSource(relative(root, resolve(file)))) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('change', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}
