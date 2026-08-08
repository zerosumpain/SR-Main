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

Two things genuinely don't exist and are rejected with a clear 400 rather than
silently ignored:

- **`tools` / `tool_choice`.** Codex brings its own toolset; you cannot hand it
  your function schemas and get `tool_calls` back. Tool-calling roles (the jkai
  orchestrator loop) stay on OpenRouter.
- **Embeddings.** No endpoint at all.

`temperature` and `max_tokens` are accepted and ignored — Codex exposes neither.

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
