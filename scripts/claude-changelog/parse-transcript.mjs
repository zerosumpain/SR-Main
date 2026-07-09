// Claude Code transcript parser — turns a session .jsonl transcript into a
// structured changelog payload (session summary + ordered stage segments).
//
// Pure Node (no deps). Runs on homeserv where the transcripts live. The output
// payload is POSTed to the VPS ingest endpoint (homeserv's DATABASE_URL points
// at a LOCAL dev DB, so we cannot write prod directly — see CLAUDE.md).
//
//   import { parseTranscript } from './parse-transcript.mjs'
//   const payload = parseTranscript('/home/john/.claude/projects/-home-john/<id>.jsonl')
//
// CLI:  node parse-transcript.mjs <file.jsonl>   # prints JSON payload
//
// Bump SCHEMA_VERSION when the parsing logic changes so the ingester can
// re-process previously-ingested sessions.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const SCHEMA_VERSION = 2;

// ── Pricing per MTok (USD). cache_read ~0.1x input; cache_write_5m ~1.25x; 1h ~2x.
// Keyed by normalised model id prefix. Unknown Claude ids fall back to opus.
const PRICING = {
  'claude-opus-4-8': { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 },
  'claude-opus-4-7': { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 },
  'claude-opus-4-6': { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 },
  'claude-opus-4-5': { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 },
  'claude-opus-4': { in: 5, out: 25, cr: 0.5, cw5: 6.25, cw1: 10 },
  'claude-sonnet-5': { in: 3, out: 15, cr: 0.3, cw5: 3.75, cw1: 6 },
  'claude-sonnet-4': { in: 3, out: 15, cr: 0.3, cw5: 3.75, cw1: 6 },
  'claude-haiku-4-5': { in: 1, out: 5, cr: 0.1, cw5: 1.25, cw1: 2 },
  'claude-haiku': { in: 1, out: 5, cr: 0.1, cw5: 1.25, cw1: 2 },
  'claude-fable-5': { in: 10, out: 50, cr: 1, cw5: 12.5, cw1: 20 },
};
const DEFAULT_PRICE = PRICING['claude-opus-4-8'];

function priceFor(model) {
  if (!model) return DEFAULT_PRICE;
  const m = String(model).toLowerCase();
  // longest-prefix match
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const k of keys) if (m.startsWith(k)) return PRICING[k];
  if (m.startsWith('claude')) return DEFAULT_PRICE;
  return null; // non-Claude (e.g. glm via z.ai) — cost n/a
}

// ── Project attribution: dominant touched top-dir → friendly slug.
const PROJECT_MAP = {
  strange_rambling_svelte: 'strange-rambling-svelte',
  'strange-rambling-svelte': 'strange-rambling-svelte',
  strange_rambling: 'strange-rambling-legacy',
  'brass-and-rails': 'brass-and-rails',
  'marble-run': 'marble-run',
  'space-lander': 'terminal-descent',
  'space-lander-assets': 'terminal-descent',
  whitehall: 'whitehall',
  'scs-earnings': 'scs-earnings',
  'offline-maps': 'offline-maps',
  'sr-docs': 'sr-docs',
  'homeserv-infra': 'homeserv-infra',
  '.hermes-jkai': 'hermes-jkai',
  '.claude': 'claude-config',
  'home-security': 'home-security',
};

const STOPWORDS = new Set(
  ('a an the and or but if then else for to of in on at by with without from into over under '
    + 'is are was were be been being do does did doing have has had having will would should could '
    + 'can may might must shall this that these those it its it\'s i you he she we they me him her us them '
    + 'my your his our their as so not no yes ok okay just also very really more most some any all each '
    + 'which what who whom whose when where why how than too much many few lot get got make made use used '
    + 'need want like now then here there out up down off about again still only same other new old '
    + 'go going let lets please thanks thank yeah yep nope sure fine good great work works working done '
    + 'add added adding using via into onto per etc eg ie vs am pm re want add set way thing things '
    + 'one two three first second next last back keep going crack look looking see seen give given').split(/\s+/),
);

// Skill → stage mapping
const DESIGN_SKILLS = new Set([
  'superpowers:brainstorming', 'solution-design', 'frontend-design:frontend-design', 'sr-design', 'dataviz', 'artifact-design',
]);
const PLAN_SKILLS = new Set(['superpowers:writing-plans']);
const RESULT_SKILLS = new Set([
  'ship', 'bundle-deploy', 'superpowers:executing-plans', 'superpowers:subagent-driven-development',
  'superpowers:test-driven-development', 'verify', 'superpowers:requesting-code-review',
  'superpowers:finishing-a-development-branch', 'local-qa', 'vps-ops', 'project-page', 'workflow-node',
]);
const FIX_SKILLS = new Set(['superpowers:systematic-debugging', 'superpowers:receiving-code-review']);

const FIX_RE = /\b(fix|fixed|broken|breaks?|error|errors|still|doesn'?t|does not|not working|isn'?t|wasn'?t|wrong|revert|regress|bug|bugs|failing|failed|crash|500|404|undefined|null|nan|off by|too (big|small|slow)|missing)\b/i;
const PLAN_PATH_RE = /(\/plans?\/|\/superpowers\/plans|plan\.md$)/i;
const DEPLOY_CMD_RE = /(deploy\.sh|git commit|git push|npm run build|npm run check|drizzle-kit push|bundle-deploy|rsync)/i;

// ── helpers ────────────────────────────────────────────────────────────────
function textOf(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
  }
  return '';
}
function toolUses(msg) {
  const c = msg?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b) => b && b.type === 'tool_use');
}
function hasToolResults(msg) {
  const c = msg?.content;
  return Array.isArray(c) && c.some((b) => b && b.type === 'tool_result');
}
function isMetaUser(o) {
  if (o.isMeta) return true;
  const t = textOf(o.message).trim();
  if (!t) return true;
  if (/^<(command-|local-command|system-reminder|user-prompt-submit)/.test(t)) return true;
  if (/^Caveat: The messages below/.test(t)) return true;
  if (/^This session is being continued from a previous conversation/.test(t)) return true;
  return false;
}
function topDir(p) {
  const rel = String(p).replace(/^\/home\/[^/]+\//, '').replace(/^\/+/, '');
  const parts = rel.split('/').filter(Boolean);
  return parts[0] || rel;
}
// A file counts toward project attribution only if it's real project work under
// the user's home dir — not scratchpad/tmp/system paths.
function isProjectFile(p) {
  const s = String(p);
  if (!s.startsWith('/home/')) return false;
  if (/\/(scratchpad|node_modules|\.svelte-kit|\.git)\//.test(s)) return false;
  return true;
}
// Strip NUL + other C0 control chars (keep \t \n \r). Postgres text/jsonb columns
// reject NUL bytes, and transcripts occasionally carry binary-ish tool output.
function sanitize(s) {
  return String(s == null ? '' : s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
function firstSentence(s, max = 140) {
  const t = sanitize(s).replace(/\s+/g, ' ').trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  const out = (m ? m[0] : t).trim();
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}
function clip(s, max) {
  s = sanitize(s);
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s;
}

// ── main ─────────────────────────────────────────────────────────────────────
export function parseTranscript(file, opts = {}) {
  const now = opts.now ?? Date.now();
  const raw = fs.readFileSync(file, 'utf8');
  const stat = fs.statSync(file);
  const contentHash = crypto.createHash('sha256').update(raw).digest('hex');
  const sessionId = path.basename(file, '.jsonl');

  const lines = raw.split('\n');
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }

  let aiTitle = null;
  let cwd = null;
  let gitBranch = null;
  const models = new Set();
  const tok = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const byModel = {}; // model -> {input, output, cacheRead, cw5, cw1} for the cost breakdown
  let estCostUsd = 0;
  let costKnown = true;
  const toolHistogram = {};
  const touchedTop = {};
  const touchedFull = {};
  const skillsUsed = {};
  let userMsgCount = 0;
  let assistantMsgCount = 0;
  let toolCallCount = 0;

  // ordered list of {role, ts, msg} for user/assistant, plus derived flags
  const timeline = [];
  let firstTs = null;
  let lastTs = null;

  for (const o of events) {
    const t = o.type;
    if (t === 'ai-title' && o.aiTitle) aiTitle = o.aiTitle;
    if (o.cwd && !cwd) cwd = o.cwd;
    if (o.gitBranch && !gitBranch) gitBranch = o.gitBranch;
    const ts = o.timestamp ? Date.parse(o.timestamp) : null;
    if (ts) { firstTs = firstTs ?? ts; lastTs = ts; }

    if (t === 'user' || t === 'assistant') {
      timeline.push({ role: t, ts, o });
      if (t === 'user') userMsgCount++;
      else {
        assistantMsgCount++;
        const u = o.message?.usage || {};
        tok.input += u.input_tokens || 0;
        tok.output += u.output_tokens || 0;
        tok.cacheRead += u.cache_read_input_tokens || 0;
        tok.cacheCreation += u.cache_creation_input_tokens || 0;
        const model = o.message?.model;
        if (model) models.add(model);
        // Per-model token buckets. cache_creation splits into 5m (1.25x) and 1h
        // (2x) writes; any unattributed remainder is billed at the 5m rate.
        const cc5 = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
        const cc1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
        const ccOther = Math.max(0, (u.cache_creation_input_tokens || 0) - cc5 - cc1);
        const mk = model || '<unknown>';
        const bm = (byModel[mk] ??= { input: 0, output: 0, cacheRead: 0, cw5: 0, cw1: 0 });
        bm.input += u.input_tokens || 0;
        bm.output += u.output_tokens || 0;
        bm.cacheRead += u.cache_read_input_tokens || 0;
        bm.cw5 += cc5 + ccOther;
        bm.cw1 += cc1;
        for (const b of toolUses(o.message)) {
          toolCallCount++;
          const name = b.name || 'unknown';
          toolHistogram[name] = (toolHistogram[name] || 0) + 1;
          if (name === 'Skill') {
            const sk = b.input?.skill || '?';
            skillsUsed[sk] = (skillsUsed[sk] || 0) + 1;
          }
          if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
            const fp = b.input?.file_path;
            if (fp && isProjectFile(fp)) {
              touchedTop[topDir(fp)] = (touchedTop[topDir(fp)] || 0) + 1;
              touchedFull[fp] = (touchedFull[fp] || 0) + 1;
            }
          }
        }
      }
    }
  }

  // ── project attribution ──
  const topSorted = Object.entries(touchedTop).sort((a, b) => b[1] - a[1]).filter(([k]) => k);
  let project = 'unknown';
  if (topSorted.length) {
    const dom = topSorted[0][0];
    project = PROJECT_MAP[dom] || dom;
  } else if (cwd) {
    const base = path.basename(cwd);
    project = PROJECT_MAP[base] || (base === 'john' ? 'homeserv' : base);
  }

  // ── first substantive user prompt ──
  let firstPrompt = '';
  for (const { role, o } of timeline) {
    if (role === 'user' && !isMetaUser(o)) { firstPrompt = textOf(o.message).trim(); break; }
  }

  const title = aiTitle || (firstPrompt ? firstSentence(firstPrompt, 80) : sessionId.slice(0, 8));

  // ── term frequency (over user prompts + plan text) ──
  const termText = [];
  // ── feature types & term freq accumulate during stage walk below ──

  // ── STAGE SEGMENTATION ──
  const stages = [];
  let cur = null; // current open segment
  let sawResult = false;

  function stageOfAssistant(o) {
    let stage = null;
    for (const b of toolUses(o.message)) {
      if (b.name === 'Skill') {
        const sk = b.input?.skill;
        if (DESIGN_SKILLS.has(sk)) return 'design';
        if (PLAN_SKILLS.has(sk)) return 'plan';
        if (FIX_SKILLS.has(sk)) return 'fixes';
        if (RESULT_SKILLS.has(sk)) stage = stage || 'result';
      }
      if (b.name === 'ExitPlanMode') return 'plan';
      if ((b.name === 'Write') && PLAN_PATH_RE.test(b.input?.file_path || '')) return 'plan';
      if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') stage = stage || 'result';
      if (b.name === 'Bash' && DEPLOY_CMD_RE.test(b.input?.command || '')) stage = stage || 'result';
    }
    return stage; // may be null → inherit current stage
  }

  function pushSeg() {
    if (cur && cur.messageCount > 0) {
      cur.rawText = clip(cur._raw.join('\n\n').trim(), 20000);
      cur.summary = firstSentence(cur.summary || cur.rawText, 200) || cur.title;
      cur.metadata = { skills: [...cur._skills], files: [...cur._files].slice(0, 40) };
      delete cur._raw; delete cur._skills; delete cur._files;
      stages.push(cur);
    }
    cur = null;
  }
  function openSeg(stage, ts, title) {
    pushSeg();
    cur = {
      stage, ordinal: stages.length, title: title || stage,
      summary: '', rawText: '',
      startedAt: ts, endedAt: ts,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      messageCount: 0, toolCalls: 0,
      _raw: [], _skills: new Set(), _files: new Set(),
    };
  }

  let seenFirstPrompt = false;
  for (const { role, ts, o } of timeline) {
    if (role === 'user') {
      if (isMetaUser(o) || hasToolResults(o.message)) {
        // tool results / meta → belong to the current (result/etc.) segment
        if (cur) { cur.messageCount++; if (ts) cur.endedAt = ts; }
        continue;
      }
      const txt = textOf(o.message).trim();
      let stage;
      if (!seenFirstPrompt) { stage = 'request'; seenFirstPrompt = true; }
      else if (FIX_RE.test(txt) && sawResult) stage = 'fixes';
      else stage = 'request';
      openSeg(stage, ts, firstSentence(txt, 80));
      cur.messageCount++;
      cur._raw.push(txt);
      if (!cur.summary) cur.summary = txt;
      termText.push(txt);
    } else {
      // assistant
      const derived = stageOfAssistant(o);
      const stage = derived || (cur ? cur.stage : 'design');
      if (!cur || cur.stage !== stage) {
        // flip stage: label from context
        const label = stage === 'design' ? 'Design & approach'
          : stage === 'plan' ? 'Plan'
          : stage === 'result' ? 'Implementation'
          : stage === 'fixes' ? 'Fixes'
          : 'Request';
        openSeg(stage, ts, label);
      }
      if (stage === 'result') sawResult = true;
      cur.messageCount++;
      if (ts) cur.endedAt = ts;
      const u = o.message?.usage || {};
      cur.tokens.input += u.input_tokens || 0;
      cur.tokens.output += u.output_tokens || 0;
      cur.tokens.cacheRead += u.cache_read_input_tokens || 0;
      cur.tokens.cacheCreation += u.cache_creation_input_tokens || 0;
      const at = textOf(o.message).trim();
      // capture raw material relevant to the stage
      for (const b of toolUses(o.message)) {
        cur.toolCalls++;
        if (b.name === 'Skill') cur._skills.add(b.input?.skill);
        if ((b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') && b.input?.file_path) {
          cur._files.add(b.input.file_path.replace(/^\/home\/[^/]+\//, ''));
        }
        if (stage === 'plan') {
          if (b.name === 'ExitPlanMode' && b.input?.plan) cur._raw.push(b.input.plan);
          if (b.name === 'Write' && PLAN_PATH_RE.test(b.input?.file_path || '') && b.input?.content) {
            cur._raw.push(b.input.content);
          }
        }
      }
      if (at) {
        if (stage === 'design' || stage === 'plan') {
          cur._raw.push(at);
          termText.push(at);
        } else if (stage === 'result' || stage === 'fixes') {
          // keep a concise trace: only capture the assistant's summarising prose
          if (cur._raw.join('').length < 4000) cur._raw.push(at);
        }
        if (!cur.summary) cur.summary = at;
      }
    }
  }
  pushSeg();

  // For result/fixes segments with no prose, synthesise rawText from the file list.
  for (const s of stages) {
    if (!s.rawText && s.metadata.files.length) {
      s.rawText = 'Files changed:\n' + s.metadata.files.map((f) => '  ' + f).join('\n');
    }
  }

  // ── term frequency ──
  const counts = {};
  for (const chunk of termText) {
    for (const w of String(chunk).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []) {
      if (STOPWORDS.has(w) || w.length > 24) continue;
      counts[w] = (counts[w] || 0) + 1;
    }
  }
  const termFreq = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([term, count]) => ({ term, count }));

  // ── feature types (deterministic, multi-label) ──
  const featureTypes = deriveFeatureTypes({
    touchedTop, touchedFull, toolHistogram, skillsUsed,
    text: (title + ' ' + firstPrompt + ' ' + termText.join(' ')).toLowerCase(),
  });

  const touchedPaths = Object.entries(touchedFull)
    .sort((a, b) => b[1] - a[1]).slice(0, 25)
    .map(([p, count]) => ({ path: p.replace(/^\/home\/[^/]+\//, ''), count }));

  // ── cost breakdown per model (auditable: tokens × Anthropic API rate) ──
  // Verified against Anthropic's published API pricing (platform.claude.com/pricing):
  // no long-context premium applies to these models, so a flat per-token rate holds
  // across the full 1M context window.
  const costBreakdown = [];
  for (const [model, b] of Object.entries(byModel)) {
    const price = priceFor(model);
    const totalTok = b.input + b.output + b.cacheRead + b.cw5 + b.cw1;
    if (price) {
      const costUsd = (b.input * price.in + b.output * price.out + b.cacheRead * price.cr
        + b.cw5 * price.cw5 + b.cw1 * price.cw1) / 1e6;
      estCostUsd += costUsd;
      costBreakdown.push({
        model, known: true,
        tokens: { input: b.input, output: b.output, cacheRead: b.cacheRead, cacheWrite5m: b.cw5, cacheWrite1h: b.cw1 },
        rates: { input: price.in, output: price.out, cacheRead: price.cr, cacheWrite5m: price.cw5, cacheWrite1h: price.cw1 },
        costUsd: Number(costUsd.toFixed(4)),
      });
    } else if (totalTok > 0) {
      // genuinely unpriced model with real usage — flag the estimate as partial
      costKnown = false;
      costBreakdown.push({
        model, known: false,
        tokens: { input: b.input, output: b.output, cacheRead: b.cacheRead, cacheWrite5m: b.cw5, cacheWrite1h: b.cw1 },
        rates: null, costUsd: 0,
      });
    }
    // else: zero-token pseudo-model (e.g. <synthetic>) — ignore, don't flag cost as partial
  }
  costBreakdown.sort((a, b) => b.costUsd - a.costUsd);

  const fullTranscript = renderTranscript(timeline);

  // ── status: active if the transcript was modified very recently ──
  const status = (now - stat.mtimeMs) < 30 * 60 * 1000 ? 'active' : 'completed';

  return {
    session: {
      id: sessionId,
      project,
      title,
      firstPrompt: clip(firstPrompt, 8000),
      cwd, gitBranch,
      startedAt: firstTs ? new Date(firstTs).toISOString() : null,
      endedAt: lastTs ? new Date(lastTs).toISOString() : null,
      status,
      messageCount: userMsgCount + assistantMsgCount,
      userMsgCount, assistantMsgCount, toolCallCount,
      models: [...models],
      tokens: tok,
      estCostUsd: costKnown ? Number(estCostUsd.toFixed(4)) : Number(estCostUsd.toFixed(4)),
      costKnown,
      featureTypes,
      termFreq,
      toolHistogram,
      touchedPaths,
      skills: skillsUsed,
      costBreakdown,
      fullTranscript,
      summary: firstSentence(firstPrompt, 200),
      transcriptPath: file,
      contentHash,
      fileMtime: new Date(stat.mtimeMs).toISOString(),
      fileSize: stat.size,
      schemaVersion: SCHEMA_VERSION,
    },
    stages: stages.map((s) => ({
      stage: s.stage, ordinal: s.ordinal, title: s.title, summary: s.summary,
      rawText: s.rawText,
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
      endedAt: s.endedAt ? new Date(s.endedAt).toISOString() : null,
      tokens: s.tokens, messageCount: s.messageCount, toolCalls: s.toolCalls,
      metadata: s.metadata,
    })),
  };
}

function deriveFeatureTypes({ touchedTop, touchedFull, toolHistogram, skillsUsed, text }) {
  const paths = Object.keys(touchedFull).join(' ').toLowerCase();
  const dirs = Object.keys(touchedTop);
  const skills = Object.keys(skillsUsed);
  const has = (re) => re.test(text) || re.test(paths);
  const f = new Set();
  if (/\.svelte|\.css|\bui\b|design|layout|style|frontend|component|modal|page/.test(paths + ' ' + text)
    || skills.some((s) => /sr-design|frontend-design|dataviz|artifact-design/.test(s))) f.add('ui-design');
  if (/schema\.ts|drizzle|\bmigration|postgres|pgvector|\bsql\b|\btable\b|\bdb\b/.test(paths + ' ' + text)) f.add('database');
  if (skills.includes('ship') || skills.includes('bundle-deploy') || /deploy|\bvps\b|production|\bship\b/.test(text)) f.add('deployment');
  if (skills.some((s) => /systematic-debugging|receiving-code-review/.test(s)) || has(/\bfix|\bbug|error|broken|crash|regress/)) f.add('bugfix');
  if (has(/refactor|restructure|cleanup|consolidat|rewrite|migrat/)) f.add('refactor');
  if (dirs.some((d) => /brass-and-rails|marble-run|space-lander|whitehall/.test(d)) || has(/\bgame\b|\bhex\b|\btile\b|\bunit\b|leaderboard/)) f.add('game');
  if (/lib\/workflows|\/canvas|workflow-node/.test(paths) || has(/workflow|canvas node|\bnode\b/)) f.add('workflow-canvas');
  if (/lib\/jkai|lib\/llm|lib\/rag|hermes/.test(paths) || has(/\bllm\b|\bprompt\b|embedding|\brag\b|jkai|hermes|\bmodel\b|\bagent\b/)) f.add('llm-ai');
  if (dirs.includes('homeserv-infra') || has(/systemd|\bcron\b|docker|nginx|caddy|cloudflared|terraform|azure/)) f.add('infrastructure');
  if (dirs.includes('scs-earnings') || has(/analysis|dataset|histogram|\bchart\b|monte.?carlo|simulation/)) f.add('data-analysis');
  if (skills.some((s) => /test-driven|verify/.test(s)) || /\.test\.|playwright|vitest/.test(paths) || has(/\btest\b|\btests\b|e2e/)) f.add('testing');
  if (/routes\/api|\/\+server/.test(paths) || has(/endpoint|\bapi\b|webhook/)) f.add('api');
  if (has(/\bauth\b|oauth|login|allow.?list|session cookie|permission/)) f.add('auth');
  if (has(/performance|latency|optimi|throughput|\bslow\b|speed up/)) f.add('performance');
  if (/\.md\b/.test(paths) || has(/documentation|\breadme\b|\bdocs\b/)) f.add('docs');
  if (f.size === 0) f.add('other');
  return [...f];
}

// Render the ordered user/assistant timeline into a readable full transcript
// (capped ~1.5 MB). User prompts + assistant thinking/text in full; tool calls as
// compact one-liners; tool results truncated. Meta noise (caveats, reminders) dropped.
function renderTranscript(timeline) {
  const MAX = 1_500_000;
  const out = [];
  let len = 0;
  let truncated = false;
  const push = (s) => {
    if (truncated) return;
    if (len + s.length > MAX) { out.push('\n\n…[transcript truncated — open the raw .jsonl for the full record]'); truncated = true; return; }
    out.push(s); len += s.length;
  };
  const hhmm = (ts) => (ts ? new Date(ts).toISOString().slice(11, 16) : '     ');
  const toolBrief = (b) => {
    const i = b.input || {};
    if (b.name === 'Edit' || b.name === 'Write' || b.name === 'NotebookEdit') return (i.file_path || '').replace(/^\/home\/[^/]+\//, '');
    if (b.name === 'Bash') return String(i.command || '').replace(/\s+/g, ' ').slice(0, 200);
    if (b.name === 'Skill') return i.skill || '';
    if (b.name === 'Task' || b.name === 'Agent') return String(i.description || i.prompt || '').slice(0, 120);
    if (b.name === 'Read' || b.name === 'Glob' || b.name === 'Grep') return String(i.file_path || i.pattern || i.path || '').slice(0, 160);
    const j = JSON.stringify(i);
    return j.length > 140 ? j.slice(0, 140) + '…' : j;
  };
  const resultText = (b) => {
    const c = b.content;
    let t = '';
    if (typeof c === 'string') t = c;
    else if (Array.isArray(c)) t = c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join(' ');
    t = String(t).replace(/\s+/g, ' ').trim();
    return t.length > 400 ? t.slice(0, 400) + '…' : t;
  };

  for (const { role, ts, o } of timeline) {
    if (truncated) break;
    const m = o.message || {};
    if (role === 'user') {
      if (hasToolResults(m)) {
        for (const b of (Array.isArray(m.content) ? m.content : [])) {
          if (b?.type === 'tool_result') {
            const rt = resultText(b);
            if (rt) push(`    ↳ result: ${rt}\n`);
          }
        }
        continue;
      }
      if (isMetaUser(o)) {
        const t = textOf(m).trim();
        const cmd = t.match(/^<command-name>([^<]+)<\/command-name>/);
        if (cmd) push(`\n──── /${cmd[1].replace(/^\//, '')} ────\n`);
        else if (/^This session is being continued/.test(t)) push('\n──── [continued from a previous session] ────\n');
        continue;
      }
      push(`\n\n════════ 👤 USER · ${hhmm(ts)} ════════\n${textOf(m).trim()}\n`);
    } else {
      for (const b of (Array.isArray(m.content) ? m.content : [])) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'thinking' && b.thinking) push(`\n──── 🧠 thinking ────\n${String(b.thinking).trim()}\n`);
        else if (b.type === 'text' && b.text) push(`\n════════ 🤖 CLAUDE · ${hhmm(ts)} ════════\n${String(b.text).trim()}\n`);
        else if (b.type === 'tool_use') push(`  » ${b.name}: ${toolBrief(b)}\n`);
      }
    }
  }
  return sanitize(out.join('').trim());
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node parse-transcript.mjs <transcript.jsonl>'); process.exit(1); }
  const payload = parseTranscript(file);
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}
