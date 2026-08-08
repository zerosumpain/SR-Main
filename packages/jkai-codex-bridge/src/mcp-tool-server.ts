/**
 * A streamable-HTTP MCP server that exposes the CALLER's tool schemas to Codex.
 *
 * This is how the bridge gives Codex tool-calling despite the Codex SDK having
 * no `tools` parameter. Codex accepts external tools exactly one way — as MCP
 * servers (`codex mcp add --url`, or `mcp_servers.<name>.url` in config) — so
 * per request we publish the caller's `tools[]` here, point Codex at the URL,
 * and let it decide to call one.
 *
 * WE NEVER EXECUTE ANYTHING. In the OpenAI chat-completions contract the CALLER
 * owns the tool: it expects `tool_calls` handed back so it can run them itself.
 * So the moment Codex dispatches a call we capture the name and arguments from
 * the event stream, abort the turn, and answer the HTTP request with
 * `finish_reason: "tool_calls"`. `tools/call` below therefore returns a
 * placeholder that Codex should never get to act on — if it ever does, the
 * abort raced and the text says so rather than pretending to be a result.
 *
 * Scoped per request by an unguessable path segment: the endpoint is loopback,
 * but the schemas can describe internal capabilities, so another local process
 * should not be able to enumerate them by guessing.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** An OpenAI-format tool as the caller sends it. */
export interface OpenAiTool {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

interface Registration {
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  createdAt: number;
}

/** Registrations live only for the life of one request; this is the leak guard
 *  for the case where a request dies before it can deregister. */
const MAX_AGE_MS = 15 * 60_000;

const registry = new Map<string, Registration>();

function sweep(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, reg] of registry) {
    if (reg.createdAt < cutoff) registry.delete(id);
  }
}

/** Translate OpenAI tool schemas into MCP tool definitions. Tools without a
 *  usable name are dropped rather than published nameless — Codex would list
 *  them and never be able to call them. */
export function toMcpTools(tools: OpenAiTool[]): Registration['tools'] {
  return tools
    .map((t) => {
      const fn = t?.function;
      const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
      if (!name) return null;
      return {
        name,
        description: typeof fn?.description === 'string' ? fn.description : '',
        // MCP calls it inputSchema; OpenAI calls it parameters. Same JSON Schema.
        inputSchema: fn?.parameters ?? { type: 'object', properties: {} },
      };
    })
    .filter((t): t is Registration['tools'][number] => t !== null);
}

/** Publish a caller's tools and get back the path Codex should connect to. */
export function registerTools(tools: OpenAiTool[]): { id: string; path: string } {
  sweep();
  const id = randomUUID();
  registry.set(id, { tools: toMcpTools(tools), createdAt: Date.now() });
  return { id, path: `/mcp/${id}` };
}

export function unregisterTools(id: string): void {
  registry.delete(id);
}

export function isMcpPath(pathname: string): boolean {
  return pathname.startsWith('/mcp/');
}

/**
 * Handle one MCP JSON-RPC request. Returns true if it was an MCP path (handled
 * or rejected), false if the caller should keep routing.
 *
 * Deliberately hand-rolled rather than pulling in @modelcontextprotocol/sdk:
 * the surface Codex needs is three methods, and the bridge's whole value is
 * being a small, auditable thing between untrusted prompts and a subscription.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!isMcpPath(pathname)) return false;

  const id = pathname.slice('/mcp/'.length).split('/')[0];
  const reg = registry.get(id);
  if (!reg) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown tool registration' }));
    return true;
  }

  if (req.method !== 'POST') {
    // Streamable HTTP also defines GET for server-initiated streams; we never
    // push, so decline rather than hold a socket open.
    res.writeHead(405, { allow: 'POST' }).end();
    return true;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    res.writeHead(400).end();
    return true;
  }

  const send = (result: unknown, headers: Record<string, string> = {}) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, result });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      ...headers,
    });
    res.end(body);
  };

  switch (msg.method) {
    case 'initialize':
      return (
        send(
          {
            protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'jkai-caller-tools', version: '1.0.0' },
          },
          // Streamable HTTP expects a session id it can echo back.
          { 'Mcp-Session-Id': id },
        ),
        true
      );

    case 'tools/list':
      return (send({ tools: reg.tools }), true);

    case 'tools/call':
      // Reached only if the abort lost a race. Say so plainly — a placeholder
      // that reads like data would have the model answer from fiction.
      return (
        send({
          content: [
            {
              type: 'text',
              text: 'This tool is executed by the calling application, not here. The call has been handed back to it.',
            },
          ],
          isError: true,
        }),
        true
      );

    default:
      if (String(msg.method ?? '').startsWith('notifications/')) {
        res.writeHead(202).end();
        return true;
      }
      return (send({}), true);
  }
}

/** Test seam. */
export function _registrySize(): number {
  return registry.size;
}
