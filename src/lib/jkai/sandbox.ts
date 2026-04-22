import { exec } from 'child_process';
import { mkdirSync } from 'fs';
import os from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'jkai-sandbox';
const IMAGE_NAME = 'jkai-sandbox:latest';

const SCRAPER_PROFILES_HOST = join(os.homedir(), '.openclaw', 'scraper-profiles');

export interface SandboxStatus {
  running: boolean;
  containerId?: string;
  image?: string;
  uptime?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// --- Container Management ---

export async function getSandboxStatus(): Promise<SandboxStatus> {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format '{{.State.Running}}|{{.Id}}|{{.Config.Image}}|{{.State.StartedAt}}' ${CONTAINER_NAME} 2>/dev/null`,
    );
    const [running, id, image, startedAt] = stdout.trim().split('|');
    if (running === 'true') {
      const started = new Date(startedAt);
      const uptime = formatUptime(Date.now() - started.getTime());
      return { running: true, containerId: id.slice(0, 12), image, uptime };
    }
    return { running: false, containerId: id.slice(0, 12), image };
  } catch {
    return { running: false };
  }
}

export async function ensureSandboxRunning(): Promise<void> {
  // Verify-then-fix: trust nothing, always re-inspect before every launch.
  const status = await getSandboxStatus();
  if (status.running) return;

  try {
    await execAsync(`docker image inspect ${IMAGE_NAME} 2>/dev/null`);
  } catch {
    await buildSandboxImage();
  }

  await execAsync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`).catch(() => {});

  mkdirSync(SCRAPER_PROFILES_HOST, { recursive: true });

  await execAsync(
    `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped ` +
    `--memory 2g --cpus 2 ` +
    `--network bridge -v jkai-workspace:/home/jkai/workspace ` +
    `-v ${SCRAPER_PROFILES_HOST}:/home/jkai/scraper-profiles ${IMAGE_NAME}`,
  );
  clearContainerIpCache();

  // Post-condition check: make sure the container actually came up. A failed
  // `docker run` can succeed at the CLI level but leave the container stopped
  // (e.g. bad image, port conflict). Don't let callers proceed into a dead pipe.
  const after = await getSandboxStatus();
  if (!after.running) {
    throw new Error(
      `Sandbox container ${CONTAINER_NAME} failed to start after docker run`,
    );
  }
}

export async function buildSandboxImage(): Promise<void> {
  const { join } = await import('path');
  const dockerfilePath = join(process.cwd(), 'docker', 'jkai-sandbox');
  await execAsync(`docker build -t ${IMAGE_NAME} ${dockerfilePath}`, { timeout: 300000 });
}

// --- Container IP ---

let cachedContainerIp: string | null = null;

export async function getContainerIp(): Promise<string> {
  if (cachedContainerIp) return cachedContainerIp;
  const { stdout } = await execAsync(
    `docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CONTAINER_NAME}`,
  );
  cachedContainerIp = stdout.trim();
  return cachedContainerIp;
}

export function clearContainerIpCache(): void {
  cachedContainerIp = null;
}

// --- Code Execution ---

export async function execInSandbox(
  command: string,
  timeout = 120000,
): Promise<ExecResult> {
  try {
    // Base64-encode the command to preserve newlines and special characters
    const b64 = Buffer.from(command).toString('base64');
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER_NAME} bash -c "echo '${b64}' | base64 -d > /tmp/jkai-exec.sh && bash /tmp/jkai-exec.sh"`,
      { timeout, maxBuffer: 5 * 1024 * 1024 },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
    };
  }
}

export async function execInSandboxChecked(
  command: string,
  timeout = 120000,
): Promise<ExecResult> {
  const result = await execInSandbox(command, timeout);
  // Detect container-level failures vs normal command failures
  if (result.exitCode !== 0 && (
    result.stderr.includes('No such container') ||
    result.stderr.includes('is not running') ||
    result.stderr.includes('Cannot connect to the Docker daemon')
  )) {
    // Container is dead — try to restart it
    console.error('[jkai] Container appears dead, attempting restart...');
    clearContainerIpCache();
    await ensureSandboxRunning();
    // Retry the command once
    return execInSandbox(command, timeout);
  }
  return result;
}

export async function execBuildCommand(
  command: string,
  workdir: string,
): Promise<ExecResult> {
  return execInSandbox(`cd ${workdir} && ${command}`, 300000);
}

// --- Workspace Management ---

export async function writeFileInSandbox(
  filePath: string,
  content: string,
  timeout = 30000,
): Promise<ExecResult> {
  // Use base64 encoding to safely pass any content through bash
  const b64 = Buffer.from(content).toString('base64');
  return execInSandbox(
    `echo '${b64}' | base64 -d > ${filePath}`,
    timeout,
  );
}

export async function ensureWorkspace(buildId: string): Promise<string> {
  const base = `/home/jkai/workspace/${buildId}`;
  await execInSandbox(`mkdir -p ${base}/dev ${base}/live`);
  return `${base}/dev`;
}

export async function listWorkspaceFiles(buildId: string): Promise<string> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  const result = await execInSandbox(
    `find ${dir} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100 | sed 's|${dir}/||'`,
    10000,
  );
  return result.exitCode === 0 ? result.stdout.trim() : '';
}

// --- Port Allocation ---

const PORT_RANGE_START = 8000;
const PORT_RANGE_END = 8999;

/**
 * Deterministic port per build in the 8000-8999 range.
 * Hash the build ID so the same build always gets the same port — avoids
 * races and makes restarts idempotent. Collisions between different builds
 * are resolved by scanning for a free port nearby.
 */
export async function allocatePort(buildId: string): Promise<number> {
  let hash = 0;
  for (let i = 0; i < buildId.length; i++) {
    hash = (hash * 31 + buildId.charCodeAt(i)) | 0;
  }
  const base = PORT_RANGE_START + (Math.abs(hash) % (PORT_RANGE_END - PORT_RANGE_START));

  // Probe successive ports; pick the first one not currently bound inside the sandbox.
  // Read /proc/net/tcp directly (no ss/netstat dependency) — entries have hex-encoded
  // local_port in column 2, e.g. "0100007F:1F40" = 127.0.0.1:8000.
  const probeResult = await execInSandbox(
    `awk 'NR>1 { split($2,a,":"); print strtonum("0x"a[2]) }' /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u`,
    5000,
  );
  const busy = new Set<number>(
    probeResult.stdout.split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)),
  );
  for (let offset = 0; offset < 200; offset++) {
    const port = PORT_RANGE_START + ((base - PORT_RANGE_START + offset) % (PORT_RANGE_END - PORT_RANGE_START));
    if (!busy.has(port)) return port;
  }
  return base;
}

// --- Serve Management ---

export async function readServeJson(buildId: string): Promise<any | null> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  const result = await execInSandbox(`cat ${dir}/serve.json 2>/dev/null`, 5000);
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Kill the server owned by `buildId` (tracked via per-build pid file).
 * If called with no buildId, falls back to the legacy global pid file for
 * backwards compatibility with already-running single-build sandboxes.
 */
export async function killProjectServer(buildId?: string): Promise<void> {
  const pidFile = buildId ? `/tmp/jkai-serve-${buildId}.pid` : '/tmp/jkai-serve.pid';
  await execInSandbox(
    `if [ -f ${pidFile} ]; then kill $(cat ${pidFile}) 2>/dev/null; rm -f ${pidFile}; fi`,
    5000,
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
}

export async function startProjectServer(
  buildId: string,
  startCommand: string,
  port: number,
  healthCheck: string,
): Promise<boolean> {
  await killProjectServer(buildId);

  const dir = `/home/jkai/workspace/${buildId}/live`;
  const pidFile = `/tmp/jkai-serve-${buildId}.pid`;
  const logFile = `/tmp/jkai-serve-${buildId}.log`;
  await execInSandbox(
    `cd ${dir} && nohup bash -c '${startCommand.replace(/'/g, "'\\''")}' > ${logFile} 2>&1 & echo $! > ${pidFile}`,
    10000,
  );

  const maxAttempts = 60; // 120 seconds total — npm run dev / framework boots can be slow
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await execInSandbox(
      `curl -sf http://localhost:${port}${healthCheck} > /dev/null 2>&1 && echo OK`,
      5000,
    );
    if (check.stdout.trim() === 'OK') return true;
  }
  return false;
}

// --- Dev/Live Workspace Management ---

export async function promoteDevToLive(buildId: string): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  // Clear live (except node_modules) then copy dev contents
  await execInSandbox(
    `find ${base}/live -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null; cp -a ${base}/dev/. ${base}/live/ 2>/dev/null; echo done`,
    120000,
  );
}

export async function seedDevFromLive(buildId: string): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  const liveCheck = await execInSandbox(`ls ${base}/live/ 2>/dev/null | head -1`, 5000);
  if (liveCheck.stdout.trim()) {
    await execInSandbox(
      `find ${base}/dev -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null; cp -a ${base}/live/. ${base}/dev/ 2>/dev/null; echo done`,
      120000,
    );
  }
}

// --- Iteration Snapshots ---

export async function snapshotIteration(buildId: string, iterationNumber: number): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  const snapDir = `${base}/snapshots/${iterationNumber}`;
  await execInSandbox(`rm -rf ${snapDir} && mkdir -p ${snapDir}`, 5000);
  // Copy dev to snapshot, excluding node_modules and .git for space
  await execInSandbox(
    `cd ${base}/dev && find . -maxdepth 1 ! -name node_modules ! -name .git ! -name . -exec cp -a {} ${snapDir}/ \\;`,
    60000,
  );
}

export async function activateSnapshot(
  buildId: string,
  iterationNumber: number,
  startCommand: string,
  port: number,
  healthCheck: string,
): Promise<boolean> {
  const base = `/home/jkai/workspace/${buildId}`;
  const snapDir = `${base}/snapshots/${iterationNumber}`;

  // Check snapshot exists
  const check = await execInSandbox(`test -d ${snapDir} && echo OK`, 5000);
  if (check.stdout.trim() !== 'OK') return false;

  // Copy snapshot to live (keep node_modules in live)
  await execInSandbox(
    `find ${base}/live -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null; cp -a ${snapDir}/. ${base}/live/ 2>/dev/null; echo done`,
    120000,
  );

  // Restart server from live (kill only this build's process)
  await killProjectServer(buildId);
  return startProjectServer(buildId, startCommand, port, healthCheck);
}

export async function listSnapshots(buildId: string): Promise<number[]> {
  const base = `/home/jkai/workspace/${buildId}`;
  const result = await execInSandbox(
    `ls -1 ${base}/snapshots/ 2>/dev/null | sort -n`,
    5000,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split('\n').map(Number).filter(n => !isNaN(n));
}

// --- Publishing (copy live files out of sandbox to local filesystem + VPS) ---

const PUBLISHED_DIR = `${process.cwd()}/data/jkai-projects`;

const VPS_HOST = '157.180.19.38';
const VPS_USER = 'johnk';
const VPS_KEY = `${process.env.HOME}/.ssh/id_ed25519`;
const VPS_PUBLISHED_DIR = '/opt/strange-rambling-svelte/data/jkai-projects';

function isRunningOnVps(): boolean {
  // If the published dir is already the VPS path, we're on the VPS
  return PUBLISHED_DIR === VPS_PUBLISHED_DIR;
}

async function syncToVps(localDir: string, slug: string): Promise<void> {
  if (isRunningOnVps()) return; // Already on VPS, files are in place
  try {
    await execAsync(
      `ssh -i ${VPS_KEY} ${VPS_USER}@${VPS_HOST} "mkdir -p ${VPS_PUBLISHED_DIR}/${slug}"`,
      { timeout: 10000 },
    );
    await execAsync(
      `rsync -avz --delete -e "ssh -i ${VPS_KEY}" ${localDir}/ ${VPS_USER}@${VPS_HOST}:${VPS_PUBLISHED_DIR}/${slug}/`,
      { timeout: 120000 },
    );
  } catch (err) {
    console.error('[jkai] VPS sync failed (non-fatal):', err);
  }
}

async function removeFromVps(slug: string): Promise<void> {
  if (isRunningOnVps()) return;
  try {
    await execAsync(
      `ssh -i ${VPS_KEY} ${VPS_USER}@${VPS_HOST} "rm -rf ${VPS_PUBLISHED_DIR}/${slug}"`,
      { timeout: 10000 },
    );
  } catch (err) {
    console.error('[jkai] VPS remove failed (non-fatal):', err);
  }
}

/**
 * Inject a <base href> into index.html so relative asset/data paths resolve correctly
 * when served from /projects/jkai/{slug}/
 */
async function injectBaseHref(destDir: string, slug: string): Promise<void> {
  const { readFileSync, writeFileSync, existsSync } = await import('fs');
  const indexPath = `${destDir}/index.html`;
  if (!existsSync(indexPath)) return;

  let html = readFileSync(indexPath, 'utf-8');
  const baseTag = `<base href="/projects/jkai/${slug}/">`;

  // Don't double-inject
  if (html.includes('<base href=')) return;

  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${baseTag}`);
  } else if (html.includes('<head ')) {
    html = html.replace(/<head([^>]*)>/, `<head$1>${baseTag}`);
  } else if (html.includes('<html')) {
    html = html.replace(/<html([^>]*)>/, `<html$1><head>${baseTag}</head>`);
  } else {
    html = baseTag + html;
  }

  writeFileSync(indexPath, html);
}

export async function publishBuild(buildId: string, slug: string): Promise<string> {
  const { mkdirSync, rmSync, existsSync } = await import('fs');
  const destDir = `${PUBLISHED_DIR}/${slug}`;
  const liveDir = `/home/jkai/workspace/${buildId}/live`;

  // Try to produce a static build inside the sandbox first
  // Check for package.json with a build script
  const hasBuildScript = await execInSandbox(
    `cd ${liveDir} && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null`,
    5000,
  );

  if (hasBuildScript.exitCode === 0) {
    // Install deps if needed and run build
    await execInSandbox(`cd ${liveDir} && npm install --prefer-offline 2>&1 | tail -3`, 120000);
    const buildResult = await execInSandbox(`cd ${liveDir} && npm run build 2>&1 | tail -20`, 120000);

    if (buildResult.exitCode === 0) {
      // Check for common build output directories
      const distCheck = await execInSandbox(
        `cd ${liveDir} && for d in dist build public/build out .next/static; do [ -d "$d" ] && echo "$d" && break; done`,
        5000,
      );
      if (distCheck.stdout.trim()) {
        // Copy build output instead of full source
        rmSync(destDir, { recursive: true, force: true });
        mkdirSync(destDir, { recursive: true });
        const buildDir = `${liveDir}/${distCheck.stdout.trim()}`;
        await execAsync(`docker cp ${CONTAINER_NAME}:${buildDir}/. ${destDir}/`, { timeout: 120000 });
        // Also copy index.html from root if the build dir doesn't have one
        if (!existsSync(`${destDir}/index.html`)) {
          await execAsync(
            `docker cp ${CONTAINER_NAME}:${liveDir}/index.html ${destDir}/ 2>/dev/null`,
            { timeout: 10000 },
          ).catch(() => {});
        }
        await injectBaseHref(destDir, slug);
        await syncToVps(destDir, slug);
        return destDir;
      }
    }
    // Build failed or no dist dir — fall through to full copy
  }

  // For Python projects with templates/static dirs, try to grab those specifically
  const hasPythonTemplates = await execInSandbox(
    `test -d ${liveDir}/templates -o -d ${liveDir}/static && echo YES`,
    5000,
  );

  // Full copy — the project is either static already or we can't easily extract just the frontend
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  await execAsync(`docker cp ${CONTAINER_NAME}:${liveDir}/. ${destDir}/`, { timeout: 120000 });

  // Clean up server-side artifacts that won't work outside the sandbox
  rmSync(`${destDir}/node_modules`, { recursive: true, force: true });
  rmSync(`${destDir}/.git`, { recursive: true, force: true });
  rmSync(`${destDir}/__pycache__`, { recursive: true, force: true });
  rmSync(`${destDir}/.venv`, { recursive: true, force: true });

  // If it's a Python project with templates, restructure for static serving:
  // Move templates/index.html to root index.html if no root index exists
  if (hasPythonTemplates.stdout.trim() === 'YES' && !existsSync(`${destDir}/index.html`)) {
    const { readdirSync, copyFileSync } = await import('fs');
    const templatesDir = `${destDir}/templates`;
    if (existsSync(templatesDir)) {
      try {
        const templates = readdirSync(templatesDir);
        const index = templates.find(f => f === 'index.html' || f === 'base.html');
        if (index) copyFileSync(`${templatesDir}/${index}`, `${destDir}/index.html`);
      } catch {}
    }
  }

  await injectBaseHref(destDir, slug);
  await syncToVps(destDir, slug);
  return destDir;
}

export async function unpublishBuild(slug: string): Promise<void> {
  const { rmSync } = await import('fs');
  const destDir = `${PUBLISHED_DIR}/${slug}`;
  rmSync(destDir, { recursive: true, force: true });
  await removeFromVps(slug);
}

export function getPublishedDir(): string {
  return PUBLISHED_DIR;
}

// --- Utilities ---

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
