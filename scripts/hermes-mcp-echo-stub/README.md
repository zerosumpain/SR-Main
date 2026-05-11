# hermes-mcp-echo-stub

Phase-0 standalone MCP server. One tool: `echo_tool`.

Used to verify the Hermes ↔ MCP bridge shape before wiring the 132-tool
SvelteKit MCP server in Phase 1.

## Run standalone (stdio)
    npx tsx server.ts

## Test
    npm test

## Wire into Hermes
See `~/.hermes-jkai/config.yaml` MCP block (Task 7).
This stub is removed once Phase 1 lands the real MCP server.
