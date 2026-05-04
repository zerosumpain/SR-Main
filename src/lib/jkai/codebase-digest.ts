/**
 * Codebase digest — a per-iteration structured summary of the workspace
 * injected into the agent's prompt so it doesn't re-grep + re-read every
 * file on every iteration just to figure out where things are. Pre-fix,
 * each iteration burned 20-50 tool calls on rediscovery before any
 * productive edit.
 *
 * The digest is deterministic + cheap (~ms of disk I/O), so we run it
 * every iteration. Format aims for the smallest token cost that still
 * carries the file map + entry points + signatures the agent needs to
 * pick up where the last iteration left off.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const BUILDS_ROOT = process.env.JKAI_BUILDS_HOSTMODE === '1'
  ? '/home/jkai/workspace'
  : '/home/jkai/workspace';

const MAX_FILES = 60;
const MAX_FILE_BYTES = 200_000;
const MAX_SUMMARY_BYTES = 8_000;

interface FileEntry { path: string; size: number; mtime: number }

/** Tiny extractor for "what's in this file" — not a real parser, just a
 *  cheap regex pass that catches the things the agent typically needs to
 *  remember about a codebase. */
function summariseFile(path: string, content: string): string {
  const lines = content.split('\n');
  const lineCount = lines.length;
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const sigs: string[] = [];

  if (ext === '.js' || ext === '.ts' || ext === '.mjs' || ext === '.tsx' || ext === '.jsx') {
    for (const line of lines) {
      const m =
        line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ||
        line.match(/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/) ||
        line.match(/^\s*(?:export\s+)?const\s+([A-Z_][\w$]*)\s*=/) ||
        line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:const|let)\s+([a-z][\w$]*)\s*=\s*(?:async\s*)?\(/);
      if (m) sigs.push(m[1]);
      if (sigs.length >= 12) break;
    }
  } else if (ext === '.svelte') {
    const propMatch = content.match(/let\s*\{\s*([^}]+)\s*\}\s*[:=]\s*\$props/);
    if (propMatch) sigs.push(`props: ${propMatch[1].replace(/\s+/g, ' ').slice(0, 80)}`);
    const stateMatches = content.matchAll(/let\s+([a-z][\w$]*)\s*=\s*\$state/g);
    for (const m of stateMatches) {
      sigs.push(`$state ${m[1]}`);
      if (sigs.length >= 12) break;
    }
  } else if (ext === '.py') {
    for (const line of lines) {
      const m =
        line.match(/^\s*def\s+([A-Za-z_][\w]*)/) ||
        line.match(/^\s*class\s+([A-Za-z_][\w]*)/);
      if (m) sigs.push(m[1]);
      if (sigs.length >= 12) break;
    }
  } else if (ext === '.html') {
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) sigs.push(`<title> "${titleMatch[1].trim().slice(0, 60)}"`);
    const ids = Array.from(content.matchAll(/\sid\s*=\s*["']([^"']{1,40})["']/g)).slice(0, 6).map((m) => `#${m[1]}`);
    if (ids.length) sigs.push(`ids: ${ids.join(', ')}`);
    const scriptSrcs = Array.from(content.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)).slice(0, 4).map((m) => m[1]);
    if (scriptSrcs.length) sigs.push(`scripts: ${scriptSrcs.join(', ')}`);
  } else if (ext === '.css') {
    const selectorCount = (content.match(/^\s*[.#][\w-]+/gm) ?? []).length;
    const customProps = Array.from(content.matchAll(/--([\w-]+)\s*:/g)).slice(0, 8).map((m) => `--${m[1]}`);
    sigs.push(`${selectorCount} selectors`);
    if (customProps.length) sigs.push(`tokens: ${customProps.join(', ')}`);
  } else if (ext === '.json') {
    if (content.length < 1500) {
      try {
        const obj = JSON.parse(content);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          sigs.push(`keys: ${Object.keys(obj).slice(0, 10).join(', ')}`);
        }
      } catch { /* ignore parse error */ }
    }
  }

  const sigStr = sigs.length > 0 ? ` — ${sigs.join('; ')}` : '';
  return `${path} (${lineCount} lines)${sigStr}`;
}

/** Walk the workspace's listDevFiles output, read each candidate, summarise.
 *  Designed to be called every iteration before pi spawns. Cost: a few ms
 *  of disk I/O on a typical project. Returns a single markdown block to
 *  inject into the prompt. */
export async function buildCodebaseDigest(buildId: string, files: FileEntry[]): Promise<string> {
  if (files.length === 0) {
    return '## Codebase Digest\nEmpty workspace — fresh build.';
  }
  // Skip noisy / binary files. Pick the most-recently-modified first so we
  // describe the iteration's working set even if the project has ballooned
  // into a node_modules-ish tree.
  const candidates = files
    .filter((f) => !/node_modules|\.git|\.cache|\.venv|__pycache__|dist\/|build\/|\.next\/|\.svelte-kit/.test(f.path))
    .filter((f) => f.size <= MAX_FILE_BYTES)
    .filter((f) => /\.(js|ts|mjs|tsx|jsx|svelte|py|html|css|json|md|yml|yaml|sh)$/i.test(f.path))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_FILES);

  const root = `${BUILDS_ROOT}/${buildId}/dev`;
  const lines: string[] = ['## Codebase Digest'];
  lines.push(`Working tree (${candidates.length} relevant files; updated each iteration). You don't need to re-list or re-read these unless you're editing them — just refer to the digest. Read on demand for full content.`);
  lines.push('');

  let totalBytes = 0;
  for (const f of candidates) {
    try {
      const fullPath = join(root, f.path);
      const stt = await stat(fullPath).catch(() => null);
      if (!stt || !stt.isFile()) continue;
      const content = await readFile(fullPath, 'utf-8');
      const summary = summariseFile(f.path, content);
      lines.push(`- ${summary}`);
      totalBytes += summary.length;
      if (totalBytes > MAX_SUMMARY_BYTES) {
        lines.push(`- … (${candidates.length - lines.length + 2} more files truncated to keep the digest under 8 KB)`);
        break;
      }
    } catch { /* skip unreadable */ }
  }
  return lines.join('\n');
}
