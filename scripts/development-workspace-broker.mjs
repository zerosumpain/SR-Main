/** Trusted local broker. Docker points exclusively at the isolated DinD daemon. */
import http from 'node:http';
import { previewPlan, readPreviewManifest } from './development-preview-check.mjs';
import { previewAccessUrl } from './development-preview-access.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat, realpath, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, createHash } from 'node:crypto';
const exec = promisify(execFile);
const activeBrokerHash = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const root = process.env.BUILDER_WORKSPACES_ROOT ?? '/home/jkai/workspace';
const source = process.env.BUILDER_SOURCE_ROOT ?? '/source';
const token = process.env.BUILDER_WORKSPACE_BROKER_TOKEN;
if (!token || !process.env.DOCKER_HOST) throw new Error('Broker token and isolated DOCKER_HOST are required');
const operation = new AsyncLocalStorage();
const failure = (message, kind = 'infrastructure') => Object.assign(new Error(message), { kind });
const command = async (file, args, options = {}) => {
  const remaining = (operation.getStore()?.deadline ?? Date.now() + 600_000) - Date.now();
  if (remaining <= 0) throw failure('Executor operation deadline reached; saved work is retained.', 'deadline');
  const started = Date.now();
  try { return (await exec(file, args, { timeout: Math.min(600_000, remaining), maxBuffer: 8 * 1024 * 1024, ...options })).stdout.trim(); }
  catch (error) { if (error.killed) throw failure('Executor command exceeded its deadline; saved work is retained.', 'deadline'); throw error; }
  finally {
    const timings = operation.getStore()?.timings;
    if (timings) {
      const commandText = args.join(' ');
      const phase = /svelte-check/.test(commandText) ? 'types' : /vitest/.test(commandText) ? 'tests' : /development-preview-check/.test(commandText) ? 'browser' : /gate:build|npm run build$/.test(commandText) ? 'build' : /build:release-sidecars/.test(commandText) ? 'sidecars' : 'setup';
      timings[phase] = (timings[phase] ?? 0) + Date.now() - started;
    }
  }
};
const git = (cwd, ...args) => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', `safe.directory=${cwd}`, '-c', 'user.name=SR local builder', '-c', 'user.email=builder@example.test', '-C', cwd, ...args]);
const docker = (...args) => command('docker', args);
const validId = (id) => { if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid build id'); return id; };
const excluded = ['.env', '.env.*', 'keys.json', 'node_modules', '.svelte-kit', '/build', '.git', '/data', '.pi', '/sessions'];
async function copySource(from, to, removeMissing = false) {
  await mkdir(to, { recursive: true });
  await command('rsync', ['-a', '--safe-links', ...(removeMissing ? ['--delete'] : []), ...excluded.map((p) => `--exclude=${p}`), `${from}/`, `${to}/`]);
  // Authored prompts, skills and voice material are source. Other data is runtime and stays out.
  for (const folder of ['prompts', 'skills', 'voice']) {
    if (await stat(join(from, 'data', folder)).catch(() => null)) {
      if (await realpath(join(from, 'data', folder)) !== join(await realpath(from), 'data', folder)) throw new Error('Authored data directories must not be symlinks.');
      await mkdir(join(to, 'data', folder), { recursive: true });
      await command('rsync', ['-a', '--safe-links', ...(removeMissing ? ['--delete'] : []), `${from}/data/${folder}/`, `${to}/data/${folder}/`]);
    }
  }
}
const trustedRoot = '/var/lib/development-broker';
await mkdir(trustedRoot, { recursive: true });
// The worker can write its own attempt, but cannot replace sibling roots.
if (process.env.BUILDER_PROTECT_WORKSPACES !== '0') {
  await command('chown', ['0:0', root]);
  await command('chmod', ['755', root]);
}
// Production keeps the existing service-owned root for legacy build compatibility.
const previewLink = (id, revision, port) => process.env.BUILDER_PREVIEW_DOMAIN
  ? previewAccessUrl(process.env.BUILDER_PREVIEW_ACCESS_SECRET, process.env.BUILDER_PREVIEW_DOMAIN, id, revision, port)
  : `${process.env.BUILDER_PREVIEW_ORIGIN ?? 'http://127.0.0.1'}:${port}`;
async function ensureRuntimeImage() {
  const image = 'sr-development-preview:v4';
  if (!(await docker('image', 'inspect', image).then(() => true, () => false))) {
    const imageRoot = join(trustedRoot, 'preview-image');
    await mkdir(imageRoot, { recursive: true });
    await writeFile(join(imageRoot, 'Dockerfile'), 'FROM node:22.23.2-bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends git python3 bubblewrap chromium && rm -rf /var/lib/apt/lists/*\nRUN mkdir -p /workspace && chown 1000:1000 /workspace\nUSER 1000:1000\nWORKDIR /workspace\n');
    await docker('build', '-t', image, imageRoot);
  }
}
async function preflight(id) {
  await docker('info', '--format', '{{.ServerVersion}}');
  await ensureRuntimeImage();
  await docker('image', 'inspect', 'pgvector/pgvector:pg16');
  const ports = await docker('ps', '--format', '{{.Ports}}');
  if (Array.from({ length: 8 }, (_, i) => 5281 + i).every(p => ports.includes(`:${p}->`))) throw failure('All eight preview slots are occupied. Close a preview before building.');
  const name = `sr-preflight-${id}`;
  try {
    await docker('run', '--rm', '--name', name, '--network', 'none', '--memory', '256m', '--pids-limit', '64',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--security-opt', `seccomp=${source}/scripts/development-seccomp.json`, '--security-opt', 'systempaths=unconfined',
      'sr-development-preview:v4', 'bwrap', '--unshare-all', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--', '/usr/local/bin/node', '-e', 'process.exit(0)');
    return { ready: true };
  } finally { await exec('docker', ['rm', '-f', name], { timeout: 10_000 }).catch(() => {}); }
}
async function runtimeFingerprint() {
  const hash = createHash('sha256').update(activeBrokerHash);
  for (const file of ['scripts/development-workspace-broker.mjs', 'scripts/development-preview-check.mjs', 'scripts/development-seccomp.json', 'scripts/local-preview-proxy.mjs', 'scripts/local-preview-ingress.mjs', 'package-lock.json']) hash.update(await readFile(join(source, file)));
  hash.update(await docker('image', 'inspect', 'sr-development-preview:v4', 'pgvector/pgvector:pg16', '--format', '{{.Id}}'));
  return hash.digest('hex');
}
async function allocate(id) {
  const base = join(root, id);
  await mkdir(base, { recursive: true });
  if (await realpath(base) !== base) throw new Error('Workspace must not be a symlink');
  await command('chown', ['1000:1000', base]);
  return { allocated: true };
}
const batch = join(trustedRoot, 'batch');
async function ensureBatch() {
  if (!(await stat(join(batch, '.git')).catch(() => null))) {
    await copySource(source, batch);
    await git(batch, 'init', '-b', 'local-batch');
    await git(batch, 'add', '.');
    await git(batch, 'commit', '-m', 'Snapshot cumulative local development');
  }
  // Bring later completed checkout work forward without discarding accepted
  // features. A conflict pauses preparation and leaves the previous batch intact.
  const mirror = join(trustedRoot, 'source');
  if (!(await stat(join(mirror, '.git')).catch(() => null))) {
    await command('git', ['clone', '--no-hardlinks', batch, mirror]);
    await git(mirror, 'remote', 'remove', 'origin');
  }
  await copySource(source, mirror, true);
  await git(mirror, 'add', '--all');
  if (await git(mirror, 'diff', '--cached', '--name-only')) await git(mirror, 'commit', '-m', 'Refresh cumulative checkout snapshot');
  const sourceRevision = await git(mirror, 'rev-parse', 'HEAD');
  await git(batch, 'fetch', mirror, sourceRevision);
  try { await git(batch, 'merge', '--no-edit', sourceRevision); }
  catch { await git(batch, 'merge', '--abort').catch(() => {}); throw new Error('New checkout work conflicts with the accepted local batch. Resolve the isolated batch before preparing another feature.'); }
}

async function workspace(id) {
  const path = join(root, id, 'dev');
  const resolved = await realpath(path);
  if (resolved !== path) throw new Error('Workspace must not be a symlink');
  if (await realpath(join(path, '.git')) !== join(path, '.git')) throw new Error('Unsafe git directory');
  for (const entry of ['commondir', 'objects/info/alternates']) {
    if (await stat(join(path, '.git', entry)).catch(() => null)) throw new Error('External git object directories are not permitted');
  }
  const config = await readFile(join(path, '.git/config'), 'utf8');
  for (const line of config.split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (!/^(\[core\]|\[user\]|repositoryformatversion\s*=\s*0|filemode\s*=\s*(true|false)|bare\s*=\s*false|logallrefupdates\s*=\s*true|name\s*=.*|email\s*=.*)$/.test(line)) throw new Error('Untrusted repository configuration; restore the original local git configuration.');
  }
  return path;
}
async function ignoreWorkerFiles(path) {
  const file = join(path, '.git/info/exclude');
  const existing = await readFile(file, 'utf8').catch(() => '');
  if (!existing.split('\n').includes('/.pi/')) await writeFile(file, existing + '\n/.pi/\n');
}
async function prepare(id) {
  await ensureBatch();
  const path = join(root, id, 'dev');
  if (await stat(join(path, '.git')).catch(() => null)) { await workspace(id); await ignoreWorkerFiles(path); return { revision: await git(path, 'rev-parse', 'HEAD') }; }
  await mkdir(join(root, id), { recursive: true });
  await command('git', ['clone', '--no-hardlinks', batch, path]);
  await git(path, 'remote', 'remove', 'origin');
  await ignoreWorkerFiles(path);
  const base = await git(path, 'rev-parse', 'HEAD');
  await writeFile(join(trustedRoot, `${id}-base`), base);
  // Dependencies are copied, never symlinked to the cumulative checkout.
  await command('cp', ['-a', `${source}/node_modules`, `${path}/node_modules`]);
  await command('chown', ['-R', '1000:1000', join(root, id)]);
  return { revision: base };
}
async function snapshot(id) {
  const path = await workspace(id);
  await git(path, 'add', '--all');
  const changed = await git(path, 'diff', '--cached', '--name-only');
  if (changed) await git(path, 'commit', '-m', 'Local feature candidate');
  const revision = await git(path, 'rev-parse', 'HEAD');
  const base = await readFile(join(trustedRoot, `${id}-base`), 'utf8').catch(() => git(path, 'rev-list', '--max-parents=0', 'HEAD'));
  if (!/^[a-f0-9]{40}$/.test(base.trim())) throw new Error('Invalid base revision');
  return { revision, changes: { files: (await git(path, 'diff', '--name-only', base.trim(), revision, '--')).split('\n').filter(Boolean), patch: (await git(path, 'diff', '--no-ext-diff', '--no-textconv', base.trim(), revision, '--')).slice(0, 20000) } };
}
async function assertCandidate(id, revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid candidate revision');
  const path = await workspace(id);
  if (await git(path, 'rev-parse', 'HEAD') !== revision || await git(path, 'status', '--porcelain', '--untracked-files=normal')) {
    throw new Error('The workspace changed after verification; run the checks again.');
  }
  return path;
}
async function preview(id, revision, options = {}) {
  const required = Boolean(options.working || options.verify);
  const path = await assertCandidate(id, revision);
  let plan;
  try {
    const input = await readPreviewManifest(join(path, '.development-preview.json'));
    plan = previewPlan(input, options.routes ?? (!required && Array.isArray(input?.scenarios) ? input.scenarios.map(s => s.route) : []), required);
  } catch (error) { throw failure(error.message, 'feature'); }
  if (options.verify && !plan.complete) throw new Error('Complete the accepted brief before requesting release verification.');
  if (options.verify) await assertVerificationControls(path, id);
  return provisionPreview(id, revision, path, plan, options);
}
async function removeRuntime(name) {
  // Cleanup must still run after the operation's command deadline expires.
  for (const container of [`${name}-gateway`, name, `${name}-db`]) await exec('docker', ['rm', '-f', container], { timeout: 10_000 }).catch(() => {});
  await exec('docker', ['network', 'rm', `${name}-net`], { timeout: 10_000 }).catch(() => {});
}
async function provisionPreview(id, revision, path, plan, options) {
  const name = `sr-preview-${id}-${randomBytes(4).toString('hex')}`;
  const dbName = `${name}-db`;
  const gateway = `${name}-gateway`;
  const network = `${name}-net`;
  const credentials = randomBytes(24).toString('hex');
  const target = join(root, id, 'preview');
  const receiptFile = join(trustedRoot, `${id}-preview.json`);
  const old = JSON.parse(await readFile(receiptFile, 'utf8').catch(() => '{}'));
  await ensureRuntimeImage();
  const fingerprint = await runtimeFingerprint();
  if (!options.verify && old.fingerprint === fingerprint && old.revision === revision && old.url && old.port && old.runtimeVersion === 4 && JSON.stringify(old.plan) === JSON.stringify(plan)) {
    const healthy = await fetch(`http://${process.env.BUILDER_DOCKER_HOSTNAME ?? 'development-docker'}:${old.port}${plan.routes[0]}`, { headers: { host: `127.0.0.1:${old.port}` }, redirect: 'manual', signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
    if (healthy) {
      const url = previewLink(id, revision, old.port);
      await writeFile(receiptFile, JSON.stringify({ ...old, url }));
      return { revision, url, complete: plan.complete, evidence: old.evidence, detail: 'Retained working preview for this revision.' };
    }
  }
  // Build beside the visible snapshot. A failure or occupied staging slot leaves it intact.
  const ports = await docker('ps', '--format', '{{.Ports}}');
  const port = Array.from({ length: 8 }, (_, i) => 5281 + i).find(p => !ports.includes(`:${p}->`));
  if (!port) throw new Error('All eight preview slots are occupied; the previous working preview is retained. Close another preview to make room.');
  try {
  await docker('network', 'create', '--internal', network);
  await docker('run', '-d', '--name', dbName, '--network', network, '--memory', '512m',
    '-e', 'POSTGRES_USER=preview', '-e', `POSTGRES_PASSWORD=${credentials}`, '-e', 'POSTGRES_DB=preview', 'pgvector/pgvector:pg16');
  const image = 'sr-development-preview:v4';
  await docker('run', '-d', '--name', name, '--network', network, '--memory', '8g', '--cpus', '4', '--pids-limit', '256',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    // Nested Bubblewrap needs user namespaces and an unmasked /proc to mount its own.
    '--security-opt', `seccomp=${source}/scripts/development-seccomp.json`, '--security-opt', 'systempaths=unconfined',
    '-w', '/workspace',
    '-e', `DATABASE_URL=postgresql://preview:${credentials}@${dbName}:5432/preview`,
    '-e', 'NODE_OPTIONS=--max-old-space-size=6144', '-e', `PREVIEW_PARENT_ORIGIN=${process.env.BUILDER_PREVIEW_PARENT_ORIGIN ?? 'http://127.0.0.1:5275'}`, '-e', 'PORT=5276', '-e', 'HOST=127.0.0.1',
    '-e', 'AUTH_SECRET=isolated-preview-only', '-e', 'AUTH_TRUST_HOST=true', '-e', 'AUTH_ALLOWED_EMAILS=preview@example.test',
    '-e', 'PUBLIC_VAPID_PUBLIC_KEY=', '-e', `INTEGRATION_CREDENTIALS_KEY=${randomBytes(32).toString('hex')}`, '-e', 'JKAI_SERVICE_ROLE=builder',
    image, 'sleep', 'infinity');
  await docker('exec', name, 'bwrap', '--unshare-all', '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--', '/usr/local/bin/node', '-e', 'process.exit(0)');
  // Copy a fresh snapshot; never expose the worker, source tree or Docker socket.
  await command('rm', ['-rf', target]);
  await copySource(path, target);
  await docker('cp', '-a', `${target}/.`, `${name}:/workspace/`);
  await docker('cp', '-a', `${path}/.git`, `${name}:/workspace/.git`);
  await docker('cp', '-a', `${path}/node_modules`, `${name}:/workspace/node_modules`);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await docker('exec', dbName, 'pg_isready', '-U', 'preview').then(() => true, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await docker('exec', dbName, 'psql', '-U', 'preview', '-d', 'preview', '-c', 'CREATE EXTENSION IF NOT EXISTS vector');
  await docker('exec', name, 'npx', 'drizzle-kit', 'push', '--force');
  await docker('cp', `${source}/scripts/local-preview-proxy.mjs`, `${name}:/tmp/sr-preview-proxy.mjs`);
  if (options.verify) await verifyRuntime(id, name);
  else try { await docker('exec', name, 'npm', 'run', 'build'); } catch (error) { throw error.kind ? error : failure(`Feature build failed: ${(error.stderr || error.stdout || error.message).slice(-1600)}`, 'feature'); }
  await docker('exec', '-d', name, 'sh', '-c', 'node build > /tmp/site.log 2>&1');
  await docker('exec', '-d', name, 'node', '/tmp/sr-preview-proxy.mjs');
  await docker('run', '-d', '--name', gateway, '--user', '1000:1000', '--memory', '128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-p', `0.0.0.0:${port}:5275`, '-e', `PREVIEW_UPSTREAM=${name}`, 'node:22.23.2-bookworm-slim', 'sleep', 'infinity');
  await docker('network', 'connect', network, gateway);
  await docker('cp', `${source}/scripts/local-preview-ingress.mjs`, `${gateway}:/tmp/ingress.mjs`);
  await docker('exec', '-d', gateway, 'node', '/tmp/ingress.mjs');
  const internal = `http://${process.env.BUILDER_DOCKER_HOSTNAME ?? 'development-docker'}:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (Date.now() >= (operation.getStore()?.deadline ?? Infinity)) throw failure('Preview startup exceeded the operation deadline.', 'deadline');
    healthy = await fetch(`${internal}/jkai/develop`, { redirect: 'manual', headers: { host: `127.0.0.1:${port}` }, signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
    if (healthy) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!healthy) { const log = await docker('exec', name, 'cat', '/tmp/site.log').catch(() => 'No startup log'); throw new Error('Preview readiness failed: ' + log.slice(-1600)); }
  await writeFile(join(target, 'preview-plan.json'), JSON.stringify(plan));
  await docker('cp', `${target}/preview-plan.json`, `${name}:/tmp/preview-plan.json`);
  await docker('cp', `${source}/scripts/development-preview-check.mjs`, `${name}:/tmp/development-preview-check.mjs`);
  let evidence;
  try { evidence = JSON.parse(await docker('exec', name, 'node', '/tmp/development-preview-check.mjs')); }
  catch (error) { throw error.kind ? error : failure(`Feature browser check failed: ${(error.stderr || error.stdout || error.message).slice(-1600)}`, 'feature'); }
  await assertCandidate(id, revision);
  const url = previewLink(id, revision, port);
  const receipt = { revision, port, url, name, plan, evidence, proxyVersion: 2, runtimeVersion: 4, fingerprint, verified: options.verify === true };
  await writeFile(receiptFile + '.next', JSON.stringify(receipt));
  await rename(receiptFile + '.next', receiptFile);
  if (old.port) await removeRuntime(old.name ?? `sr-preview-${id}`);
  return { revision, url, complete: plan.complete, evidence, detail: `${options.verify ? 'Release candidate' : plan.scenarios.length ? 'Working preview' : 'Inspection preview'}: feature routes checked at desktop and phone widths. Synthetic database; live providers are not connected.` };
  } catch (error) { await removeRuntime(name); throw error; }
}
async function closePreview(id) {
  const receiptFile = join(trustedRoot, `${id}-preview.json`);
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8').catch(() => '{}'));
  await removeRuntime(receipt.name ?? `sr-preview-${id}`);
  await writeFile(receiptFile, '{}');
  return { closed: true };
}
async function verifyRuntime(id, container) {
  const verify = async (step, args, environment = []) => {
    const log = join(trustedRoot, `${id}-gate-${step}.log`);
    try { await writeFile(log, await docker('exec', ...environment, container, ...args)); }
    catch (error) {
      const output = `${error.stdout ?? ''}\n${error.stderr ?? error.message}`;
      await writeFile(log, output);
      throw failure(`${step} failed in isolated verification; full output retained in ${log}. ${output.replace(/\x1b\[[0-9;]*m/g, '').slice(-1600)}`, error.kind ?? 'feature');
    }
  };
  await verify('structural', ['bash', './scripts/gate-structural.sh']);
  await verify('sync', ['npm', 'run', 'gate:sync']);
  await verify('types', ['npx', '--no-install', 'svelte-check', '--tsconfig', './tsconfig.json', '--threshold', 'error']);
  await verify('tests', ['npx', '--no-install', 'vitest', 'run', '--exclude', '**/*.integration.test.ts', '--maxWorkers', '2'], ['-e', 'JKAI_SERVICE_ROLE=web']);
  await verify('build', ['npm', 'run', 'gate:build']);
  await verify('sidecars', ['npm', 'run', 'build:release-sidecars']);
  await verify('clean', ['git', 'diff', '--exit-code']);
}

async function assertVerificationControls(path, id) {
  // Later owner-authored harness updates merge forward without being mistaken
  // for worker edits: compare this attempt with its trusted original base.
  const base = (await readFile(join(trustedRoot, `${id}-base`), 'utf8')).trim();
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid verification base');
  const changed = (await git(path, 'diff', '--name-only', base, 'HEAD', '--')).split('\n');
  const control = changed.find((file) => /^(?:scripts\/(?:gate|check-)|(?:vitest|vite|svelte)\.config\.|tsconfig\.json$)/.test(file));
  if (control) throw new Error(`Verification control changed: ${control}. Review it in the cumulative checkout before batch acceptance.`);
  const trusted = JSON.parse(await git(batch, 'show', `${base}:package.json`));
  const candidate = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  if (JSON.stringify(trusted.scripts) !== JSON.stringify(candidate.scripts)) throw new Error('Build/test commands changed. Review them in the cumulative checkout before batch acceptance.');
}

async function accept(id, revision, routes) {
  const path = await assertCandidate(id, revision);
  const acceptedFile = join(trustedRoot, `${id}-accepted.json`);
  const accepted = JSON.parse(await readFile(acceptedFile, 'utf8').catch(() => '{}'));
  await ensureBatch();
  const previous = await git(batch, 'rev-parse', 'HEAD');
  if (accepted.revision === revision && accepted.batch === previous) return accepted;
  await assertVerificationControls(path, id);
  const trialId = `batch-${id}`;
  const trial = join(root, trialId, 'dev');
  const bundle = join(trustedRoot, `${id}-candidate.bundle`);
  try {
    // The accepted branch stays unchanged throughout merging and verification.
    // A controller crash therefore cannot promote an unverified candidate.
    if (!(await stat(join(trial, '.git')).catch(() => null))) {
      await mkdir(join(root, trialId), { recursive: true });
      await command('git', ['clone', '--no-hardlinks', batch, trial]);
      await git(trial, 'remote', 'remove', 'origin');
    } else {
      await git(trial, 'merge', '--abort').catch(() => {});
      await git(trial, 'fetch', batch, 'local-batch');
      await git(trial, 'reset', '--hard', 'FETCH_HEAD');
    }
    // Bundles avoid executing a Git transport in a differently-owned worker repo.
    await git(path, 'bundle', 'create', bundle, 'HEAD');
    await git(trial, 'fetch', bundle, 'HEAD');
    if (await git(trial, 'rev-parse', 'FETCH_HEAD') !== revision) throw new Error('Candidate changed while copying its git objects.');
    await git(trial, 'merge', '--no-edit', '--no-ff', revision);
    if (!(await stat(join(trial, 'node_modules')).catch(() => null))) await command('cp', ['-a', `${path}/node_modules`, `${trial}/node_modules`]);
    await command('chown', ['-R', '1000:1000', join(root, trialId)]);
    const merged = await git(trial, 'rev-parse', 'HEAD');
    const tested = await preview(trialId, merged, { routes });
    const container = JSON.parse(await readFile(join(trustedRoot, `${trialId}-preview.json`), 'utf8')).name;
    await verifyRuntime(id, container);
    await assertCandidate(trialId, merged);
    // Build tools rewrote generated files; reopen the tested production server.
    await docker('restart', container);
    await docker('exec', '-d', container, 'sh', '-c', 'node build > /tmp/site.log 2>&1');
    await docker('exec', '-d', container, 'node', '/tmp/sr-preview-proxy.mjs');
    if (await git(batch, 'rev-parse', 'HEAD') !== previous) throw new Error('The batch changed during verification; retry against its new base.');
    await git(trial, 'bundle', 'create', bundle, 'HEAD');
    await git(batch, 'fetch', bundle, 'HEAD');
    await git(batch, 'merge', '--ff-only', merged);
    const receipt = { batch: merged, revision, url: tested.url };
    await writeFile(join(trustedRoot, 'batch-preview.json'), JSON.stringify({ ...tested, revision: merged }));
    await writeFile(acceptedFile, JSON.stringify(receipt));
    return receipt;
  } catch (error) {
    await git(trial, 'merge', '--abort').catch(() => {});
    throw new Error(`Batch integration was not accepted: ${String(error.message).slice(-2000)}`);
  } finally { await command('rm', ['-f', bundle]).catch(() => {}); }
}

let lane = Promise.resolve();
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('{"ok":true}'); return; }
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(); return; }
  const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 32000) throw new Error('Request too large'); }
    const body = JSON.parse(raw);
    const id = validId(body.buildId);
    const methods = { '/preflight': () => preflight(id), '/allocate': () => allocate(id), '/prepare': () => prepare(id), '/snapshot': () => snapshot(id), '/preview': () => preview(id, body.revision, { routes: body.routes, working: body.working }), '/verify': () => preview(id, body.revision, { routes: body.routes, verify: true }), '/close-preview': () => closePreview(body.batch === true ? `batch-${id}` : id), '/accept': () => accept(id, body.revision, body.routes) };
    if (req.method !== 'POST' || !Object.hasOwn(methods, req.url)) { respond(404, { error: 'Unknown operation' }); return; }
    const deadline = Math.min(Number.isFinite(body.deadline) ? body.deadline : Infinity, Date.now() + (req.url === '/preflight' ? 110_000 : ['/accept', '/verify'].includes(req.url) ? 1_170_000 : 570_000));
    const timings = {};
    const requestedAt = Date.now();
    const work = lane.then(() => { timings.queue = Date.now() - requestedAt; return operation.run({ deadline, timings }, methods[req.url]); });
    lane = work.catch(() => {});
    respond(200, { ...await work, timings });
  } catch (error) { respond(400, { error: String(error.message).slice(-2000), kind: error.kind ?? 'infrastructure' }); }
}).listen(5280, '0.0.0.0');
