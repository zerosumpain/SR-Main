import { env } from '$env/dynamic/private';

export function validateAgentKey(request: Request): boolean {
  const key = request.headers.get('x-agent-key');
  const expected = env.AGENT_API_KEY;
  if (!expected) return false;
  return key === expected;
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
