import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  ensureContainerRunning,
  execInContainer,
  writeFileInContainer,
} from '$lib/jkai/sandbox';

/**
 * Run one code block from a chat reply, in the sandbox container.
 *
 * Contained lane only. `execInContainer` always goes through `docker exec`
 * whatever `JKAI_BUILDS_HOSTMODE` says, which is the whole point here: this
 * executes code an LLM wrote, and the production node process runs as a user in
 * the `docker` group, so a host-lane shell would be trivially root on the VPS.
 * See $lib/jkai/sandbox for the two-lane split — never swap these for the
 * `*InSandbox` primitives.
 *
 * Owner-gated by fall-through: /api/jkai/* has no bypass entry for this path,
 * so hooks.server.ts requires an owner session before the handler is reached.
 *
 * Deliberately NO credential injection. The `code-execute` workflow node hands
 * its sandbox OPENROUTER_API_KEY and friends because the owner authored that
 * node; here the code came out of a model, so an env full of live keys would be
 * an exfiltration path wearing a Run button.
 */

const TIMEOUT_MS = 20_000;
const MAX_CODE_CHARS = 400_000;
/** Enough to read a stack trace, short of pasting a database into the window. */
const MAX_OUTPUT_CHARS = 100_000;

type Runtime = 'python' | 'bash' | 'node';

const RUNTIMES: Record<Runtime, { ext: string; cmd: (f: string) => string }> = {
  python: { ext: 'py', cmd: (f) => `python3 ${f}` },
  bash: { ext: 'sh', cmd: (f) => `bash ${f}` },
  node: { ext: 'mjs', cmd: (f) => `node ${f}` },
};

function clip(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT_CHARS) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { code?: string; runtime?: string }
    | null;

  const code = body?.code;
  const runtime = body?.runtime as Runtime | undefined;

  if (typeof code !== 'string' || code.trim() === '') {
    return json({ error: 'code is required' }, { status: 400 });
  }
  if (code.length > MAX_CODE_CHARS) {
    return json({ error: `code exceeds ${MAX_CODE_CHARS} characters` }, { status: 413 });
  }
  if (!runtime || !(runtime in RUNTIMES)) {
    return json(
      { error: `runtime must be one of: ${Object.keys(RUNTIMES).join(', ')}` },
      { status: 400 },
    );
  }

  const spec = RUNTIMES[runtime];

  try {
    await ensureContainerRunning();
  } catch (err) {
    return json(
      { error: `Sandbox unavailable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 },
    );
  }

  // Written to a file rather than piped as a heredoc: the source can contain any
  // delimiter you might pick, and writeFileInContainer base64s it end to end.
  const runId = crypto.randomUUID();
  const dir = `/tmp/jkai-snippets/${runId}`;
  const file = `${dir}/snippet.${spec.ext}`;

  const started = Date.now();
  await execInContainer(`mkdir -p ${dir}`, 10_000);
  const write = await writeFileInContainer(file, code);
  if (write.exitCode !== 0) {
    return json({ error: `Could not stage the snippet: ${write.stderr}` }, { status: 500 });
  }

  const result = await execInContainer(`cd ${dir} && ${spec.cmd(file)}`, TIMEOUT_MS);
  const durationMs = Date.now() - started;

  // Best-effort tidy: a snippet that wrote files leaves them in its own run dir.
  void execInContainer(`rm -rf ${dir}`, 10_000).catch(() => {});

  const stdout = clip(result.stdout ?? '');
  const stderr = clip(result.stderr ?? '');

  return json({
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    exitCode: result.exitCode,
    durationMs,
    runtime,
  });
};
