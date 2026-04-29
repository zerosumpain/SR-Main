// Per-instance node summaries.
//
// Given a node type + its configured values, return a one-line plain-English
// description and a structured "what this will do" preview. Used for:
//   - the canvas summary line under each node title
//   - the "What this does" header on the config panel
//   - grounding the workflow generator with examples of good summaries
//
// The dispatch table below covers the 15 most-used node types deterministically.
// For anything else we fall back to the node's `description` field. The LLM
// generator may also write a free-form `actionSummary` directly onto the node;
// renderers prefer that when present.

import type { NodeActionPreview } from './types';

export interface NodeSummary {
  line: string;
  preview: NodeActionPreview;
}

type Cfg = Record<string, unknown>;

function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}
function truncate(v: string, n: number): string {
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
}
function ternary<T>(cond: boolean, a: T, b: T): T { return cond ? a : b; }

const summarizers: Record<string, (cfg: Cfg) => NodeSummary> = {
  'http-request': (c) => {
    const method = s(c.method, 'GET').toUpperCase();
    const url = s(c.url) || '<url not set>';
    const auth = s(c.auth, 'none');
    const hasBody = !!s(c.body) && method !== 'GET';
    const line = `${method} ${truncate(url, 70)}${auth !== 'none' ? ` (${auth})` : ''}`;
    return {
      line,
      preview: {
        kind: 'http',
        details: {
          Method: method,
          URL: url || '—',
          Auth: auth,
          ...(hasBody ? { 'Has body': 'yes' } : {}),
        },
      },
    };
  },
  'whatsapp': (c) => {
    const to = s(c.to ?? c.recipient ?? c.phone, '+447359228511');
    const msg = s(c.message ?? c.text, '<message templated from upstream>');
    return {
      line: `Send WhatsApp to ${to}: ${truncate(msg, 60)}`,
      preview: {
        kind: 'message',
        details: { Channel: 'WhatsApp', To: to, Message: truncate(msg, 240) },
      },
    };
  },
  'gmail-send': (c) => {
    const to = s(c.to);
    const subject = s(c.subject, '<no subject>');
    return {
      line: `Email ${to || '<recipient>'} — "${truncate(subject, 60)}"`,
      preview: {
        kind: 'message',
        details: {
          Channel: 'Gmail',
          To: to || '—',
          ...(c.cc ? { Cc: s(c.cc) } : {}),
          ...(c.bcc ? { Bcc: s(c.bcc) } : {}),
          Subject: subject,
          'Body type': s(c.bodyType, 'text'),
        },
      },
    };
  },
  'gmail-fetch': (c) => {
    const query = s(c.query, '<query templated>');
    const max = s(c.maxResults, '10');
    return {
      line: `Fetch up to ${max} Gmail messages matching: ${truncate(query, 50)}`,
      preview: {
        kind: 'message',
        details: { Channel: 'Gmail (read)', Query: query, 'Max results': max },
      },
    };
  },
  'gmail-search': (c) => ({
    line: `Search Gmail for: ${truncate(s(c.query, '—'), 60)}`,
    preview: { kind: 'message', details: { Channel: 'Gmail (search)', Query: s(c.query, '—') } },
  }),
  'llm-call': (c) => {
    const model = s(c.model, 'gemini-flash');
    const promptStr = s(c.prompt ?? c.userPrompt, '<prompt templated>');
    const sys = s(c.systemPrompt);
    return {
      line: `Ask ${model}: ${truncate(promptStr, 60)}`,
      preview: {
        kind: 'llm',
        details: {
          Model: model,
          ...(sys ? { 'System prompt': truncate(sys, 240) } : {}),
          'User prompt': truncate(promptStr, 240),
          ...(c.outputSchema ? { 'Structured output': 'yes' } : {}),
        },
      },
    };
  },
  'llm-agent': (c) => {
    const model = s(c.model, 'gemini-flash');
    const goal = s(c.goal ?? c.task ?? c.systemPrompt, '<agent goal templated>');
    return {
      line: `Agent (${model}): ${truncate(goal, 60)}`,
      preview: {
        kind: 'llm',
        details: { Model: model, Goal: truncate(goal, 240), Tools: s(c.tools, 'auto-discovered from outgoing edges') },
      },
    };
  },
  'tavily-search': (c) => {
    const q = s(c.query, '<query templated>');
    return {
      line: `Web search: ${truncate(q, 70)}`,
      preview: { kind: 'http', details: { Provider: 'Tavily', Query: q, Depth: s(c.depth, 'basic'), 'Max results': s(c.maxResults, '5') } },
    };
  },
  'web-scrape': (c) => ({
    line: `Scrape ${truncate(s(c.url, '<url>'), 60)}`,
    preview: { kind: 'scrape', details: { URL: s(c.url, '—'), Selector: s(c.selector, 'whole page') } },
  }),
  'stealth-scrape': (c) => ({
    line: `Stealth-scrape ${truncate(s(c.url, '<url>'), 60)} (profile: ${s(c.profile, 'default')})`,
    preview: { kind: 'scrape', details: { URL: s(c.url, '—'), Profile: s(c.profile, 'default'), Pagination: ternary(!!c.paginate, 'on', 'off') } },
  }),
  'data-store': (c) => {
    const op = s(c.operation, 'set');
    const key = s(c.key, '<key>');
    return {
      line: `${op} key "${key}"${c.value !== undefined ? ` = ${truncate(JSON.stringify(c.value), 40)}` : ''}`,
      preview: { kind: 'db', details: { Operation: op, Key: key, ...(c.value !== undefined ? { Value: truncate(JSON.stringify(c.value), 240) } : {}) } },
    };
  },
  'delay': (c) => {
    const ms = Number(c.delayMs ?? c.ms ?? 1000);
    const human = ms >= 60000 ? `${Math.round(ms / 60000)} min` : ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
    return { line: `Wait ${human}`, preview: { kind: 'control', details: { Duration: human } } };
  },
  'conditional': (c) => {
    const expr = s(c.expression ?? c.condition, '<expression>');
    return { line: `If: ${truncate(expr, 70)}`, preview: { kind: 'control', details: { Expression: truncate(expr, 240), 'On true': 'success edge', 'On false': 'failure edge' } } };
  },
  'transform': (c) => {
    const code = s(c.expression ?? c.code, '<expression>');
    return { line: `Transform: ${truncate(code, 60)}`, preview: { kind: 'compute', details: { Language: 'JS', Expression: truncate(code, 240) } } };
  },
  'code-execute': (c) => {
    const code = s(c.code, '<code>');
    return { line: `Run code: ${truncate(code.split('\n')[0] ?? '', 60)}`, preview: { kind: 'compute', details: { Language: s(c.language, 'javascript'), Lines: String(code.split('\n').length) } } };
  },
  'file-write': (c) => ({
    line: `Write file ${truncate(s(c.path, '<path>'), 60)}`,
    preview: { kind: 'file', details: { Path: s(c.path, '—'), Mode: s(c.mode, 'overwrite') } },
  }),
  'file-store': (c) => ({
    line: `File store: ${s(c.operation, 'list')} ${s(c.path, '')}`.trim(),
    preview: { kind: 'file', details: { Operation: s(c.operation, 'list'), Path: s(c.path, '—') } },
  }),
  'trigger': (c) => {
    const kind = s(c.kind, 'manual');
    if (kind === 'cron') {
      const details: Record<string, string> = { Type: 'cron', Cron: s(c.cron, '—'), Timezone: s(c.timezone, 'Europe/London') };
      return { line: `Cron: ${s(c.cron, '—')}`, preview: { kind: 'trigger', details } };
    }
    if (kind === 'webhook') return { line: `Webhook trigger`, preview: { kind: 'trigger', details: { Type: 'webhook' } } };
    return { line: `Manual trigger`, preview: { kind: 'trigger', details: { Type: 'manual' } } };
  },
  'manual-trigger': () => ({ line: 'Manual trigger', preview: { kind: 'trigger', details: { Type: 'manual' } } }),
};

export function summarizeNode(
  type: string,
  config: Record<string, unknown>,
  fallbackDescription?: string,
): NodeSummary {
  const fn = summarizers[type];
  if (fn) {
    try { return fn(config); } catch { /* fall through */ }
  }
  return {
    line: fallbackDescription ?? type,
    preview: { kind: 'other', details: {} },
  };
}
