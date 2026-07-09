// Claude Code changelog — homeserv ingester.
//
// Scans local Claude Code transcripts, parses the changed ones, and POSTs the
// payloads to the VPS ingest endpoint (homeserv cannot write prod DB directly —
// see docs/superpowers/specs/claude-code-changelog.md). A small state file skips
// unchanged transcripts so we don't re-parse ~287 MB every run.
//
// Usage:
//   node ingest.mjs                 # incremental: ingest new/changed sessions
//   node ingest.mjs --all           # backfill: re-ingest everything
//   node ingest.mjs <path.jsonl>    # single session (used by the SessionEnd hook)
//   node ingest.mjs --dry           # parse + report, don't POST
//
// Env:
//   CLAUDE_CHANGELOG_URL     ingest endpoint (default: prod)
//   CLAUDE_CHANGELOG_TOKEN   shared bearer token (required unless --dry)
//   CLAUDE_PROJECTS_DIR      transcripts root (default: ~/.claude/projects)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTranscript, SCHEMA_VERSION } from './parse-transcript.mjs';

const HOME = os.homedir();
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude', 'projects');
const URL = process.env.CLAUDE_CHANGELOG_URL
  || 'https://strangeramblings.com/api/claude-changelog/ingest';
const TOKEN = process.env.CLAUDE_CHANGELOG_TOKEN || '';
const STATE_FILE = path.join(HOME, '.claude', 'claude-changelog-state.json');
const MIN_MESSAGES = 8; // skip aborted / trivial sessions

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ALL = args.includes('--all');
const explicitFile = args.find((a) => a.endsWith('.jsonl'));

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s)); }
  catch (e) { console.error('warn: could not write state:', e.message); }
}

// Top-level session transcripts only (exclude subagent/*.jsonl and workflow dirs).
function findTranscripts(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'subagents' || e.name === 'workflows') continue;
      findTranscripts(p, out);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

async function postPayload(payload) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ingest POST ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

async function main() {
  const files = explicitFile ? [explicitFile] : findTranscripts(PROJECTS_DIR);
  const state = explicitFile ? loadState() : (ALL ? {} : loadState());

  let considered = 0, ingested = 0, skipped = 0, failed = 0;
  for (const file of files.sort()) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    considered++;
    const id = path.basename(file, '.jsonl');
    const prev = state[id];
    // Cheap skip: unchanged size+mtime and same parser version → nothing to do.
    if (!ALL && !explicitFile && prev
      && prev.size === stat.size && prev.mtime === stat.mtimeMs
      && prev.schemaVersion === SCHEMA_VERSION) { skipped++; continue; }

    let payload;
    try { payload = parseTranscript(file); } catch (e) { console.error(`parse ${id}: ${e.message}`); failed++; continue; }
    if (payload.session.messageCount < MIN_MESSAGES) {
      state[id] = { size: stat.size, mtime: stat.mtimeMs, schemaVersion: SCHEMA_VERSION };
      skipped++; continue;
    }
    if (DRY) {
      console.log(`[dry] ${id} ${payload.session.project} "${payload.session.title}" — ${payload.stages.length} stages, $${payload.session.estCostUsd}`);
      ingested++; continue;
    }
    try {
      await postPayload(payload);
      state[id] = { size: stat.size, mtime: stat.mtimeMs, schemaVersion: SCHEMA_VERSION, hash: payload.session.contentHash };
      ingested++;
      console.log(`ok ${id} (${payload.session.project}, ${payload.stages.length} stages)`);
    } catch (e) { console.error(`post ${id}: ${e.message}`); failed++; }
  }
  if (!DRY && !explicitFile) saveState(state);
  else if (!DRY && explicitFile) { // merge single-file state
    const full = loadState(); Object.assign(full, state); saveState(full);
  }
  console.log(`done: considered=${considered} ingested=${ingested} skipped=${skipped} failed=${failed}`);
  if (failed && !ingested) process.exit(1);
}

if (!TOKEN && !DRY) {
  console.error('CLAUDE_CHANGELOG_TOKEN not set — refusing to POST (use --dry to test parsing).');
  process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
