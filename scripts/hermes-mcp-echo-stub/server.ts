#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const ECHO_TOOL: Tool = {
  name: 'echo_tool',
  description: 'Echoes the provided message back. Phase-0 stub for verifying the Hermes-MCP bridge.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'String to echo back verbatim.' },
      bridgeToken: { type: 'string', description: 'HMAC bridge token (verified in Phase 1; ignored here).' },
    },
    required: ['message'],
  },
};

export async function listTools(): Promise<Tool[]> {
  return [ECHO_TOOL];
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (name !== 'echo_tool') throw new Error(`unknown tool: ${name}`);
  const message = String(args.message ?? '');
  return { content: [{ type: 'text', text: message }] };
}

async function main() {
  const server = new Server(
    { name: 'hermes-mcp-echo-stub', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return await handleToolCall(req.params.name, req.params.arguments ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
