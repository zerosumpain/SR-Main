import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, relative, resolve } from 'node:path';

const ID = 'virtual:sr-source-footprint';
const RESOLVED_ID = '\0' + ID;
// Every folder of a repository is measured, except the ones below: build
// output, dependencies, caches, and asset or data folders whose files are not
// authored code. The first version measured only a fixed list of roots (src,
// scripts, tests…), so whole apps read as nothing: SR-TV's Kotlin under app/,
// the iPhone app's Swift under ios/, Wildmind's server/ and client/ (2026-11-08).
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue', '.astro',
  '.css', '.scss', '.sass', '.less', '.html', '.njk',
  '.py', '.sql', '.sh',
  '.swift', '.m', '.kt', '.kts', '.java', '.go', '.rs', '.rb', '.php', '.cs', '.dart', '.lua',
  '.c', '.h', '.cpp', '.hpp', '.tf',
]);
const EXCLUDED = new Set([
  'node_modules', 'dist', 'build', 'out', '.svelte-kit', '.next', '.vite', 'coverage', 'vendor', 'third_party',
  'generated', '__mocks__', 'fixtures', '.git', '.venv', 'venv', '__pycache__', 'target', 'Pods',
  'DerivedData', '.build', '.gradle', 'gradle', '.idea', '.vscode', '.claude', '.design-sync',
  // Served or bundled files rather than authored source.
  'static', 'public', 'assets', 'attached_assets', 'data', 'logs', 'tmp',
  // drizzle-kit's generated migrations.
  'drizzle',
]);
/** Tests by folder: `test`, `tests`, `__tests__`, and Xcode's `<Target>Tests`. */
const TEST_DIR = /^(?:test|tests|__tests__|androidTest|e2e)$|Tests$/;
/** Tests by file name across the languages above. */
const TEST_FILE = /\.(?:test|spec)\.[^.]+$|(?:Tests?|_test)\.(?:swift|kt|java|go)$|^test_.+\.py$|_test\.py$/;
/** Tool configuration at any depth: vite.config.ts, svelte.config.js, eslint.config.mjs… */
const CONFIG_FILE = /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/;

/** @param {string} path */
export function sourceCategory(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const name = basename(normalized);
  if (parts.slice(0, -1).some((part) => EXCLUDED.has(part))) return null;
  if (/\.(?:min|d)\.[^.]+$/.test(name)) return null;
  if (/\.mdx?$/.test(name)) {
    return parts[0] === 'docs' || /^README(?:\.|$)/i.test(name) ? 'documentation' : null;
  }
  if (!CODE_EXTENSIONS.has(extname(name))) return null;
  if (parts.slice(0, -1).some((part) => TEST_DIR.test(part)) || TEST_FILE.test(name)) return 'tests';
  if (parts[0] === 'docs') return null;
  if (CONFIG_FILE.test(normalized)) return null;
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
  walk(root);
  return result;
}

/** Public SR-Main source only. Private repository counts are loaded server-side. @param {string} root */
export function measureSource(root) {
  const main = measureRepository(root);
  let revision = null;
  let updatedAt = null;
  try {
    revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    updatedAt = execFileSync('git', ['-C', root, 'log', '-1', '--format=%cI', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  }
  catch { /* A fixture or source archive can have no .git directory. */ }
  const repositories = [
    { id: 'main', name: 'SR-Main', url: 'https://github.com/zerosumpain/SR-Main', role: 'Site and shared platform services', liveUrl: 'https://strangeramblings.com/', revision, updatedAt, measuredAt: new Date().toISOString(), source: 'this build', ...main },
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
