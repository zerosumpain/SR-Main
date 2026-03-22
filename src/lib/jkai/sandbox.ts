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
  ports?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

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

export async function startSandbox(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Check if image exists, build if not
    try {
      await execAsync(`docker image inspect ${IMAGE_NAME} 2>/dev/null`);
    } catch {
      await buildSandboxImage();
    }

    // Remove existing container if stopped
    await execAsync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`).catch(() => {});

    await execAsync(
      `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped --network bridge -v jkai-workspace:/home/jkai/workspace ${IMAGE_NAME}`,
    );
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function stopSandbox(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execAsync(`docker stop ${CONTAINER_NAME}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function buildSandboxImage(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Look for Dockerfile relative to cwd (project root in dev, /opt/... in prod)
    const { join } = await import('path');
    const dockerfilePath = join(process.cwd(), 'docker', 'jkai-sandbox');
    await execAsync(`docker build -t ${IMAGE_NAME} ${dockerfilePath}`, { timeout: 300000 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function execInSandbox(
  command: string,
  timeout = 30000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER_NAME} bash -c ${JSON.stringify(command)}`,
      { timeout, maxBuffer: 1024 * 1024 },
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

export async function getDockerContainers(): Promise<
  Array<{
    name: string;
    image: string;
    status: string;
    ports: string;
    created: string;
  }>
> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format '{{json .}}' 2>/dev/null`,
    );
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const c = JSON.parse(line);
        return {
          name: c.Names,
          image: c.Image,
          status: c.Status,
          ports: c.Ports || '',
          created: c.CreatedAt,
        };
      });
  } catch {
    return [];
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
