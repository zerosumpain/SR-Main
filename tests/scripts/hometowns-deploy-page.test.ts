// scripts/hometowns/deploy-page.sh against a throwaway repository and a fake
// VPS: ssh, rsync and curl are stand-ins on PATH that act on a temp folder,
// so nothing here touches the network or a real host.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeEngineHash, generatedSource } from '../../scripts/hometowns/engine-hash.mjs';
import { computePageHash, generatedPageSource } from '../../scripts/hometowns/page-hash.mjs';

const FAKES: Record<string, string> = {
  ssh: `#!/bin/bash
echo "ssh $*" >> "$FAKE_LOG"
while [[ $# -gt 0 ]]; do case "$1" in -i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done
shift
exec bash -c "$*"
`,
  rsync: `#!/bin/bash
echo "rsync $*" >> "$FAKE_LOG"
args=()
while [[ $# -gt 0 ]]; do case "$1" in -e) shift 2 ;; -*) shift ;; *) args+=("$1"); shift ;; esac; done
dest="\${args[1]#*:}"
mkdir -p "$dest" && cp -R "\${args[0]}". "$dest"
`,
  curl: `#!/bin/bash
echo "curl $*" >> "$FAKE_LOG"
while [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2 ;; -D) hdr="$2"; shift 2 ;; -w|--max-time) shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
[[ -n "$FAKE_CURL_EXIT" ]] && { echo "curl: (6) Could not resolve host" >&2; exit "$FAKE_CURL_EXIT"; }
file="$VPS_DIR/data/jkai-projects/\${url#https://site.test/projects/}"
case "$file" in *.js) type=application/javascript ;; *) type=text/html ;; esac
if [[ -f "$file" && -r "$file" ]]; then
  printf 'HTTP/1.1 200 OK\\r\\nContent-Type: %s\\r\\nContent-Security-Policy: %s\\r\\n\\r\\n' "$type" "\${FAKE_CSP:-default-src 'self'}" > "$hdr"
  cp "$file" "$out"; [[ -n "$FAKE_CORRUPT" && "$url" == *"$FAKE_CORRUPT" ]] && echo junk > "$out"; printf 200
else
  printf 'HTTP/1.1 404 Not Found\\r\\n\\r\\n' > "$hdr"; : > "$out"; printf 404
fi
`,
  // The page build, reduced to what the script checks: dist/<PAGE_HASH>/
  // with both meta tags and both hashes in a bundled script.
  npm: `#!/bin/bash
echo "npm $*" >> "$FAKE_LOG"
e="$(sed -n "s/^export const ENGINE_HASH = '\\([0-9a-f]*\\)';$/\\1/p" src/lib/games/hometowns/engine/engine-hash.generated.ts)"
p="$(sed -n "s/^export const PAGE_HASH = '\\([0-9a-f]*\\)';$/\\1/p" src/lib/games/hometowns/page-hash.generated.ts)"
d="games/hometowns-view/dist/$p"
mkdir -p "$d/assets"
printf '<!doctype html><head><meta name="hometowns-engine-hash" content="%s"><meta name="hometowns-page-hash" content="%s"></head>\\n' "$e" "$p" > "$d/mobile.html"
printf "const ENGINE_HASH = '%s', PAGE_HASH = '%s';\\n" "$e" "$p" > "$d/assets/index-abc.js"
`,
};

let dir: string;
let repo: string;
let vps: string;
/** The fixture's ENGINE_HASH and PAGE_HASH; the folder is named by `hash`, the PAGE_HASH. */
let engineHash: string;
let hash: string;
const engine = () => join(repo, 'src/lib/games/hometowns/engine');
const view = () => join(repo, 'games/hometowns-view');
const remote = (h = hash) => join(vps, 'data/jkai-projects/hometowns', h);
const git = (...args: string[]) =>
  spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });

/** A build in dist/<h>/ whose markers say `marker` (page) and `engineMarker`. */
function page(h: string, marker = h, engineMarker = engineHash) {
  const d = join(repo, 'games/hometowns-view/dist', h);
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(
    join(d, 'mobile.html'),
    `<!doctype html><head><meta name="hometowns-engine-hash" content="${engineMarker}"><meta name="hometowns-page-hash" content="${marker}"></head>\n`,
  );
  writeFileSync(join(d, 'assets/index-abc.js'), `const ENGINE_HASH = '${engineMarker}', PAGE_HASH = '${h}';\n`);
}

/** Regenerates page-hash.generated.ts for the tree as it stands, and returns the hash. */
function regeneratePageHash(): string {
  const h = computePageHash(repo);
  writeFileSync(join(repo, 'src/lib/games/hometowns/page-hash.generated.ts'), generatedPageSource(h));
  return h;
}

function deploy(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [join(repo, 'scripts/hometowns/deploy-page.sh'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      FAKE_LOG: join(dir, 'calls'),
      VPS_DIR: vps,
      VPS_KEY: join(dir, 'key'),
      HOMETOWNS_SITE: 'https://site.test',
      HOMETOWNS_LIVE_TRIES: '1',
      ...env,
    },
  });
  const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '';
  return { status: r.status, out: r.stdout, err: r.stderr, calls };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hometowns-deploy-'));
  repo = join(dir, 'repo');
  vps = join(dir, 'vps');
  mkdirSync(join(dir, 'bin'));
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  writeFileSync(join(dir, 'key'), 'not a key');
  mkdirSync(join(repo, 'scripts/hometowns'), { recursive: true });
  for (const f of ['deploy-page.sh', 'engine-hash.mjs', 'page-hash.mjs']) cpSync(join('scripts/hometowns', f), join(repo, 'scripts/hometowns', f));
  mkdirSync(engine(), { recursive: true });
  writeFileSync(join(engine(), 'rules.ts'), 'export const RULES = 1;\n');
  engineHash = computeEngineHash(engine());
  writeFileSync(join(engine(), 'engine-hash.generated.ts'), generatedSource(engineHash));
  mkdirSync(join(view(), 'src'), { recursive: true });
  writeFileSync(join(view(), '.gitignore'), 'dist/\n');
  writeFileSync(join(view(), 'src/draw.ts'), 'export const LINE = 1;\n');
  hash = regeneratePageHash();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  page(hash);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('deploy-page.sh refuses before it reaches the VPS', () => {
  it('names the folder by PAGE_HASH, never the engine hash', () => {
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).not.toBe(engineHash);
    const r = deploy(['--dry-run', '--no-build']);
    expect(r.status).toBe(0);
    expect(r.out).toContain(`PAGE_HASH ${hash}, ENGINE_HASH ${engineHash}`);
    expect(r.out).toContain(`/hometowns/${hash}/`);
    expect(r.out).not.toContain(`/hometowns/${engineHash}`);
  });

  it('refuses a stale ENGINE_HASH', () => {
    writeFileSync(join(engine(), 'rules.ts'), 'export const RULES = 2;\n');
    git('commit', '-qam', 'engine change without a new hash');
    const r = deploy([]);
    expect(r.status).toBe(2);
    expect(r.err).toContain('stale');
    expect(r.calls).toBe('');
  });

  it('refuses a stale PAGE_HASH (a page change without rerunning page-hash.mjs)', () => {
    writeFileSync(join(view(), 'src/draw.ts'), 'export const LINE = 2;\n');
    git('commit', '-qam', 'page change without a new hash');
    const r = deploy([]);
    expect(r.status).toBe(2);
    expect(r.err).toContain('page-hash.generated.ts is stale');
    expect(r.calls).toBe('');
  });

  it('refuses an uncommitted engine change', () => {
    writeFileSync(join(engine(), 'extra.ts'), 'export const X = 1;\n');
    const r = deploy(['--dry-run']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('uncommitted');
    expect(r.calls).toBe('');
  });

  it('publishes only what it built: --no-build and --dist are dry-run only', () => {
    for (const args of [['--no-build'], ['--dist', join(repo, 'games/hometowns-view/dist', hash)]]) {
      const r = deploy(args);
      expect(r.status).toBe(1);
      expect(r.err).toContain('only go with --dry-run');
      expect(r.calls).toBe('');
    }
  });

  it('refuses a gitignored file that could feed the build', () => {
    writeFileSync(join(repo, 'games/hometowns-view/.gitignore'), 'dist/\n.env.local\n');
    git('commit', '-qam', 'ignore env files');
    writeFileSync(join(repo, 'games/hometowns-view/.env.local'), 'VITE_X=1\n');
    const r = deploy(['--dry-run']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('.env.local');
    expect(r.calls).toBe('');
  });

  it("refuses a build whose page names another page hash", () => {
    page(hash, '0123456789abcdef');
    const r = deploy(['--dry-run', '--no-build']);
    expect(r.status).toBe(2);
    expect(r.err).toContain("page hash '0123456789abcdef'");
    expect(r.calls).toBe('');
  });

  it('refuses a build whose page names another engine', () => {
    page(hash, hash, '0123456789abcdef');
    const r = deploy(['--dry-run', '--no-build']);
    expect(r.status).toBe(2);
    expect(r.err).toContain("engine hash '0123456789abcdef'");
    expect(r.calls).toBe('');
  });

  it('refuses a build folder for some other page hash, the engine hash included', () => {
    for (const other of ['0123456789abcdef', engineHash]) {
      page(other, other);
      const r = deploy(['--dry-run', '--dist', join(repo, 'games/hometowns-view/dist', other)]);
      expect(r.status).toBe(2);
      expect(r.err).toContain('not the current PAGE_HASH');
    }
  });
});

describe('deploy-page.sh on the VPS', () => {
  it('prints the copy on a dry run and writes nothing', () => {
    const r = deploy(['--dry-run', '--no-build']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('Will copy 2 files');
    expect(r.out).toMatch(/\.\/mobile\.html/);
    expect(r.out).toMatch(/\.\/assets\/index-abc\.js/);
    expect(r.out).toContain('Dry run: nothing was copied');
    expect(r.calls).not.toMatch(/^(rsync|curl)/m);
    expect(r.calls.match(/^ssh /gm)).toHaveLength(1);
    expect(existsSync(join(vps, 'data'))).toBe(false);
  });

  it('publishes additively, leaves old hashes alone, and an identical rerun is a no-op', () => {
    mkdirSync(remote('00000000000000aa'), { recursive: true });
    writeFileSync(join(remote('00000000000000aa'), 'mobile.html'), 'an older page');
    const first = deploy([]);
    expect(first.err).toBe('');
    expect(first.status).toBe(0);
    expect(first.out).toContain(`Live: 200 text/html, first-party CSP, page ${hash} (engine ${engineHash}), 2 files byte-identical`);
    expect(first.calls).toMatch(/^npm --prefix games\/hometowns-view run build$/m);
    expect(first.calls).toContain(`/hometowns/${hash}/assets/index-abc.js`);
    expect(readFileSync(join(remote(), 'mobile.html'), 'utf8')).toContain(hash);
    expect(readFileSync(join(remote('00000000000000aa'), 'mobile.html'), 'utf8')).toBe('an older page');
    expect(existsSync(join(vps, 'data/jkai-projects/hometowns', `.incoming-${hash}`))).toBe(false);
    expect(first.calls).not.toContain('--delete');
    expect(first.calls.match(/^rsync /gm)).toHaveLength(1);

    const again = deploy([]);
    expect(again.status).toBe(0);
    expect(again.out).toContain('byte-identical: nothing to copy');
    expect(again.calls.match(/^rsync /gm)).toHaveLength(1);
  });

  it('publishes a page-only change to a new folder and leaves the old page untouched', () => {
    const first = deploy([]);
    expect(first.status).toBe(0);
    const oldHash = hash;
    const oldPage = readFileSync(join(remote(oldHash), 'mobile.html'), 'utf8');

    // A drawing fix: the engine (and so ENGINE_HASH) is unchanged, the page is not.
    writeFileSync(join(view(), 'src/draw.ts'), 'export const LINE = 2;\n');
    hash = regeneratePageHash();
    git('commit', '-qam', 'page-only change');
    expect(hash).not.toBe(oldHash);
    expect(computeEngineHash(engine())).toBe(engineHash);

    const second = deploy([]);
    expect(second.err).toBe('');
    expect(second.status).toBe(0);
    expect(second.out).toContain(`page ${hash} (engine ${engineHash})`);
    expect(second.out).not.toContain('already exists');
    // The fake log is cumulative: one upload per run.
    expect(second.calls.match(/^rsync /gm)).toHaveLength(2);
    expect(readFileSync(join(remote(hash), 'mobile.html'), 'utf8')).toContain(hash);
    expect(readFileSync(join(remote(oldHash), 'mobile.html'), 'utf8')).toBe(oldPage);

    const again = deploy([]);
    expect(again.status).toBe(0);
    expect(again.out).toContain('byte-identical: nothing to copy');
    expect(again.calls.match(/^rsync /gm)).toHaveLength(2);
  });

  it('refuses to overwrite a different build under the same PAGE_HASH', () => {
    mkdirSync(remote(), { recursive: true });
    writeFileSync(join(remote(), 'mobile.html'), 'someone else\'s build');
    const r = deploy([]);
    expect(r.status).toBe(3);
    expect(r.err).toContain('already exists with different contents');
    expect(r.calls).not.toMatch(/^rsync /m);
    expect(readFileSync(join(remote(), 'mobile.html'), 'utf8')).toBe('someone else\'s build');
  });

  it('makes a published but unreadable folder readable on a rerun', () => {
    page(hash);
    mkdirSync(remote(), { recursive: true });
    cpSync(join(repo, 'games/hometowns-view/dist', hash), remote(), { recursive: true });
    chmodSync(join(remote(), 'mobile.html'), 0o600);
    chmodSync(remote(), 0o700);
    const r = deploy([]);
    expect(r.status).toBe(0);
    expect(r.out).toContain('not world-readable');
    expect(statSync(join(remote(), 'mobile.html')).mode & 0o777).toBe(0o644);
    expect(statSync(remote()).mode & 0o777).toBe(0o755);
    expect(r.calls).not.toMatch(/^rsync /m);
  });

  it('refuses while another run holds the staging folder, and leaves it alone', () => {
    const staging = join(vps, 'data/jkai-projects/hometowns', `.incoming-${hash}`);
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'mobile.html'), 'half an upload');
    const r = deploy([]);
    expect(r.status).toBe(3);
    expect(r.err).toContain('another deploy');
    expect(r.calls).not.toMatch(/^rsync /m);
    expect(readFileSync(join(staging, 'mobile.html'), 'utf8')).toBe('half an upload');
    expect(existsSync(remote())).toBe(false);
  });

  it('says the upload happened when the live check cannot connect', () => {
    const r = deploy([], { FAKE_CURL_EXIT: '6', HOMETOWNS_LIVE_TRIES: '2' });
    expect(r.status).toBe(4);
    expect(r.err).toContain('The upload itself succeeded');
    expect(r.err).toContain('LIVE CHECK FAILED: HTTP 000');
    expect(r.calls.match(/^curl /gm)).toHaveLength(2);
    expect(existsSync(join(remote(), 'mobile.html'))).toBe(true);
  });

  it('fails the live check when a script is not served with its bytes', () => {
    const r = deploy([], { FAKE_CORRUPT: 'index-abc.js' });
    expect(r.status).toBe(4);
    expect(r.err).toContain('LIVE CHECK FAILED: assets/index-abc.js is served with different bytes');
  });

  it('fails the live check when the page is served with the sandboxed CSP', () => {
    const r = deploy([], { FAKE_CSP: "sandbox allow-scripts; default-src 'self'" });
    expect(r.status).toBe(4);
    expect(r.err).toContain('sandboxed CSP');
  });
});
