// Read/write the prompt stack that actually shapes /jkai chat replies.
//
// Since the Hermes cutover (JKAI_HERMES_CANVAS_CHAT=1), chat answers come from
// the Hermes runtime on homeserv, whose personality lives in ~/.hermes-jkai/*.md
// — NOT in this repo's data/prompts/*.md, which now only feed the canvas
// workflow builder. /jkai/prompts edited the second set while claiming to shape
// the first, so the page has been editing a prompt nobody reads since April.
//
// Host split mirrors the scraper's SCRAPER_SERVICE_URL pattern:
//   - on homeserv: read/write the files directly
//   - anywhere else (the VPS): proxy to homeserv's /api/jkai/prompts/hermes
//     over Tailscale, authenticated with the shared service token
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname } from 'os';
import { env } from '$env/dynamic/private';

export interface PromptFileEntry {
  name: string;
  content: string;
  size: number;
  lastModified: string;
}

/**
 * The files Hermes composes its system prompt from. Allowlisted: this is a
 * write path reached over the network, so no caller-supplied path ever touches
 * the filesystem.
 */
export const HERMES_PROMPT_FILES = ['SOUL.md', 'USER.md', 'MEMORY.md'] as const;
export type HermesPromptFile = (typeof HERMES_PROMPT_FILES)[number];

export function isHermesPromptFile(name: string): name is HermesPromptFile {
  return (HERMES_PROMPT_FILES as readonly string[]).includes(name);
}

function hermesDir(): string {
  return env.HERMES_CONFIG_DIR || join(homedir(), '.hermes-jkai');
}

function isOnHomeserv(): boolean {
  return hostname() === 'homeserv' || env.HERMES_PROMPTS_LOCAL === '1';
}

function proxyBase(): string | null {
  const url = env.HOMESERV_SITE_URL || env.SCRAPER_SERVICE_URL?.replace(/\/api\/scraper\/run\/?$/, '');
  return url ? url.replace(/\/+$/, '') : null;
}

async function proxy(method: 'GET' | 'PUT', body?: unknown): Promise<Response> {
  const base = proxyBase();
  if (!base) {
    throw new Error(
      'Hermes prompts live on homeserv; set HOMESERV_SITE_URL (e.g. http://homeserv.tail668b8c.ts.net:5173) so this host can reach them.',
    );
  }
  const token = env.SCRAPER_SERVICE_TOKEN;
  return fetch(`${base}/api/jkai/prompts/hermes`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

/** Read the Hermes prompt files, locally or via homeserv. Missing files are reported empty. */
export async function listHermesPrompts(): Promise<PromptFileEntry[]> {
  if (!isOnHomeserv()) {
    const res = await proxy('GET');
    if (!res.ok) {
      throw new Error(`homeserv prompt read failed (HTTP ${res.status})`);
    }
    const body = (await res.json()) as { files?: PromptFileEntry[] };
    return body.files ?? [];
  }
  return readHermesPromptsLocal();
}

/** Direct filesystem read — only valid on homeserv. */
export function readHermesPromptsLocal(): PromptFileEntry[] {
  const dir = hermesDir();
  return HERMES_PROMPT_FILES.map((name) => {
    const path = join(dir, name);
    if (!existsSync(path)) {
      return { name, content: '', size: 0, lastModified: new Date(0).toISOString() };
    }
    const stat = statSync(path);
    return {
      name,
      content: readFileSync(path, 'utf-8'),
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
    };
  });
}

/** Write one Hermes prompt file, locally or via homeserv. */
export async function saveHermesPrompt(name: string, content: string): Promise<void> {
  if (!isHermesPromptFile(name)) throw new Error(`unknown Hermes prompt file: ${name}`);
  if (!isOnHomeserv()) {
    const res = await proxy('PUT', { name, content });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`homeserv prompt write failed (HTTP ${res.status}) ${detail.slice(0, 200)}`);
    }
    return;
  }
  saveHermesPromptLocal(name, content);
}

/** Direct filesystem write — only valid on homeserv. */
export function saveHermesPromptLocal(name: HermesPromptFile, content: string): void {
  const path = join(hermesDir(), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

/** True when this host can reach the Hermes prompt stack at all. */
export function hermesPromptsReachable(): boolean {
  return isOnHomeserv() || proxyBase() !== null;
}
