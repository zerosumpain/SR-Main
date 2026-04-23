/**
 * agent-harness.ts
 *
 * Spawns and drives `site-mapper-agent.py` inside jkai-sandbox. Exposes a
 * simple Promise-based command API (goto/observe/click/fill/submit/altcha/
 * extract/close) that both the site-mapper agent loop and the playbook v2
 * runner share.
 *
 * Communication: one-JSON-per-line over stdin/stdout of the Python process.
 * We write a command and read exactly one response line.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { execInSandbox, writeFileInSandbox, ensureSandboxRunning } from '$lib/jkai/sandbox';

const AGENT_PY_PATH = '/home/jkai/scraper-runtime/site-mapper-agent.py';

function runnerSource(relPath: string): string {
  const here = fileURLToPath(new URL(`./python/${relPath}`, import.meta.url));
  try { return readFileSync(here, 'utf8'); }
  catch { return readFileSync(join(process.cwd(), `src/lib/workflows/scraper/python/${relPath}`), 'utf8'); }
}

export interface AgentObservation {
  url: string;
  title: string;
  text_snippet: string;
  interactive: Array<Record<string, unknown>>;
}

export interface AgentHarness {
  goto(url: string): Promise<{ url: string; title: string }>;
  wait(opts: { selector?: string; ms?: number; timeoutMs?: number }): Promise<{ url: string }>;
  click(opts: { selector?: string; text?: string }): Promise<{ url: string; title: string }>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  submit(formSelector?: string): Promise<{ url: string; title: string }>;
  altcha(): Promise<{ solved: boolean }>;
  observe(): Promise<AgentObservation>;
  extract(rules: Array<Record<string, unknown>>): Promise<{ fields: Record<string, unknown> }>;
  close(): Promise<void>;
}

/** Spawn a Python agent session bound to `profile`. Call `close()` in a
 *  finally block — the returned harness keeps an in-process handle that
 *  times out idle sessions after 10 min of no commands. */
export async function startAgent(profile: string): Promise<AgentHarness> {
  await ensureSandboxRunning();
  await execInSandbox('mkdir -p /home/jkai/scraper-runtime');
  await writeFileInSandbox(AGENT_PY_PATH, runnerSource('site-mapper-agent.py'));

  const proc: ChildProcess = spawn('docker', [
    'exec', '-i', 'jkai-sandbox', 'python3', AGENT_PY_PATH,
  ]);

  let stdoutBuffer = '';
  const pending: Array<(line: string) => void> = [];
  const rejectAll: Array<(err: Error) => void> = [];

  proc.stdout!.setEncoding('utf8');
  proc.stdout!.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    for (;;) {
      const nl = stdoutBuffer.indexOf('\n');
      if (nl < 0) break;
      const line = stdoutBuffer.slice(0, nl);
      stdoutBuffer = stdoutBuffer.slice(nl + 1);
      const resolve = pending.shift();
      if (resolve) resolve(line);
    }
  });
  const stderrLines: string[] = [];
  proc.stderr!.setEncoding('utf8');
  proc.stderr!.on('data', (chunk: string) => {
    stderrLines.push(chunk);
    if (stderrLines.join('').length > 200_000) stderrLines.shift();
  });
  proc.on('exit', (code) => {
    const msg = new Error(
      `site-mapper-agent exited early (code=${code}). stderr: ${stderrLines.join('').slice(-800)}`,
    );
    while (rejectAll.length) (rejectAll.shift()!)(msg);
    while (pending.length) (pending.shift()!)(JSON.stringify({ ok: false, error: msg.message }));
  });

  function send(msg: Record<string, unknown>, timeoutMs = 45_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`agent command timed out after ${timeoutMs}ms: ${JSON.stringify(msg)}`));
      }, timeoutMs);
      pending.push((line) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.ok) resolve(parsed);
          else reject(new Error((parsed.error as string) ?? 'agent error'));
        } catch (e) {
          reject(e as Error);
        }
      });
      rejectAll.push(reject);
      proc.stdin!.write(JSON.stringify(msg) + '\n');
    });
  }

  // Init line: { profile } — agent reads this synchronously before starting.
  proc.stdin!.write(JSON.stringify({ profile }) + '\n');

  // Wait for the initial ready line.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('agent ready timed out')), 30_000);
    pending.push((line) => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.ok && parsed.ready) resolve();
        else reject(new Error((parsed.error as string) ?? parsed.fatal as string ?? 'agent failed to start'));
      } catch (e) { reject(e as Error); }
    });
  });

  return {
    async goto(url) {
      const r = await send({ cmd: 'goto', url });
      return { url: r.url as string, title: r.title as string };
    },
    async wait(o) {
      await send({ cmd: 'wait', ...o });
      return { url: '' };
    },
    async click(o) {
      const r = await send({ cmd: 'click', ...o }, 30_000);
      return { url: r.url as string, title: r.title as string };
    },
    async fill(selector, value) { await send({ cmd: 'fill', selector, value }); },
    async select(selector, value) { await send({ cmd: 'select', selector, value }); },
    async submit(formSelector) {
      const r = await send({ cmd: 'submit', formSelector }, 30_000);
      return { url: r.url as string, title: r.title as string };
    },
    async altcha() {
      const r = await send({ cmd: 'altcha' }, 60_000);
      return { solved: r.solved as boolean };
    },
    async observe() {
      const r = await send({ cmd: 'observe' });
      return {
        url: r.url as string,
        title: r.title as string,
        text_snippet: r.text_snippet as string,
        interactive: r.interactive as Array<Record<string, unknown>>,
      };
    },
    async extract(rules) {
      const r = await send({ cmd: 'extract', rules });
      return { fields: r.fields as Record<string, unknown> };
    },
    async close() {
      try { await send({ cmd: 'close' }, 5_000); } catch { /* process already gone */ }
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    },
  };
}
