#!/usr/bin/env node
/**
 * Scrub secrets and personal data out of the stored release log.
 *
 * The ingest and summarise paths now redact on the way in, but rows written
 * before that landed still hold whatever the commit messages said — and at
 * least one of them held a personal phone number that reached the public
 * /releases page.
 *
 * Redacts in place, replacing each sensitive span with `[redacted:<kind>]`:
 *   releases.title, releases.summary, releases.commits[].{author,subject,body}
 *   release_items.{title,summary,includes,excludes,surfaces}
 *
 * Structural columns are untouched — shas, file paths, dates, stats. Those are
 * evidence, and normaliseSummary validates LLM claims against them.
 *
 * Usage:
 *   node scripts/release-log/scrub-sensitive.mjs            # dry run, prints every change
 *   node scripts/release-log/scrub-sensitive.mjs --apply    # write
 *   node scripts/release-log/scrub-sensitive.mjs --apply --backup out.json
 *
 * DATABASE_URL must be set. Safe to re-run: redaction is idempotent.
 */
import pg from 'pg';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BACKUP = (() => {
  const i = process.argv.indexOf('--backup');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// Mirrors src/lib/security/sensitive.ts. Duplicated deliberately: this script
// runs standalone against a production database with no SvelteKit build step
// and no $lib resolution. Keep the two in step.
const PATTERNS = [
  ['private-key', /-----BEGIN[ A-Z]*PRIVATE KEY-----/g],
  ['api-key', /\bsk-or-v1-[A-Za-z0-9]{16,}/g],
  ['api-key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g],
  ['api-key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['api-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['api-key', /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ['token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g],
  ['token', /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ['token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['token', /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['token', /\bBearer\s+(?![A-Z][A-Z0-9_]*\b)[A-Za-z0-9._-]{20,}/g],
  ['phone', /\+\d[\d\s()-]{7,}\d/g],
  ['phone', /\b0?7\d{3}[\s-]?\d{6}\b/g],
  ['email', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g],
  ['postcode', /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g],
  ['coordinates', /\b-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b/g],
  ['ip', /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ['long-digits', /\b\d{7,}\b/g],
];

// Looks sensitive, identifies nobody. The Claude Code co-author trailer is in
// 394 of 418 releases; scrubbing it would rewrite the table to protect a public
// robot address. The date rule keeps model ids like claude-haiku-4-5-20251001
// intact.
const NOT_PERSONAL = [
  ['email', /^(?:noreply|no-reply|bot)@(?:anthropic\.com|github\.com|users\.noreply\.github\.com)$/i],
  ['long-digits', /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/],
];
const isExempt = (kind, value) =>
  NOT_PERSONAL.some(([k, re]) => k === kind && re.test(value));

function findSensitive(text) {
  if (!text) return [];
  const out = [];
  const taken = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      if (isExempt(kind, m[0])) continue;
      out.push({ kind, value: m[0], index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function redact(text) {
  const matches = findSensitive(text);
  if (!matches.length) return text;
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += String(text).slice(cursor, m.index) + `[redacted:${m.kind}]`;
    cursor = m.index + m.value.length;
  }
  return out + String(text).slice(cursor);
}

function redactDeep(v) {
  if (typeof v === 'string') return redact(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = redactDeep(val);
    return o;
  }
  return v;
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const changes = [];
const backup = [];
/** [sql, params] queued in pass one, executed only after the backup lands. */
const pending = [];

/**
 * Write the backup BEFORE any row is touched.
 *
 * The first production run of this script did it the other way round — mutate,
 * then serialise — and died on a read-only path after the updates had already
 * committed, leaving the changes applied and no backup at all. A backup taken
 * after the fact is not a backup.
 */
function saveBackup() {
  if (!BACKUP) return;
  writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
  console.log(`backup of ${backup.length} original rows -> ${BACKUP}\n`);
}

// ── release_items ─────────────────────────────────────────────────────────
const items = (
  await c.query('select id, title, summary, includes, excludes, surfaces from release_items')
).rows;
for (const r of items) {
  const next = {
    title: redact(r.title),
    summary: redact(r.summary),
    includes: redactDeep(r.includes ?? []),
    excludes: redactDeep(r.excludes ?? []),
    surfaces: redactDeep(r.surfaces ?? []),
  };
  const dirty =
    next.title !== r.title ||
    next.summary !== r.summary ||
    JSON.stringify(next.includes) !== JSON.stringify(r.includes ?? []) ||
    JSON.stringify(next.excludes) !== JSON.stringify(r.excludes ?? []) ||
    JSON.stringify(next.surfaces) !== JSON.stringify(r.surfaces ?? []);
  if (!dirty) continue;
  changes.push({ table: 'release_items', id: r.id, before: r.title, after: next.title });
  backup.push({ table: 'release_items', row: r });
  for (const m of [
    ...findSensitive(r.title),
    ...findSensitive(r.summary),
    ...findSensitive(JSON.stringify(r.includes ?? [])),
    ...findSensitive(JSON.stringify(r.excludes ?? [])),
    ...findSensitive(JSON.stringify(r.surfaces ?? [])),
  ]) {
    console.log(`  release_items#${r.id} ${m.kind}: ${m.value}`);
  }
  pending.push([
    'update release_items set title=$1, summary=$2, includes=$3, excludes=$4, surfaces=$5 where id=$6',
    [
      next.title,
      next.summary,
      JSON.stringify(next.includes),
      JSON.stringify(next.excludes),
      JSON.stringify(next.surfaces),
      r.id,
    ],
  ]);
}

// ── releases ──────────────────────────────────────────────────────────────
const rels = (await c.query('select id, title, summary, commits from releases')).rows;
for (const r of rels) {
  const nextTitle = r.title === null ? null : redact(r.title);
  const nextSummary = r.summary === null ? null : redact(r.summary);
  // Only the prose fields of each commit — sha/short/date/pr stay intact.
  const nextCommits = (r.commits ?? []).map((k) => ({
    ...k,
    author: typeof k.author === 'string' ? redact(k.author) : k.author,
    subject: typeof k.subject === 'string' ? redact(k.subject) : k.subject,
    body: typeof k.body === 'string' ? redact(k.body) : k.body,
  }));
  const dirty =
    nextTitle !== r.title ||
    nextSummary !== r.summary ||
    JSON.stringify(nextCommits) !== JSON.stringify(r.commits ?? []);
  if (!dirty) continue;
  changes.push({ table: 'releases', id: r.id, before: r.title, after: nextTitle });
  backup.push({ table: 'releases', row: r });
  for (const k of r.commits ?? []) {
    for (const m of [
      ...findSensitive(k.author ?? ''),
      ...findSensitive(k.subject ?? ''),
      ...findSensitive(k.body ?? ''),
    ]) {
      console.log(`  releases#${r.id} commit ${k.short} ${m.kind}: ${m.value}`);
    }
  }
  pending.push([
    'update releases set title=$1, summary=$2, commits=$3 where id=$4',
    [nextTitle, nextSummary, JSON.stringify(nextCommits), r.id],
  ]);
}

// Everything is detected before anything is written.
if (APPLY && pending.length) {
  saveBackup();
  await c.query('begin');
  try {
    for (const [sql, params] of pending) await c.query(sql, params);
    await c.query('commit');
  } catch (err) {
    await c.query('rollback');
    console.error('rolled back:', err.message);
    process.exitCode = 1;
  }
}

console.log(
  `\n${APPLY ? 'UPDATED' : 'WOULD UPDATE'} ${changes.length} rows ` +
    `(${changes.filter((c) => c.table === 'release_items').length} items, ` +
    `${changes.filter((c) => c.table === 'releases').length} releases)`,
);
if (!APPLY) console.log('dry run — pass --apply to write');
await c.end();
