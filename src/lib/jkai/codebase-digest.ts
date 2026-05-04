/**
 * Codebase digest — a per-iteration structured summary of the workspace
 * injected into the agent's prompt so it doesn't re-grep + re-read every
 * file on every iteration just to figure out where things are. Pre-fix,
 * each iteration burned 20-50 tool calls on rediscovery before any
 * productive edit.
 *
 * Plus change tracking — annotates [NEW] / [CHANGED] for files the most
 * recent iteration actually touched. Compares stat(size, mtime) against
 * the per-iteration snapshot directory (cp -a preserves mtimes, so a
 * file's stat tuple is a reliable identity proxy without the cost of
 * hashing).
 *
 * The digest is deterministic + cheap (~ms of disk I/O), so we run it
 * every iteration.
 */
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

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

/** Walk a directory recursively, return relative paths + size + mtime per
 *  file. Used to enumerate a snapshot for diff comparison. Bounded so a
 *  pathological directory can't blow up memory. */
async function listSnapshotFiles(root: string): Promise<Map<string, { size: number; mtime: number }>> {
  const out = new Map<string, { size: number; mtime: number }>();
  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 8 || out.size >= 2000) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.venv' || e.name === '__pycache__') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        try {
          const s = await stat(full);
          out.set(relative(root, full), { size: s.size, mtime: Math.floor(s.mtimeMs) });
        } catch { /* swallow */ }
      }
    }
  }
  await walk(root).catch(() => undefined);
  return out;
}

/** Locate the snapshot directory representing "the workspace state right
 *  before the most-recent completed iteration ran" — i.e. the diff target
 *  that lets us tell the agent what the last iteration changed. Returns
 *  null when there's nothing to compare against (iter 1 starting, or only
 *  one snapshot taken so far — meaning iter 2 starting after iter 1 ended,
 *  in which case we treat everything as [NEW]). */
async function findPreviousSnapshotDir(buildId: string): Promise<string | null> {
  const snapshotsRoot = `${BUILDS_ROOT}/${buildId}/snapshots`;
  const entries = await readdir(snapshotsRoot, { withFileTypes: true }).catch(() => []);
  const numbers = entries
    .filter((e) => e.isDirectory())
    .map((e) => parseInt(e.name, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (numbers.length < 2) return null;
  // Penultimate = state before the most recent iteration ran.
  const prev = numbers[numbers.length - 2];
  return `${snapshotsRoot}/${prev}`;
}

interface ChangeStatus { kind: 'new' | 'changed' | 'unchanged' }

/** Compare a current file's stat against the same path in the snapshot.
 *  cp -a preserves mtime + size, so equality on both is a reliable
 *  "unchanged" signal at near-zero cost (no read + hash needed). */
function classifyFile(
  path: string,
  current: { size: number; mtime: number },
  snapshotIndex: Map<string, { size: number; mtime: number }> | null,
): ChangeStatus {
  if (!snapshotIndex) return { kind: 'unchanged' };
  const snap = snapshotIndex.get(path);
  if (!snap) return { kind: 'new' };
  if (snap.size !== current.size || snap.mtime !== current.mtime) return { kind: 'changed' };
  return { kind: 'unchanged' };
}

/** Walk the workspace's listDevFiles output, read each candidate, summarise.
 *  Designed to be called every iteration before pi spawns. Cost: a few ms
 *  of disk I/O on a typical project. Returns a single markdown block to
 *  inject into the prompt. */
export async function buildCodebaseDigest(buildId: string, files: FileEntry[]): Promise<string> {
  if (files.length === 0) {
    return '## Codebase Digest\nEmpty workspace — fresh build.';
  }
  // Snapshot for diff comparison. Penultimate iteration snapshot = state
  // right before the most recent iteration's pi ran. Diff against current
  // dev/ = what the most recent iteration changed.
  const snapshotDir = await findPreviousSnapshotDir(buildId);
  const snapshotIndex = snapshotDir ? await listSnapshotFiles(snapshotDir) : null;
  const isFreshDiff = snapshotIndex === null;

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
  if (isFreshDiff) {
    lines.push(`Working tree (${candidates.length} relevant files). All entries are new (this is the iteration after the workspace skeleton). Read on demand; the digest tells you what's where without you having to enumerate.`);
  } else {
    lines.push(`Working tree (${candidates.length} relevant files). [NEW] / [CHANGED] markers show what the last iteration touched — focus your reads there. Unmarked files are unchanged from before; trust the digest, don't re-read them.`);
  }
  lines.push('');

  let newCount = 0;
  let changedCount = 0;
  let totalBytes = 0;

  // Track which snapshot files we saw vs what's gone (deleted).
  const seenInCurrent = new Set<string>();

  for (const f of candidates) {
    try {
      const fullPath = join(root, f.path);
      const stt = await stat(fullPath).catch(() => null);
      if (!stt || !stt.isFile()) continue;
      seenInCurrent.add(f.path);
      const status = classifyFile(f.path, { size: f.size, mtime: f.mtime * 1000 }, snapshotIndex);
      const tag =
        isFreshDiff ? '[NEW]' :
        status.kind === 'new' ? '[NEW]' :
        status.kind === 'changed' ? '[CHANGED]' :
        '';
      if (tag === '[NEW]') newCount++;
      else if (tag === '[CHANGED]') changedCount++;
      const content = await readFile(fullPath, 'utf-8');
      const summary = summariseFile(f.path, content);
      const prefix = tag ? `${tag} ` : '';
      lines.push(`- ${prefix}${summary}`);
      totalBytes += summary.length + tag.length;
      if (totalBytes > MAX_SUMMARY_BYTES) {
        lines.push(`- … (${candidates.length - lines.length + 2} more files truncated to keep the digest under 8 KB)`);
        break;
      }
    } catch { /* skip unreadable */ }
  }

  // Surface deleted files separately. Rare but possible (the agent rewrote
  // a file under a different name, or did a cleanup). The agent shouldn't
  // try to read them.
  if (snapshotIndex) {
    const deleted: string[] = [];
    for (const path of snapshotIndex.keys()) {
      if (!seenInCurrent.has(path)) deleted.push(path);
      if (deleted.length >= 12) break;
    }
    if (deleted.length > 0) {
      lines.push('');
      lines.push(`### Deleted in last iteration`);
      for (const p of deleted) lines.push(`- ${p}`);
    }
  }

  // Quick summary at the top so the agent can decide at a glance whether
  // there's anything new to look at vs ride the digest.
  if (!isFreshDiff && (newCount + changedCount) > 0) {
    lines.splice(2, 0, `Last iteration: ${newCount} new, ${changedCount} changed.`);
  } else if (!isFreshDiff) {
    lines.splice(2, 0, `Last iteration: no file-level changes detected (likely tests/diagnostics only).`);
  }

  return lines.join('\n');
}
