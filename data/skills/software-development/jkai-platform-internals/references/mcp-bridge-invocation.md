# MCP Bridge Invocation from Shell / Curl

Recipe for calling jkai site-tools via the MCP JSON-RPC endpoint when native tools aren't available in the current session.

## Endpoint

```
POST /api/mcp/local
```

Available on:
- **Homeserv**: `http://localhost:5173/api/mcp/local` (may return 500 if local app is broken or mid-build)
- **Production**: `https://strangeramblings.com/api/mcp/local` (reliable fallback)

## Auth

`tools/call` requires `Authorization: Bearer <HERMES_BRIDGE_SECRET>`. Read the secret from `~/strange_rambling_svelte/.env`:

```bash
SECRET=$(grep HERMES_BRIDGE_SECRET ~/strange_rambling_svelte/.env | cut -d= -f2-)
```

Note: `terminal()` tool output masks the secret as `***`, but the shell variable holds the real value.

Other JSON-RPC methods (`initialize`, `tools/list`, `ping`) are unauthenticated.

## Wire Format

JSON-RPC 2.0 over HTTP POST:

```bash
curl -s -X POST 'https://strangeramblings.com/api/mcp/local' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SECRET" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/call",
    "params": {
      "name": "<tool_name>",
      "arguments": { ... }
    }
  }'
```

## Response Shape

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "result": {
    "content": [
      { "type": "text", "text": "<double-JSON-encoded result string>" }
    ]
  }
}
```

**Critical: the `text` field is double-JSON-encoded.** Parse it twice to get the actual data:

```python
import json
raw = json.loads(response)
text = raw["result"]["content"][0]["text"]  # still a JSON string
data = json.loads(text)                      # now the actual object
```

## Examples

### List available tools

```bash
curl -s -X POST 'https://strangeramblings.com/api/mcp/local' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
```

### Health tools

```bash
# Sleep analysis
curl -s -X POST 'https://strangeramblings.com/api/mcp/local' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SECRET" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"health_sleep","arguments":{}}}'

# Readiness
curl -s -X POST 'https://strangeramblings.com/api/mcp/local' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $SECRET" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"health_readiness","arguments":{}}}'
```

## Pitfalls

- **Homeserv returning 500**: The local dev server (port 5173) can enter a broken state (e.g. mid-build, stale `.svelte-kit/output`). Go to production instead — the data is the same.
- **`execute_code` can't read `.env` secrets**: The `read_file()` tool returns masked values for secrets. Use a shell command (`grep` + `cut`) inside `terminal()` to extract the real value into a shell variable.
- **Double-JSON encoding**: The tool result `text` field is a JSON string containing another JSON string. Forgetting to parse twice will give you a string, not an object.
- **No session persistence**: Each call is stateless. There's no Mcp-Session-Id or server-initiated SSE. This is by design (see `+server.ts` header comment).
