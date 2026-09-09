/** Read an immutable Git tree. Never read worktree bytes or execute repository code. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
/** @param {string} cwd @param {string[]} args @param {any} options @returns {any} */
const run = (cwd, args, options = {}) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, ...options });
/** @param {string} p */
const safePath = p => /^(src|scripts|packages|static|docs|tests|field-study-system|\.github)\//.test(p) || ['package.json', 'package-lock.json'].includes(p);
const imports = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
/** @param {string} p */
function normalise(p) { const out = []; for (const part of p.split('/')) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); } return out.join('/'); }
/** @param {string[]} files @param {Record<string, string>} contents */
export function analyseSources(files, contents) {
  const paths = new Set(files); const edges = []; const unresolved = []; const packages = new Map();
  for (const [path, content] of Object.entries(contents)) {
    if (!/\.(?:[cm]?[jt]sx?|svelte)$/.test(path)) continue;
    for (const match of content.matchAll(imports)) {
      const spec = match[1] ?? match[2] ?? match[3];
      const base = spec.startsWith('$lib/') ? 'src/lib/' + spec.slice(5) : spec.startsWith('.') ? normalise(path.slice(0, path.lastIndexOf('/') + 1) + spec) : null;
      if (base) {
        const target = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.svelte', '.svelte.ts', '.json', '/index.ts', '/index.js'].map(e => base + e)].find(p => paths.has(p));
        if (target) edges.push({ source: path, target, kind: 'imports' }); else unresolved.push({ path, specifier: spec });
      } else if (!spec.startsWith('$') && !spec.startsWith('node:') && !spec.startsWith('#') && !builtins.has(spec)) {
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        packages.set(name, [...new Set([...(packages.get(name) ?? []), path])]);
      }
    }
    const subject = path.replace(/\.(test|spec)(?=\.[^.]+$)/, '');
    if (subject !== path && paths.has(subject)) edges.push({ source: path, target: subject, kind: 'tests' });
  }
  /** @type {any} */
  let lock = {}; try { lock = JSON.parse(contents['package-lock.json'] ?? '{}'); } catch {}
  const dependencies = [...packages].map(([name, usedBy]) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    return { name, version: entry?.version ?? null, license: entry?.license ?? null, integrity: entry?.integrity ?? null, usedBy };
  });
  const routes = files.filter(p => /^src\/routes\/.*\+(page\.svelte|server\.ts)$/.test(p)).map(path => ({ path,
    route: '/' + path.slice('src/routes/'.length).split('/').slice(0, -1).filter(s => !/^\(.*\)$/.test(s)).join('/') }));
  return { edges: [...new Map(edges.map(e => [JSON.stringify(e), e])).values()], unresolved, dependencies, routes };
}
/** @param {string} cwd */
export function snapshotTree(cwd, ref = 'HEAD', repo = 'SR-Main') {
  if (typeof ref !== 'string' || ref.startsWith('-') || ref.length > 200) throw new Error('Invalid Git revision');
  const revision = run(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  /** @type {Array<{path: string, mode: string, hash: string, size: number}>} */
  const entries = run(cwd, ['ls-tree', '-rl', '-z', revision]).split('\0').filter(Boolean).map(/** @param {string} line */ line => {
    const [meta, path] = line.split('\t'); const parts = meta.trim().split(/\s+/); return { path, mode: parts[0], hash: parts[2], size: Number(parts[3]) };
  }).filter(/** @param {{path: string, mode: string}} e */ e => safePath(e.path) && e.mode !== '120000');
  const files = entries.map(e => e.path); const blobs = entries.filter(e => /\.(?:[cm]?[jt]sx?|svelte)$/.test(e.path) || ['package.json', 'package-lock.json'].includes(e.path)).filter(e => e.size < 4_000_000);
  if (blobs.reduce((sum, e) => sum + e.size, 0) > 80_000_000) throw new Error('Source snapshot exceeds 80 MB read budget');
  /** @type {Record<string, string>} */
  const contents = {}; let offset = 0;
  if (blobs.length) {
    const raw = run(cwd, ['cat-file', '--batch'], { encoding: null, input: blobs.map(e => e.hash).join('\n') + '\n' });
    for (const e of blobs) { const end = raw.indexOf(10, offset); const size = Number(raw.subarray(offset, end).toString().split(' ')[2]);
      if (!Number.isFinite(size)) throw new Error('Incomplete Git blob response');
      contents[e.path] = raw.subarray(end + 1, end + 1 + size).toString(); offset = end + 1 + size + 1; }
  }
  return { version: 1, repo, revision, complete: true, fileCount: files.length, files,
    hashes: Object.fromEntries(entries.map(e => [e.path, e.hash])), ...analyseSources(files, contents),
    manifestHash: createHash('sha256').update([...files].sort().join('\n')).digest('hex'),
    limitations: ['Static imports and conventional test pairs only; runtime dependencies and test coverage may be missing.'],
  };
}
