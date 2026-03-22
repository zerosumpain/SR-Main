import type { RequestHandler } from './$types';
import { validateAgentKey, unauthorized } from '$lib/agent/auth';
import { execInSandbox, getSandboxStatus } from '$lib/jkai/sandbox';

export const POST: RequestHandler = async ({ request }) => {
  if (!validateAgentKey(request)) return unauthorized();

  const body = await request.json();
  const { language, code } = body as { language: string; code: string };

  if (!code) {
    return Response.json({ error: 'code is required' }, { status: 400 });
  }

  // Check sandbox is running
  const status = await getSandboxStatus();
  if (!status.running) {
    return Response.json({ error: 'Sandbox is not running. Start it from /jkai/admin.' }, { status: 503 });
  }

  // Build command based on language
  let command: string;
  if (language === 'python') {
    command = `python3 << 'JKAI_EOF'\n${code}\nJKAI_EOF`;
  } else if (['javascript', 'typescript', 'node'].includes(language)) {
    command = `node -e ${JSON.stringify(code)}`;
  } else {
    command = code;
  }

  const result = await execInSandbox(command, 120000);

  return Response.json({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  });
};
