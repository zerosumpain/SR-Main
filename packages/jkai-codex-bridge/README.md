# jkai-codex-bridge

An OpenAI-compatible HTTP face over the Codex CLI, so site LLM traffic can bill
to John's **ChatGPT Pro subscription** instead of per-token OpenRouter credit.

## Why this exists

There is no OpenAI HTTP API that accepts a ChatGPT subscription. `api.openai.com`
takes platform API keys only, billed separately from the subscription. The
subscription is honoured **only** by Codex's own clients — the `codex` CLI,
`@openai/codex-sdk` and `codex app-server` — which authenticate with the OAuth
token in `~/.codex/auth.json`.

So the only way to spend the subscription programmatically is to drive OpenAI's
own client locally. This sidecar does that and puts a `/v1/chat/completions`
face on it, which buys two things a direct SDK import inside SvelteKit would
not:

1. **No call site changes.** `$lib/jkai/llm-client` swaps a base URL and all
   ~160 call sites are unchanged.
2. **Hermes can use it too.** Hermes is a separate Python runtime; it reaches
   providers by `base_url`. Pointing it at this port is a config edit, and it is
   the only route by which the /jkai *chat* turn can use Codex at all.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | liveness, `codex --version`, and whether `codex login` has been done |
| `GET /v1/models` | the static Codex catalogue, OpenAI list shape |
| `POST /v1/chat/completions` | non-streaming and SSE streaming |

Everything else 404s. This is not a general proxy.

## What maps, and what doesn't

Codex is an **agent runtime**, not a chat-completions endpoint. Most of the wire
format maps cleanly:

- `messages[]` → one prompt (system messages hoisted; see `src/messages.ts`)
- `stream: true` → SSE, fed by the SDK's item-level updates diffed into deltas
- `response_format: json_schema` → the SDK's `outputSchema`
- `reasoning_effort` → `modelReasoningEffort`
- usage → real `prompt_tokens` / `completion_tokens` / reasoning / cached counts

- `tools` / `tool_choice` → published as a per-request MCP server (below)

One thing genuinely doesn't exist: **embeddings**. No endpoint at all, so those
paths stay on OpenRouter.

`temperature` and `max_tokens` are accepted and ignored — Codex exposes neither.

## Tool-calling

Codex's SDK has no `tools` parameter, so for a while the bridge rejected tool
schemas outright and Codex could not serve tool-calling roles. That was a limit
of how the bridge drove Codex, not of Codex: **external tools reach Codex as MCP
servers**, and it accepts streamable-HTTP ones (`codex mcp add --url`).

So when a request carries `tools[]`:

1. the schemas are published at `/mcp/<uuid>` on this bridge (see
   `src/mcp-tool-server.ts`), on an unguessable path — the endpoint is loopback,
   but schemas can describe internal capabilities;
2. Codex is pointed at that URL via `mcp_servers.caller.url`;
3. the moment Codex dispatches a call, the runner captures the name and
   arguments from the event stream, aborts the turn, and the HTTP layer answers
   `finish_reason: "tool_calls"`.

**The bridge never executes a tool.** In the chat-completions contract the
caller owns them and expects the call handed back. `tools/call` therefore
returns an error string saying so, in case the abort ever loses the race — a
plausible-looking placeholder would have the model answer from fiction.

A 400 ms grace window after the first capture collects siblings, so a model that
wants three lookups at once returns three `tool_calls` in one response instead of
being serialised into three fresh Codex starts.

Multi-turn works because the transcript carries the request and the result:
`messagesToPrompt` renders assistant `tool_calls` and `role: "tool"` results
explicitly. Without the request half, the model sees a result with nothing to
attach it to and re-requests the same call, looping the caller.

**Measured:** first tool call ~10 s, follow-up turn ~3 s. Each turn is a fresh
Codex process, so a long tool chain is materially slower than OpenRouter
(~1–2 s/call). Capability is no longer the trade-off; latency is.

## The agent is pinned shut

`src/codex-runner.ts` hardcodes `read-only` sandbox, `never` approvals, no
network, no web search, and an empty working directory, with **no per-request
override**. Prompts reaching this bridge include text the site did not author
(scraped pages, Gmail bodies, research documents), and a prompt injection into
an agent with workspace-write and network access would be a remote-code-execution
path onto the box. If an agentic Codex run is ever genuinely wanted, it belongs
behind its own explicitly-authorised endpoint.

The listener is **loopback-only** for the same reason: the bridge has no auth of
its own, so anything that can reach the port can spend the subscription.

## Running it

```sh
# 1. Build
node packages/jkai-codex-bridge/build.mjs

# 2. Authenticate, once per host (interactive; --device-auth prints a URL + code)
codex login --device-auth
codex login status          # exits 0 when logged in

# 3. Run
node packages/jkai-codex-bridge/dist/start.js
```

Then in the site, `/admin/ai/models` → **Codex subscription** → *Enable Codex
models*. That toggle refuses to switch on unless `/health` reports ready, so the
pickers never offer a model that will fail at call time.

### Env

| Var | Default | Notes |
|---|---|---|
| `CODEX_BRIDGE_PORT` | `5207` | |
| `CODEX_BRIDGE_HOST` | `127.0.0.1` | leave it on loopback |
| `CODEX_BRIDGE_CONCURRENCY` | `3` | caps real `codex` subprocesses |
| `CODEX_BRIDGE_TIMEOUT_MS` | `600000` | backstop against a wedged subprocess |
| `CODEX_BRIDGE_WORKDIR` | tmpdir | the agent's empty scratch dir |

The site finds it via `CODEX_BRIDGE_URL` (default `http://127.0.0.1:5207`),
read in `$lib/server/models/settings`.

## Deploying

`scripts/ci-deploy.sh` does **not** sync `packages/` — see
`scripts/deploy-codex-bridge.sh`, which mirrors `deploy-builder.sh`: build,
rsync the bundle + unit, install the systemd unit, restart, health-check. It
distinguishes "not running" from "running but not logged in", because the second
is the expected state on a first deploy and the fix is a login, not a redeploy.

## Cost

Codex calls cost **no cash** but do spend a finite weekly / 5-hourly quota — the
same one the Codex CLI uses interactively. `priceFor()` returns `null` for the
provider rather than `0`: a fabricated zero would read as "this work was free"
when the true statement is "this work cost quota". `isSubscriptionProvider()`
lets the cost UIs tell that null apart from an unknown-model null.

### The ~9,700-token floor (measured 2026-08-08)

**Every Codex call carries roughly 9,700 input tokens of overhead**, whatever
you asked. A 9-token "capital of Norway?" prompt billed 9,531 input tokens; a
20-token one billed 9,762. That is Codex's own agent instructions, prepended
before your prompt on every turn.

It is not reducible from here. Disabling the built-in tools
(`include_apply_patch_tool`, `include_plan_tool`, `tools.web_search`) was
measured at **exactly zero** saving — the bulk is base instructions, not tool
schemas — and `cached_tokens` came back 0 across separate threads, so there is
no prompt-cache relief either.

What follows from that:

- **Good fit:** chat turns, research, summarising a document, anything where the
  real prompt is already substantial. The floor disappears into the noise.
- **Bad fit:** high-frequency small calls — intel entity extraction, title
  generation, connector probes. A 200-token classification costs the same 9,700
  as a full document, so routing those to Codex would burn weekly quota on
  overhead. They are already pinned to their own cheap OpenRouter models
  (`DEFAULT_EXTRACTION_MODEL_ID`), and should stay there.

This is a second, independent reason Codex is refused as the *site default* —
the default is what every unpinned background task falls back to.
