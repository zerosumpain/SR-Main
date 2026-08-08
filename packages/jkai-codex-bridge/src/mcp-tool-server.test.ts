import { describe, it, expect } from 'vitest';
import { toMcpTools, registerTools, unregisterTools, isMcpPath } from './mcp-tool-server';

describe('toMcpTools', () => {
  it('maps OpenAI function schemas to MCP tool definitions', () => {
    // OpenAI calls it `parameters`, MCP calls it `inputSchema`; same JSON Schema.
    expect(
      toMcpTools([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Weather for a city',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ]),
    ).toEqual([
      {
        name: 'get_weather',
        description: 'Weather for a city',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);
  });

  it('drops nameless tools rather than publishing something uncallable', () => {
    // Codex would list them and then have no way to invoke them, which reads
    // to the model as a broken tool rather than an absent one.
    expect(toMcpTools([{ type: 'function', function: { description: 'no name' } }])).toEqual([]);
    expect(toMcpTools([{ type: 'function', function: { name: '   ' } }])).toEqual([]);
  });

  it('defaults a missing parameter schema to an empty object schema', () => {
    const [tool] = toMcpTools([{ type: 'function', function: { name: 'ping' } }]);
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('registration lifecycle', () => {
  it('issues an unguessable per-request path', () => {
    const a = registerTools([{ type: 'function', function: { name: 'x' } }]);
    const b = registerTools([{ type: 'function', function: { name: 'x' } }]);
    expect(a.path).not.toBe(b.path);
    // A guessable path would let any local process enumerate tool schemas,
    // which can describe internal capabilities.
    expect(a.path).toMatch(/^\/mcp\/[0-9a-f-]{36}$/);
    unregisterTools(a.id);
    unregisterTools(b.id);
  });

  it('recognises its own paths and nothing else', () => {
    expect(isMcpPath('/mcp/abc')).toBe(true);
    expect(isMcpPath('/v1/chat/completions')).toBe(false);
    expect(isMcpPath('/health')).toBe(false);
  });
});
