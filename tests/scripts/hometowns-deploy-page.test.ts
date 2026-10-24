// scripts/hometowns/deploy-page.sh against a throwaway repository and a fake
// VPS: ssh, rsync and curl are stand-ins on PATH that act on a temp folder,
// so nothing here touches the network or a real host.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeEngineHash, generatedSource } from '../../scripts/hometowns/engine-hash.mjs';

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
file="$VPS_DIR/data/jkai-projects/\${url#https://site.test/projects/}"
if [[ -f "$file" ]]; then
  printf 'HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nContent-Security-Policy: %s\\r\\n\\r\\n' "\${FAKE_CSP:-default-src 'self'}" > "$hdr"
  cp "$file" "$out"; printf 200
else
  printf 'HTTP/1.1 404 Not Found\\r\\n\\r\\n' > "$hdr"; : > "$out"; printf 404
fi
`,
  npm: `#!/bin/bash
echo "npm $*" >> "$FAKE_LOG"
exit 99
`,
};

let dir: string;
let repo: string;
let vps: string;
let hash: string;
const engine = () => join(repo, 'src/lib/games/hometowns/engine');
const remote = (h = hash) => join(vps, 'data/jkai-projects/hometowns', h);
const git = (...args: string[]) =>
  spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });

function page(h: string, marker = h) {
  const d = join(repo, 'games/hometowns-view/dist', h);
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(join(d, 'mobile.html'), `<!doctype html><head><meta name="hometowns-engine-hash" content="${marker}"></head>\n`);
  writeFileSync(join(d, 'assets/index-abc.js'), `const ENGINE_HASH = '${h}';\n`);
}

function deploy(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [join(repo, 'scripts/hometowns/deploy-page.sh'), '--no-build', ...args], {
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
  for (const f of ['deploy-page.sh', 'engine-hash.mjs']) cpSync(join('scripts/hometowns', f), join(repo, 'scripts/hometowns', f));
  mkdirSync(engine(), { recursive: true });
  writeFileSync(join(engine(), 'rules.ts'), 'export const RULES = 1;\n');
  hash = computeEngineHash(engine());
  writeFileSync(join(engine(), 'engine-hash.generated.ts'), generatedSource(hash));
  mkdirSync(join(repo, 'games/hometowns-view'), { recursive: true });
  writeFileSync(join(repo, 'games/hometowns-view/.gitignore'), 'dist/\n');
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  page(hash);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('deploy-page.sh refuses before it reaches the VPS', () => {
  it('refuses a stale ENGINE_HASH', () => {
    writeFileSync(join(engine(), 'rules.ts'), 'export const RULES = 2;\n');
    git('commit', '-qam', 'engine change without a new hash');
    const r = deploy([]);
    expect(r.status).toBe(2);
    expect(r.err).toContain('stale');
    expect(r.calls).toBe('');
  });

  it('refuses an uncommitted engine change', () => {
    writeFileSync(join(engine(), 'extra.ts'), 'export const X = 1;\n');
    const r = deploy(['--dry-run']);
    expect(r.status).toBe(2);
    expect(r.err).toContain('uncommitted');
    expect(r.calls).toBe('');
  });

  it("refuses a build whose page names another hash", () => {
    page(hash, '0123456789abcdef');
    const r = deploy([]);
    expect(r.status).toBe(2);
    expect(r.err).toContain('0123456789abcdef');
    expect(r.calls).toBe('');
  });

  it('refuses a build folder for some other hash', () => {
    page('0123456789abcdef');
    const r = deploy(['--dist', join(repo, 'games/hometowns-view/dist/0123456789abcdef')]);
    expect(r.status).toBe(2);
    expect(r.err).toContain('not the current ENGINE_HASH');
  });
});

describe('deploy-page.sh on the VPS', () => {
  it('prints the copy on a dry run and writes nothing', () => {
    const r = deploy(['--dry-run']);
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
    expect(first.out).toContain(`Live: 200 text/html, first-party CSP, marker ${hash}`);
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

  it('refuses to overwrite a different build under the same hash', () => {
    mkdirSync(remote(), { recursive: true });
    writeFileSync(join(remote(), 'mobile.html'), 'someone else\'s build');
    const r = deploy([]);
    expect(r.status).toBe(3);
    expect(r.err).toContain('already exists with different contents');
    expect(r.calls).not.toMatch(/^rsync /m);
    expect(readFileSync(join(remote(), 'mobile.html'), 'utf8')).toBe('someone else\'s build');
  });

  it('fails the live check when the page is served with the sandboxed CSP', () => {
    const r = deploy([], { FAKE_CSP: "sandbox allow-scripts; default-src 'self'" });
    expect(r.status).toBe(4);
    expect(r.err).toContain('sandboxed CSP');
  });
});
