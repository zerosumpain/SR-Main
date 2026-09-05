import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parse } from '@babel/parser';
import { staticScan } from '$lib/security/authored-scan';
import type { ToolResult } from '$lib/workflows/site-tools/registry-internal';

export function validateHandler(code: string) {
  const scan = staticScan(code);
  if (!scan.ok) throw new Error(scan.violations.join('; '));
  parse(`async function handler(args, fetch, platform) {\n${code}\n}`, { sourceType: 'script' });
}

// Runs inside an empty network/mount/PID namespace. RPC exposes only brokered capabilities.
const WORKER = String.raw`
const readline = require('node:readline');
let serial = 0;
const pending = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const rpc = (kind, args) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); send({ id, kind, args }); });
let started = false;
readline.createInterface({ input: process.stdin }).on('line', async line => {
  const msg = JSON.parse(line);
  if (started) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); } return; }
  started = true;
  try {
    const fetch = async (url, options) => { const r = await rpc('fetch', { url: String(url), options }); return { ok: r.ok, status: r.status, headers: { get: key => key.toLowerCase() === 'content-type' ? r.contentType : null }, text: async () => r.text, json: async () => JSON.parse(r.text) }; };
    const platform = { call: (name, args) => rpc('call', { name, args }) };
    const fn = new (Object.getPrototypeOf(async function(){}).constructor)('args','fetch','platform',msg.code);
    send({ done: true, result: await fn(msg.args, fetch, platform) });
  } catch (e) { send({ done: true, result: { success: false, error: String(e.message || e) } }); }
});
`;

export function runAuthored(code: string, args: Record<string, unknown>, call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>, timeoutMs = 12000): Promise<ToolResult> {
  validateHandler(code);
  return new Promise(resolve => {
    const child = spawn('/usr/bin/bwrap', ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
      '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--chdir', '/tmp',
      '--dir', '/runtime', '--ro-bind', process.execPath, '/runtime/node',
      '--', '/runtime/node', '--max-old-space-size=96', '-e', WORKER], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let ended = false; let bytes = 0; let calls = 0; let errors = '';
    const finish = (result: ToolResult) => { if (ended) return; ended = true; clearTimeout(timer); child.kill('SIGKILL'); resolve(result); };
    const timer = setTimeout(() => finish({ success: false, error: 'Authored handler deadline exceeded; sandbox terminated' }), timeoutMs);
    child.on('error', () => finish({ success: false, error: 'Isolated handler runner unavailable (bubblewrap required)' }));
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(0, 1000); });
    child.on('exit', () => finish({ success: false, error: `Isolated handler stopped before returning: ${errors}` }));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) finish({ success: false, error: 'Handler output budget exceeded' }); });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', async line => {
      if (bytes > 2_000_000) return finish({ success: false, error: 'Handler output budget exceeded' });
      let msg: any; try { msg = JSON.parse(line); } catch { return finish({ success: false, error: 'Invalid sandbox response' }); }
      if (msg.done) return finish(msg.result && typeof msg.result.success === 'boolean' ? msg.result : { success: false, error: 'Handler must return { success, data?, error? }' });
      if (++calls > 40) return finish({ success: false, error: 'Handler capability call budget exceeded' });
      try {
        let result: unknown;
        if (msg.kind === 'call') result = await call(String(msg.args.name), msg.args.args ?? {});
        else if (msg.kind === 'fetch') {
          const opts = msg.args.options ?? {};
          if (opts.method && !['GET', 'HEAD'].includes(String(opts.method).toUpperCase())) throw new Error('Public fetch is read-only; compose an authorized platform tool for writes');
          if (opts.headers && Object.keys(opts.headers).some(k => /authorization|cookie|key|token/i.test(k))) throw new Error('Use platform.call for authenticated services');
          const { guardedFetch } = await import('$lib/workflows/site-tools/tools/apis');
          result = await guardedFetch(String(msg.args.url), { method: opts.method, headers: opts.headers });
        } else throw new Error('Unknown sandbox capability');
        if (!ended) child.stdin.write(JSON.stringify({ id: msg.id, result }) + '\n');
      } catch (err) { if (!ended) child.stdin.write(JSON.stringify({ id: msg.id, error: err instanceof Error ? err.message : String(err) }) + '\n'); }
    });
    child.stdin.write(JSON.stringify({ code, args }) + '\n');
  });
}
