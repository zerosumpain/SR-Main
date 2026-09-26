import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, relative, resolve } from 'node:path';

const ID = 'virtual:sr-source-footprint';
const RESOLVED_ID = '\0' + ID;
const ROOTS = ['src', 'packages', 'services', 'scripts', 'tests', 'gateway', 'templates', 'vite-plugins', 'docs'];
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.css', '.html', '.py', '.sql', '.sh']);
const EXCLUDED = new Set(['node_modules', 'dist', 'build', '.svelte-kit', 'coverage', 'vendor', 'generated', '__mocks__', 'fixtures']);

/** @param {string} path */
export function sourceCategory(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const name = basename(normalized);
  if (parts.some((part) => EXCLUDED.has(part))) return null;
  if (/\.(?:min|d)\.[^.]+$/.test(name)) return null;
  if (/\.mdx?$/.test(name)) {
    return parts[0] === 'docs' || /^README(?:\.|$)/i.test(name) ? 'documentation' : null;
  }
  if (!CODE_EXTENSIONS.has(extname(name))) return null;
  if (parts[0] === 'tests' || parts.some((part) => part === 'test' || part === 'tests' || part === '__tests__') || /\.(?:test|spec)\.[^.]+$/.test(name)) return 'tests';
  if (!ROOTS.includes(parts[0]) || parts[0] === 'docs') return null;
  if (/(^|\/)(?:vite|vitest|svelte|postcss|tailwind)\.config\./.test(normalized)) return null;
  return 'code';
}

/** Existing callers use this to identify authored runtime source. @param {string} path */
export function isRuntimeSource(path) {
  return sourceCategory(path) === 'code';
}

/** Count physical lines, including blank lines and comments. @param {string} root */
export function measureRepository(root) {
  const result = {
    code: { lines: 0, files: 0 },
    documentation: { lines: 0, files: 0 },
    tests: { lines: 0, files: 0 },
  };
  /** @param {string} path */
  function count(path) {
    const category = sourceCategory(relative(root, path));
    if (!category) return;
    const source = readFileSync(path, 'utf8');
    const lines = source ? source.split(/\r?\n/).length - Number(/\r?\n$/.test(source)) : 0;
    result[category].lines += lines;
    result[category].files++;
  }
  /** @param {string} dir */
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name)) walk(path);
      } else if (entry.isFile()) count(path);
    }
  }
  for (const dir of ROOTS) walk(join(root, dir));
  if (existsSync(join(root, 'README.md'))) count(join(root, 'README.md'));
  return result;
}

/** Public SR-Main source only. Private repository counts are loaded server-side. @param {string} root */
export function measureSource(root) {
  const main = measureRepository(root);
  let revision = null;
  try { revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { /* A fixture or source archive can have no .git directory. */ }
  const repositories = [
    { id: 'main', name: 'SR-Main', url: 'https://github.com/zerosumpain/SR-Main', role: 'Site and shared platform services', revision, measuredAt: new Date().toISOString(), source: 'this build', ...main },
  ];
  return {
    lines: main.code.lines,
    files: main.code.files,
    categories: main,
    repositories,
    measuredAt: new Date().toISOString(),
    snapshotAt: null,
  };
}

/** Embed the inventory in the deployed bundle; no runtime checkout is required.
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
        const path = relative(root, resolve(file));
        if (!sourceCategory(path)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('change', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}
