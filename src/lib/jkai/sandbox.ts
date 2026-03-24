import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'jkai-sandbox';
const IMAGE_NAME = 'jkai-sandbox:latest';

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
  const status = await getSandboxStatus();
  if (status.running) return;

  try {
    await execAsync(`docker image inspect ${IMAGE_NAME} 2>/dev/null`);
  } catch {
    await buildSandboxImage();
  }

  await execAsync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`).catch(() => {});

  await execAsync(
    `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped ` +
    `--memory 2g --cpus 2 ` +
    `--network bridge -v jkai-workspace:/home/jkai/workspace ${IMAGE_NAME}`,
  );
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
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER_NAME} bash -c ${JSON.stringify(command)}`,
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

export async function execBuildCommand(
  command: string,
  workdir: string,
): Promise<ExecResult> {
  return execInSandbox(`cd ${workdir} && ${command}`, 300000);
}

// --- Workspace Management ---

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

export async function killProjectServer(): Promise<void> {
  await execInSandbox(
    'if [ -f /tmp/jkai-serve.pid ]; then kill $(cat /tmp/jkai-serve.pid) 2>/dev/null; rm -f /tmp/jkai-serve.pid; fi',
    5000,
  ).catch(() => {});
  await execInSandbox('pkill -f "node.*server" 2>/dev/null; pkill -f "python.*serve" 2>/dev/null', 5000).catch(() => {});
}

export async function startProjectServer(
  buildId: string,
  startCommand: string,
  port: number,
  healthCheck: string,
): Promise<boolean> {
  await killProjectServer();

  const dir = `/home/jkai/workspace/${buildId}/live`;
  await execInSandbox(
    `cd ${dir} && nohup bash -c '${startCommand.replace(/'/g, "'\\''")}' > /tmp/jkai-serve.log 2>&1 & echo $! > /tmp/jkai-serve.pid`,
    10000,
  );

  const maxAttempts = 15;
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
  // rsync dev to live, delete files in live that aren't in dev
  await execInSandbox(
    `rsync -a --delete --exclude='node_modules' --exclude='.git' ${base}/dev/ ${base}/live/`,
    60000,
  );
  // If node_modules exists in dev but not live, copy it too
  await execInSandbox(
    `if [ -d ${base}/dev/node_modules ] && [ ! -d ${base}/live/node_modules ]; then cp -r ${base}/dev/node_modules ${base}/live/node_modules; fi`,
    60000,
  ).catch(() => {});
}

export async function seedDevFromLive(buildId: string): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  // Only seed if live has content and dev is empty or doesn't exist
  const liveCheck = await execInSandbox(`ls ${base}/live/ 2>/dev/null | head -1`, 5000);
  if (liveCheck.stdout.trim()) {
    await execInSandbox(
      `rsync -a --delete ${base}/live/ ${base}/dev/`,
      60000,
    );
  }
}

// --- Iteration Snapshots ---

export async function snapshotIteration(buildId: string, iterationNumber: number): Promise<void> {
  const base = `/home/jkai/workspace/${buildId}`;
  const snapDir = `${base}/snapshots/${iterationNumber}`;
  await execInSandbox(`mkdir -p ${snapDir}`, 5000);
  await execInSandbox(
    `rsync -a --exclude='node_modules' --exclude='.git' ${base}/dev/ ${snapDir}/`,
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

  // Copy snapshot to live
  await execInSandbox(
    `rsync -a --delete --exclude='node_modules' --exclude='.git' ${snapDir}/ ${base}/live/`,
    60000,
  );
  // Copy node_modules if they exist in snapshot
  await execInSandbox(
    `if [ -d ${snapDir}/node_modules ]; then rsync -a ${snapDir}/node_modules/ ${base}/live/node_modules/; fi`,
    60000,
  ).catch(() => {});

  // Restart server from live
  await killProjectServer();
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
