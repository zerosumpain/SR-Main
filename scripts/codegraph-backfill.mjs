#!/usr/bin/env node
/**
 * codegraph-backfill.mjs — build the code-memory graph from what is already on
 * disk, and POST it to the VPS.
 *
 * Runs on homeserv, because that is the only machine that has the raw
 * transcripts (858 MB across 1,010 `.jsonl` files) and the 272 curated memory
 * notes. homeserv's own DATABASE_URL points at a stale local copy of the DB, so
 * extraction happens here and the distilled units go over HTTP — the same shape
 * as the changelog ingest that has run every fifteen minutes since June.
 *
 * Usage:
 *   node scripts/codegraph-backfill.mjs --lessons          # 272 memory notes only
 *   node scripts/codegraph-backfill.mjs --sessions         # transcripts only
 *   node scripts/codegraph-backfill.mjs --all [--limit N] [--dry]
 *
 * Env (from ~/.claude-changelog.env):
 *   CLAUDE_CHANGELOG_TOKEN   bearer, must match the VPS CLAUDE_CHANGELOG_SECRET
 *   CODEGRAPH_URL            defaults to the production ingest endpoint
 *
 * IDEMPOTENT. Natural keys everywhere, so re-running updates in place. A
 * backfill nobody dares re-run is a backfill that rots.
 */
import { createReadStream, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const SESSIONS_DIR = '/home/john/.claude/projects/-home-john';
const MEMORY_DIR = '/home/john/.claude/projects/-home-john/memory';
const REPO_ROOT = '/home/john/strange_rambling_svelte';
const REPO = 'SR-Main';

const URL_ = process.env.CODEGRAPH_URL || 'https://strangeramblings.com/api/jkai/codegraph/ingest';
const TOKEN = process.env.CLAUDE_CHANGELOG_TOKEN || '';
const DRY = process.argv.includes('--dry');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : Infinity;
})();

// ---------------------------------------------------------------------------
// Path normalisation. The SAME file appears as an absolute homeserv path, as a
// worktree path (.worktrees/<name>/src/...), and as a sandbox path
// (/home/jkai/workspace/<id>/dev/src/...). Unless these collapse to one
// canonical repo-relative key the graph has three nodes for one file and every
// per-file query misses two thirds of its own history.
// ---------------------------------------------------------------------------
const WORKTREE_RE = /^(?:.*\/)?\.worktrees\/[^/]+\//;
const SANDBOX_RE = /^\/home\/jkai\/workspace\/[^/]+\/dev\//;
const CLAUDE_WT_RE = /^(?:.*\/)?\.claude\/worktrees\/[^/]+\//;

/** Repo-relative canonical path, or null if this file is not in SR-Main. */
export function canonicalise(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.trim();
  if (!p) return null;
  p = p.replace(SANDBOX_RE, '').replace(CLAUDE_WT_RE, '').replace(WORKTREE_RE, '');
  if (p.startsWith(REPO_ROOT + '/')) p = p.slice(REPO_ROOT.length + 1);
  if (p.startsWith('/')) return null;            // some other absolute tree
  if (p.startsWith('.worktrees/')) p = p.split('/').slice(2).join('/');
  if (!p || p.includes('..')) return null;
  // Only paths that plausibly belong to this repo become nodes; a memory note
  // about the bathroom project must not mint SR-Main nodes.
  if (!/^(src|scripts|packages|static|docs|tests|field-study-system|\.github)\//.test(p)) return null;
  return p;
}

// ---------------------------------------------------------------------------
// Failure classification — mirrors src/lib/codegraph/fingerprint.ts. Duplicated
// deliberately: this script is plain node with no TS build step, and a drifting
// copy is caught by fingerprint.test.ts sharing the same corpus of cases.
// ---------------------------------------------------------------------------
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g');
// The same sequence with its escape already gone — 42 of 827 production error
// logs arrive that way, and without this a coloured failure keys as `1mError`.
const ORPHAN_SGR = /\[[0-9;]{1,11}m/g;
const stripAnsi = (t) => String(t ?? '').replace(ANSI, '').replace(ORPHAN_SGR, '');

function looksFailed(raw) {
  const t = stripAnsi(raw).slice(0, 40000);
  if (!t.trim()) return false;
  const hasReal = /\b[1-9]\d*\s+(errors?|failed|failing|problems?)\b/i.test(t);
  const hasZero = /\bfound 0 errors?\b|\b0 errors?\b|\b0 failed\b/i.test(t);
  if (hasZero && !hasReal) return false;                       // "found 0 errors" is a PASS
  if (/\bexit code 0\b/.test(t) && !hasReal) return false;
  return (
    /\bexit code\s*[1-9]\d*\b/.test(t) || /(^|\s)FAIL(ED)?\b/.test(t) ||
    /\berror TS\d+\b/.test(t) || /\b\w*Error:\s/.test(t) ||
    /\bTests?:\s*[1-9]\d* failed\b/i.test(t) || hasReal ||
    /Traceback \(most recent call last\)/.test(t)
  );
}

function gateOf(cmd) {
  const c = String(cmd ?? '').toLowerCase();
  if (/svelte-check/.test(c)) return 'svelte-check';
  if (/\bvitest\b|\bnpm (run )?test\b/.test(c)) return 'vitest';
  if (/\btsc\b|gate:check/.test(c)) return 'typecheck';
  if (/vite build|npm run build|gate:build/.test(c)) return 'build';
  if (/eslint|ruff|gate:font|gate:public/.test(c)) return 'lint';
  if (/npm run gate\b/.test(c)) return 'gate';
  return 'cmd';
}

/*
 * Mirrors MATCHERS / assertionMatcherIn in src/lib/codegraph/fingerprint.ts.
 * Duplicated for the reason the whole classifier is: this runs as plain node on
 * homeserv with no TS build step. Divergence is caught by fingerprint.test.ts,
 * which shares the same corpus of cases.
 *
 * Specific phrasings FIRST — "to be called 3 times" and "to be greater than"
 * both contain "to be", so a generic-first check collapses the vocabulary back
 * into one class and silently undoes the subdivision.
 */
const MATCHERS = [
  ['toHaveBeenCalledTimes', /to be called \d+ times?/i],
  ['toHaveBeenCalledWith', /to be called with/i],
  ['toHaveBeenCalled', /to be called\b/i],
  ['toBeGreaterThan', /to be greater than(?: or equal)?/i],
  ['toBeLessThan', /to be less than(?: or equal)?/i],
  ['toBeCloseTo', /to be close to/i],
  ['toBeTruthy', /to be truthy/i],
  ['toBeFalsy', /to be falsy/i],
  ['toBeDefined', /to be defined/i],
  ['toBeUndefined', /to be undefined\b/i],
  ['toBeNull', /to be null\b/i],
  ['toBeInstanceOf', /to be an instance of/i],
  ['toEqual', /to (?:deeply |strictly )?equal/i],
  ['toContain', /to contain/i],
  ['toHaveLength', /to have (?:a )?length/i],
  ['toHaveProperty', /to have property/i],
  ['toMatchObject', /to match object/i],
  ['toMatch', /to match/i],
  ['toThrow', /to throw/i],
  ['rejects', /resolved instead of rejected|promise (?:resolved|rejected)/i],
  ['toBe', /Object\.is equality|to be\b/i],
];

function assertionMatcherIn(raw) {
  const t = stripAnsi(raw);
  const i = t.search(/\bexpected\b/i);
  if (i === -1) return null;
  const w = t.slice(i, i + 400);
  for (const [name, re] of MATCHERS) if (re.test(w)) return name;
  return null;
}

function fingerprintOf(raw, cmd = '') {
  const t = stripAnsi(raw);
  if (!t.trim()) return null;
  const gate = gateOf(cmd);
  const ts_ = t.match(/error (TS\d+)\b/);
  if (ts_) return `${gate === 'cmd' ? 'typecheck' : gate}:${ts_[1]}`;
  const sv = t.match(/\b(a11y[_-][a-z_]+)\b/);
  if (sv) return `svelte-check:${sv[1].replace(/-/g, '_')}`;
  const named = t.match(/\b(\w*(?:Error|Exception))\b/);
  if (named && named[1] !== 'Error') {
    // `vitest:AssertionError` was 53% of the whole episode corpus. The matcher
    // is what makes it a key rather than a bucket.
    if (named[1] === 'AssertionError') {
      const m = assertionMatcherIn(t);
      return m ? `${gate}:AssertionError:${m}` : `${gate}:AssertionError`;
    }
    return `${gate}:${named[1]}`;
  }
  const mod = t.match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/);
  if (mod) return `${gate}:missing-module:${mod[1].split('/').slice(0, 2).join('/')}`;
  const ff = t.match(/FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)/);
  if (ff) return `vitest:${ff[1].split('/').pop()}`;
  // Last resort: the gate names the STAGE it died in, which is a usable key
  // when nothing sharper is present. Mirrors gateStageIn in fingerprint.ts.
  const stage = t.match(/gate failed in\s*[`'"]?(gate:[a-z-]+)/i);
  if (stage) return `${stage[1]}-failed`;
  return null;
}

/**
 * The DIAGNOSTIC lines, not the head of the log.
 *
 * A build's stdout is mostly noise — service log lines, JSON from a background
 * WhatsApp socket, progress spinners. Taking the first 900 characters captured
 * whichever of those happened to be flushed first, and one episode's "problem"
 * came back as a baileys handshake blob. The orchestrator already learned this
 * lesson the hard way (`extractDiagnostics`, cost change request #216 its run):
 * keep the lines that name the failure, drop the rest.
 */
function diagnosticExcerpt(raw, max = 900) {
  const lines = stripAnsi(raw).split('\n');
  const keep = [];
  for (const line of lines) {
    const l = line.trimEnd();
    if (!l.trim()) continue;
    if (/^\s*\{"level":\d+/.test(l)) continue;             // structured service logs
    if (/^\s*(at |\s+at )/.test(l) && keep.length > 6) continue;  // deep stack tails
    if (/^\s*(npm |> |added \d+ packages|\d+ packages are looking)/.test(l)) continue;
    if (
      /error TS\d+|FAIL|failed|Error:|Exception|AssertionError|Cannot find|Expected|Received|✗|✘|\bat .*\.(ts|js|svelte):\d+/.test(l)
    ) {
      keep.push(l);
      if (keep.join('\n').length >= max) break;
    }
  }
  const out = keep.join('\n').slice(0, max);
  // Nothing matched: fall back to the tail, which is where a failing command's
  // real message usually is, rather than the head, which is its preamble.
  return out || stripAnsi(raw).trim().slice(-max);
}

const isVerification = (cmd) =>
  /\b(npm run (gate|test|check|build)|npx? vitest|vitest|svelte-check|tsc|pytest|playwright)\b/i.test(String(cmd ?? ''));

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join('\n');
  if (typeof v === 'object') {
    const parts = [];
    for (const k of ['stdout', 'stderr', 'output', 'text', 'content', 'result', 'error', 'message']) {
      if (v[k] != null) parts.push(textOf(v[k]));
    }
    if (!parts.length) { try { return JSON.stringify(v).slice(0, 20000); } catch { return ''; } }
    return parts.join('\n');
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Session walk
// ---------------------------------------------------------------------------
async function scanSession(file) {
  const events = [];
  const pending = new Map();
  const meta = { sessionId: null, prNumbers: new Set(), startedAt: null };

  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (!meta.sessionId && o.sessionId) meta.sessionId = o.sessionId;
    if (!meta.startedAt && o.timestamp) meta.startedAt = o.timestamp;
    if (o.type === 'pr-link' && o.prNumber) meta.prNumbers.add(Number(o.prNumber));

    if (o.type === 'file-history-delta' && o.trackingPath) {
      const c = canonicalise(o.trackingPath);
      if (c) events.push({ kind: 'edit', path: c, at: o.timestamp });
      continue;
    }

    if (o.type === 'assistant') {
      const content = o.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) if (b?.type === 'tool_use') pending.set(b.id, { name: b.name, input: b.input || {} });
      }
      continue;
    }

    if (o.type !== 'user') continue;
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== 'tool_result') continue;
      const use = pending.get(b.tool_use_id);
      if (!use) continue;
      pending.delete(b.tool_use_id);
      // Dual path: the payload lives in the block for most records and on the
      // envelope for subagent results. Missing the second loses ~25k results.
      const body = textOf(b.content) || textOf(o.toolUseResult);

      if (use.name === 'Bash') {
        const cmd = String(use.input.command ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!cmd) continue;
        const failed = looksFailed(body);
        events.push({
          kind: 'bash', cmd, at: o.timestamp,
          verify: isVerification(cmd), failed,
          fingerprint: failed ? fingerprintOf(body, cmd) : null,
          gate: gateOf(cmd),
          excerpt: failed ? diagnosticExcerpt(body) : null,
        });
      } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(use.name)) {
        const c = canonicalise(use.input.file_path || use.input.notebook_path);
        if (c) events.push({ kind: 'edit', path: c, at: o.timestamp });
      } else if (use.name === 'Read') {
        const c = canonicalise(use.input.file_path);
        if (c) events.push({ kind: 'read', path: c, at: o.timestamp });
      }
    }
  }
  return { events, meta };
}

/**
 * Failure -> edits -> green. Keyed on the ERROR CLASS, never on command
 * identity: across 25 sessions there was exactly ONE case of an agent re-running
 * a byte-identical command after a failure, because the command almost always
 * carries a file list or a grep pipe that changes between runs.
 */
function episodesFrom(events, meta) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== 'bash' || !e.failed || !e.verify || !e.fingerprint) continue;
    let proven = false;

    const edits = [];
    // WINDOW. 400 events was far too wide: in a long session it paired a
    // failure with whatever unrelated work happened half an hour later, so a
    // codex-sdk module error came back claiming it was fixed by editing
    // route-plan.ts and verified by a promote-endpoint test. 60 events is
    // roughly the observed distance of a genuine fix, and a pairing we are
    // unsure of is worse than no pairing at all — this graph's whole value is
    // that what it serves actually worked.
    for (let j = i + 1; j < events.length && j < i + 60; j++) {
      const f = events[j];
      if (f.kind === 'edit') { edits.push(f.path); continue; }
      if (f.kind !== 'bash' || !f.verify) continue;
      if (f.failed) continue;                    // still red, keep collecting
      if (!edits.length) break;                  // green with no edits proves nothing
      // SAME GATE FAMILY. A passing `vitest` run says nothing about a failing
      // `svelte-check`; accepting any green command is how an unrelated success
      // gets recorded as a verification.
      if (f.gate !== e.gate) continue;

      const files = [...new Set(edits)].slice(0, 20);
      const pr = meta.prNumbers.size === 1 ? [...meta.prNumbers][0] : null;
      out.push({
        repo: REPO,
        sourceKind: 'session',
        sourceId: meta.sessionId,
        title: `${e.gate}: ${e.fingerprint}`,
        problem: e.excerpt,
        // Template-assembled from recorded fields. No LLM writes any of this —
        // rewriting a recorded fact is how fabrication gets in.
        resolution: `Fixed by editing ${files.length} file(s): ${files.join(', ')}.`,
        verification: f.cmd,
        fingerprint: e.fingerprint,
        gate: e.gate,
        // 'verified' only when a gate went red then green in the same
        // transcript. A PR number alone is 'landed' — 17.1% of merged PRs were
        // themselves repairs, so merged is not correct.
        verdict: 'verified',
        filesTouched: files,
        prNumber: pr,
        occurredAt: f.at || e.at || meta.startedAt,
      });
      proven = true;
      i = j;
      break;
    }

    /*
     * A FAILURE FOLLOWED BY EDITS, WITH NO GREEN RUN OBSERVED, IS STILL EVIDENCE.
     *
     * These used to be dropped on the floor: the loop above emits only when it
     * finds a same-gate green run inside the window, so the corpus knew about
     * struggles that ended in a proven fix and about nothing else. That is why
     * production held 108 episodes ALL marked `verified` — `verdict` was a
     * column the ranking multiplies by, holding one value, doing nothing.
     *
     * "This error has been hit here before, and these are the files someone
     * changed next" is worth serving even when the transcript never shows it
     * going green — the session may simply have ended, or verified in a way we
     * cannot see. It is weaker evidence, and `relevance.ts` already has the
     * mechanism to say so: it multiplies by verdict, and `unverified` ranks
     * below `verified`. Recording it honestly and ranking it lower beats
     * discarding it.
     */
    if (!proven) {
      const edits2 = [];
      for (let j = i + 1; j < events.length && j < i + 60; j++) {
        const f = events[j];
        if (f.kind === 'edit') edits2.push(f.path);
        else if (f.kind === 'bash' && f.verify && f.gate === e.gate) break;
      }
      if (edits2.length) {
        const files = [...new Set(edits2)].slice(0, 20);
        out.push({
          repo: REPO,
          sourceKind: 'session',
          sourceId: meta.sessionId,
          title: `${e.gate}: ${e.fingerprint}`,
          problem: e.excerpt,
          resolution: `Edited ${files.length} file(s) after this failure: ${files.join(', ')}.`,
          // No verification observed — the column stays null rather than
          // borrowing a command that proved nothing.
          verification: null,
          fingerprint: e.fingerprint,
          gate: e.gate,
          verdict: 'unverified',
          filesTouched: files,
          prNumber: meta.prNumbers.size === 1 ? [...meta.prNumbers][0] : null,
          occurredAt: e.at || meta.startedAt,
        });
      }
    }
  }
  return out;
}

/** Files edited in the same session co-change; files read before editing X
 *  supply its context. Both are counted, not asserted once. */
/*
 * Mirrors carriesBehaviouralEdges in src/lib/codegraph/edges.ts. The ingest
 * enforces this too — it has to, since it is the one write point — but doing it
 * here as well keeps the pair count down before the cap below is applied, which
 * is where the useful pairs get squeezed out by the useless ones.
 *
 * A plan document under docs/ names every file its plan touches, so a session
 * following the plan "co-changes" the document with all of them. That records
 * the table of contents, not an observation, and it was the shape of every
 * duplicated co_change pair sampled from production.
 */
function behavioural(p) {
  if (!p) return false;
  if (/\.(md|mdx|txt|json|lock|svg|png|jpe?g|gif|webp|ico|woff2?)$/i.test(p)) return false;
  if (/^docs\//.test(p) || /^static\//.test(p)) return false;
  return true;
}

function edgesFrom(events) {
  const edited = [...new Set(events.filter((e) => e.kind === 'edit').map((e) => e.path))].filter(behavioural);
  const read = [...new Set(events.filter((e) => e.kind === 'read').map((e) => e.path))].filter(behavioural);
  const out = [];
  // Cap: a 40-file session yields 780 pairs, most of them meaningless. The
  // sessions that edit half the repo are exactly the ones whose pairs mean least.
  // co_change is SYMMETRIC, so the pair is stored sorted. Unsorted, one
  // session emitting (a,b) and another emitting (b,a) produces two rows for one
  // relationship, each with half the weight — which is how a strong habit ends
  // up looking like two coincidences.
  if (edited.length >= 2 && edited.length <= 12) {
    for (let a = 0; a < edited.length; a++)
      for (let b = a + 1; b < edited.length; b++) {
        const [x, y] = [edited[a], edited[b]].sort();
        out.push({ source: x, target: y, kind: 'co_change', weight: 1 });
      }
  }
  for (const e of edited.slice(0, 12))
    for (const r of read.slice(0, 12))
      if (r !== e) out.push({ source: r, target: e, kind: 'needs_context', weight: 1 });
  return out;
}

// ---------------------------------------------------------------------------
// Memory notes -> lessons
// ---------------------------------------------------------------------------
const PATH_RE = /(?:^|[\s`'"(\[])((?:src|scripts|packages|static|docs|tests|field-study-system|\.github)\/[A-Za-z0-9_\-./\[\]]+\.[A-Za-z0-9]{1,6})/g;

// ---------------------------------------------------------------------------
// Citation resolution. Mirrors src/lib/codegraph/citations.ts — duplicated for
// the same reason as the fingerprint and import rules above (plain node, no TS
// build step), and pinned by citations.test.ts, which asserts the same cases.
//
// 117 of 277 notes cite no full path, so before these lanes existed they were
// linked to no node and unreachable from any file seed. They are not vague:
// they say `$lib/connectors/`, `monitor.ts`, `/admin/connections/gmail`.
// ---------------------------------------------------------------------------
const LIB_REF = /\$lib\/([A-Za-z0-9_\-./\[\]]*)/g;
const ROUTE_REF = /(?:^|[\s`'"(])(\/(?:admin|jkai|api|projects|blog)\/[a-z0-9\-/\[\]_.]*[a-z0-9\]])/gi;
const BARE_NAME_RE = /(?:^|[^\w/.-])([A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:ts|js|mjs|svelte|json|css|md|sh|py))\b/g;
const DIR_HINT_RE = /\b((?:src|scripts|packages|static|docs|tests|field-study-system|\.github)\/[A-Za-z0-9_\-./]*\/)/g;
const CITE_EXTS = ['.ts', '.js', '.svelte', '.mjs', '.svelte.ts', '.json'];
const CITE_INDEXES = ['/index.ts', '/index.js', '/index.svelte'];
const MAX_DIR_FILES = 6;

function resolveLibRef(body, tracked) {
  const clean = body.replace(/[.,;:)\]`'"]+$/, '');
  if (!clean) return [];
  const base = `src/lib/${clean.replace(/\/$/, '')}`;
  if (tracked.has(base)) return [base];
  for (const e of CITE_EXTS) if (tracked.has(base + e)) return [base + e];
  for (const i of CITE_INDEXES) if (tracked.has(base + i)) return [base + i];
  const prefix = `${base}/`;
  const under = [];
  for (const p of tracked) {
    if (p.startsWith(prefix)) under.push(p);
    if (under.length > MAX_DIR_FILES) return [];   // too broad to mean anything
  }
  return under;
}

function resolveRouteRef(route, tracked) {
  const rel = route.replace(/^\//, '').replace(/\/$/, '');
  if (!rel) return [];
  for (const leaf of ['+page.svelte', '+page.server.ts', '+server.ts', '+layout.svelte']) {
    const p = `src/routes/${rel}/${leaf}`;
    if (tracked.has(p)) return [p];
  }
  return [];
}

/** Every file a note can be SHOWN to be about. Exactly-one-match or decline. */
export function resolveCitations(text, tracked, max = 40) {
  const out = new Set();
  const take = (p) => { if (out.size < max && tracked.has(p) && canonicalise(p)) out.add(p); };

  for (const m of text.matchAll(PATH_RE)) {
    const c = canonicalise(m[1].replace(/[.,;:)`'"]+$/, ''));
    if (c) take(c);
  }
  for (const m of text.matchAll(LIB_REF)) for (const p of resolveLibRef(m[1], tracked)) take(p);
  for (const m of text.matchAll(ROUTE_REF)) for (const p of resolveRouteRef(m[1], tracked)) take(p);

  // Bare names, disambiguated by a directory the note itself names.
  const dirHints = [...new Set([...text.matchAll(DIR_HINT_RE)].map((m) => m[1]))].slice(0, 12);
  const inFullPaths = new Set([...out].map((p) => p.slice(p.lastIndexOf('/') + 1)));
  const names = [...new Set([...text.matchAll(BARE_NAME_RE)].map((m) => m[1]))]
    .filter((n) => !inFullPaths.has(n))
    .slice(0, 24);
  if (names.length) {
    const candidates = [...tracked];
    for (const name of names) {
      const matches = candidates.filter((p) => p.slice(p.lastIndexOf('/') + 1) === name);
      if (matches.length === 1) { take(matches[0]); continue; }
      if (matches.length > 1 && dirHints.length) {
        const narrowed = matches.filter((p) => dirHints.some((d) => p.startsWith(d)));
        if (narrowed.length === 1) take(narrowed[0]);
      }
    }
  }
  return [...out];
}

function lessonsFromMemory(tracked) {
  if (!existsSync(MEMORY_DIR)) return [];
  const files = readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
  const out = [];
  for (const f of files) {
    const body = readFileSync(join(MEMORY_DIR, f), 'utf8');
    const name = (body.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || f.replace(/\.md$/, '');
    const desc = (body.match(/^description:\s*["']?(.+?)["']?\s*$/m) || [])[1]?.trim();
    const modified = (body.match(/^\s*modified:\s*(.+)$/m) || [])[1]?.trim();

    // With no tracked file list (the liveness sentinel refused, or git is not
    // available) fall back to full paths only. A degraded citation set is
    // recoverable on the next run; guessing without the tree is not.
    const cited = tracked
      ? new Set(resolveCitations(body, tracked))
      : new Set(
          [...body.matchAll(PATH_RE)]
            .map((m) => canonicalise(m[1].replace(/[.,;:)`'"]+$/, '')))
            .filter(Boolean),
        );
    // Strip the frontmatter; the prose is the lesson. Kept VERBATIM — these
    // notes are better written than anything a distillation pass would produce.
    const prose = body.replace(/^---[\s\S]*?^---\s*/m, '').trim();
    if (!prose) continue;

    out.push({
      repo: REPO,
      slug: f.replace(/\.md$/, ''),
      title: desc || name,
      body: prose.slice(0, 20000),
      origin: 'memory-note',
      originRef: join(MEMORY_DIR, f),
      citedPaths: [...cited],
      observedAt: modified || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// STATIC linkage: imports and test-subject pairs, read from the tree at HEAD.
//
// The behavioural edges (co_change, needs_context) only exist where a session
// happened to touch two files together, which left half the graph isolated and
// the layout with nothing to cluster on. `import` is exact, directional and
// dense, and needs no history at all. Mirrors src/lib/codegraph/imports.ts —
// duplicated because this script is plain node with no TS build step, and the
// resolution rules are pinned by imports.test.ts.
// ---------------------------------------------------------------------------
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTS = ['.ts', '.js', '.svelte', '.mjs', '.svelte.ts', '.json'];
const IDXS = ['/index.ts', '/index.js', '/index.svelte'];

function normPath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function resolveSpec(spec, fromPath, exists) {
  let base;
  if (spec.startsWith('$lib/')) base = 'src/lib/' + spec.slice(5);
  else if (spec === '$lib') base = 'src/lib';
  else if (spec.startsWith('./') || spec.startsWith('../'))
    base = normPath(fromPath.split('/').slice(0, -1).join('/') + '/' + spec);
  else return null; // external — never invent a node for it
  if (exists.has(base)) return base;
  for (const e of EXTS) if (exists.has(base + e)) return base + e;
  for (const i of IDXS) if (exists.has(base + i)) return base + i;
  return null;
}

function subjectOfTest(path, exists) {
  const m = path.match(/^(.*)\.(test|spec)\.([tj]sx?)$/);
  if (!m) return null;
  const [, stem, , ext] = m;
  // Qualified names — `x.diagnostics.test.ts` covers `x.ts`. Mirrors
  // src/lib/codegraph/imports.ts; 91 of 342 test files need it.
  let s = stem;
  while (s) {
    for (const c of [`${s}.${ext}`, `${s}.svelte`, `${s}.ts`, `${s}.js`]) if (exists.has(c)) return c;
    const cut = s.lastIndexOf('.');
    if (cut === -1 || s.slice(cut).includes('/')) break;
    s = s.slice(0, cut);
  }
  return null;
}

/** Every static edge in the tree at HEAD, weighted 1 (a dependency either is or isn't). */
function staticEdgesFromTree() {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean);
  } catch (e) {
    console.error('git ls-files failed — skipping static edges:', e.message);
    return [];
  }
  const exists = new Set(tracked);
  const scannable = tracked.filter((p) => /\.(ts|js|mjs|svelte)$/.test(p) && canonicalise(p));
  const out = [];
  const seen = new Set();
  for (const path of scannable) {
    let src;
    try { src = readFileSync(join(REPO_ROOT, path), 'utf8'); } catch { continue; }
    if (src.length > 400_000) continue;
    const specs = new Set();
    for (const m of src.matchAll(IMPORT_RE)) { const sp = m[1] ?? m[2]; if (sp) specs.add(sp); }
    for (const sp of specs) {
      const to = resolveSpec(sp, path, exists);
      if (!to || to === path) continue;
      const a = canonicalise(path), b = canonicalise(to);
      if (!a || !b || a === b) continue;
      const k = `imports|${a}|${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ source: a, target: b, kind: 'imports', weight: 1 });
    }
    const subj = subjectOfTest(path, exists);
    if (subj) {
      const a = canonicalise(path), b = canonicalise(subj);
      if (a && b && a !== b) {
        const k = `tests|${a}|${b}`;
        if (!seen.has(k)) { seen.add(k); out.push({ source: a, target: b, kind: 'tests', weight: 1 }); }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Liveness — SUPERSEDED by scripts/codegraph-tree-pass.mjs, which runs in the
// release job against the deployed sha. Kept only to supply the tracked file
// list that citation resolution needs; it no longer stamps `existsOnHead`,
// because stamping it from this working copy is what marked 216 files gone when
// 138 of them were on master. A checkout is not a ref.
//
// Original note follows.
//
// Does each cited path still exist at HEAD?
// SENTINEL SELF-TEST: if a path we KNOW exists reads as missing, the check
// itself is broken (wrong cwd, no git, detached tree) and we must not stamp
// anything — a mass false-quarantine is far worse than stale liveness.
// ---------------------------------------------------------------------------
function headFileSet() {
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const set = new Set(out.split('\n').filter(Boolean));
    for (const sentinel of ['package.json', 'src/lib/db/schema.ts']) {
      if (!set.has(sentinel)) {
        console.error(`liveness sentinel "${sentinel}" missing — refusing to stamp existsOnHead`);
        return null;
      }
    }
    return set;
  } catch (e) {
    console.error('git ls-files failed — skipping liveness:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
async function post(payload) {
  if (DRY) {
    console.log('[dry]', Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])));
    return { ok: true, counts: {} };
  }
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ingest ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  if (!TOKEN && !DRY) {
    console.error('CLAUDE_CHANGELOG_TOKEN not set — refusing to POST (use --dry to test extraction).');
    process.exit(2);
  }
  const doLessons = process.argv.includes('--lessons') || process.argv.includes('--all');
  const doSessions = process.argv.includes('--sessions') || process.argv.includes('--all');
  if (!doLessons && !doSessions) {
    console.error('nothing to do — pass --lessons, --sessions or --all');
    process.exit(2);
  }

  const head = headFileSet();
  const totals = { nodes: 0, edges: 0, episodes: 0, lessons: 0 };

  if (doLessons) {
    if (!head) console.error('no tracked file list — citations degrade to full paths only');
    const lessons = lessonsFromMemory(head);
    const linked = lessons.filter((l) => l.citedPaths.length).length;
    console.log(
      `memory notes: ${lessons.length}, citing ${lessons.reduce((a, l) => a + l.citedPaths.length, 0)} repo paths ` +
        `(${linked} notes linked, ${lessons.length - linked} unreachable from any file seed)`,
    );
    for (let i = 0; i < lessons.length; i += 100) {
      const r = await post({ repo: REPO, lessons: lessons.slice(i, i + 100) });
      totals.lessons += r.counts?.lessons ?? 0;
    }
  }

  if (doSessions) {
    const files = [];
    const walk = (dir, depth = 0) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory() && depth < 3) walk(p, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(p);
      }
    };
    walk(SESSIONS_DIR);
    const picked = files
      .map((p) => ({ p, s: statSync(p).size }))
      .filter((x) => x.s > 20_000)
      .sort((a, b) => b.s - a.s)
      .slice(0, LIMIT === Infinity ? undefined : LIMIT);

    console.log(`transcripts: ${picked.length} files, ${(picked.reduce((a, b) => a + b.s, 0) / 1e6).toFixed(0)} MB`);

    // Edge weights are ACCUMULATED here, across every session, and posted once
    // at the end — not per session.
    //
    // The endpoint REPLACES weight rather than adding to it, because adding
    // would make a re-run inflate every number (the same non-idempotency that
    // doubled the episode table). So the total has to be computed caller-side.
    // Posting per session with weight 1 is what left every edge in the graph at
    // weight exactly 1, p50 and max alike: nothing could tell a habit from a
    // coincidence.
    const edgeTotals = new Map(); // "kind|source|target" -> weight
    const addEdge = (e) => {
      const k = `${e.kind}|${e.source}|${e.target}`;
      edgeTotals.set(k, (edgeTotals.get(k) ?? 0) + (e.weight ?? 1));
    };

    let done = 0;
    for (const { p } of picked) {
      let scan;
      try { scan = await scanSession(p); } catch (e) { console.error('skip', p, e.message); continue; }
      const episodes = episodesFrom(scan.events, scan.meta);
      const edges = edgesFrom(scan.events);
      const paths = [...new Set(scan.events.filter((e) => e.path).map((e) => e.path))];
      // No `existsOnHead` here. A transcript proves a file was touched once,
      // not that it exists now, and this process cannot know which commit is
      // live. The tree pass owns liveness; saying nothing leaves whatever it
      // last stamped intact, which is the correct answer for a history writer.
      const nodes = paths.map((cp) => ({ canonicalPath: cp, kind: 'file' }));

      for (const e of edges) addEdge(e);

      if (nodes.length || episodes.length) {
        // Chunked: the endpoint caps a batch at 5,000 units.
        for (let i = 0; i < Math.max(1, Math.ceil(nodes.length / 800)); i++) {
          const r = await post({
            repo: REPO,
            nodes: nodes.slice(i * 800, (i + 1) * 800),
            episodes: i === 0 ? episodes : [],
          });
          totals.nodes += r.counts?.nodes ?? 0;
          totals.episodes += r.counts?.episodes ?? 0;
        }
      }
      if (++done % 10 === 0) console.log(`  ${done}/${picked.length} — ${JSON.stringify(totals)}`);
    }

    // Static structure, folded in with the behavioural edges. A dependency
    // either exists or it does not, so these carry weight 1 and do not
    // accumulate — their value is coverage, not frequency.
    const staticEdges = staticEdgesFromTree();
    console.log(`static edges from tree: ${staticEdges.length}`);
    for (const e of staticEdges) addEdge(e);

    const allEdges = [...edgeTotals.entries()].map(([k, weight]) => {
      const [kind, source, target] = k.split('|');
      return { source, target, kind, weight };
    });
    const strong = allEdges.filter((e) => e.weight > 1).length;
    console.log(`edges: ${allEdges.length} total, ${strong} with weight > 1`);
    for (let i = 0; i < allEdges.length; i += 1500) {
      const r = await post({ repo: REPO, edges: allEdges.slice(i, i + 1500) });
      totals.edges += r.counts?.edges ?? 0;
    }
  }

  console.log('done:', JSON.stringify(totals));
}

main().catch((e) => { console.error(e); process.exit(1); });
