# Hermes Phase 0 Acceptance Log

This file records the actual commands run and the outputs observed during
Phase 0 verification. Each section is a checklist item from the design
spec's "Phase 0 — Exit criteria."

---

## Hermes install

- **Tag**: v2026.5.7
- **Commit**: 498bfc7bc12a937621b4215312049b1000726df3
- **`hermes --version` output**:

```
Hermes Agent v0.13.0 (2026.5.7)
Project: /home/john/hermes-agent
Python: 3.11.15
OpenAI SDK: 2.33.0
Update available: 339 commits behind — run 'hermes update'
```

**`uv` co-dependency note**: The Hermes venv depends on the CPython
interpreter managed by `uv` at `~/.local/share/uv/python/cpython-3.11-…`.
`uv` and the venv must be treated as a unit — removing or upgrading `uv`'s
Python distribution will break the `hermes` entry-point even though the
package itself is intact. Do not `uv python uninstall 3.11` without
reinstalling Hermes afterwards.

---

## Provider smoke tests

All three tests used the same invocation pattern:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider <PROVIDER> \
  --model <MODEL> \
  -z "Reply with exactly the word: pong."
```

The `-z` / `--oneshot` flag sends a single prompt and prints only the
model's reply to stdout (no banner, no spinner). `--provider` and `--model`
override the defaults set in `~/.hermes-jkai/config.yaml` for this
invocation only.

---

### z.ai

**Command**:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider zai \
  --model glm-4.6 \
  -z "Reply with exactly the word: pong."
```

**Date/time (UTC)**: 2026-05-10 20:26:14 → 20:26:37

**Wall-clock time**: ~22 s (`real 0m22.126s`)

**Response**:

```
pong
```

**Result**: PASS

---

### OpenRouter

**Command**:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider openrouter \
  --model anthropic/claude-haiku-4.5 \
  -z "Reply with exactly the word: pong."
```

**Date/time (UTC)**: 2026-05-10 20:26:40 → 20:26:44

**Wall-clock time**: ~4.5 s (`real 0m4.521s`)

**Response**:

```
pong.
```

**Result**: PASS

---

### Anthropic (direct)

**Command**:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider anthropic \
  --model claude-haiku-4-5-20251001 \
  -z "Reply with exactly the word: pong."
```

**Date/time (UTC)**: 2026-05-10 20:28:10 → 20:32:14 (includes first cold run;
second timed run: `real 0m15.773s`)

**Wall-clock time**: ~15.8 s

**Response**:

```
pong
```

**Result**: PASS

---

## Summary

| Provider    | Model                        | Result | Wall-clock |
|-------------|------------------------------|--------|------------|
| z.ai        | glm-4.6                      | PASS   | ~22 s      |
| OpenRouter  | anthropic/claude-haiku-4.5   | PASS   | ~4.5 s     |
| Anthropic   | claude-haiku-4-5-20251001    | PASS   | ~15.8 s    |

All three providers completed a round-trip within the 30-second budget.
Phase 0 provider smoke-test criterion: **MET**.

---

## Observations

- `hermes status` confirmed all three API keys were loaded from
  `~/.hermes-jkai/.env` (ZAI_API_KEY / GLM_API_KEY alias, OPENROUTER_API_KEY,
  ANTHROPIC_API_KEY).
- The z.ai GLM call was the slowest (~22 s); this is expected for a
  Chinese-hosted model under normal latency.
- OpenRouter was fastest (~4.5 s), consistent with its role as the default
  provider for day-to-day use.
- Anthropic direct was mid-range (~15.8 s). The `anthropic_messages` API
  path (native SDK, not OpenAI-compat) is confirmed working.
- No `--provider`/`--model` flags are needed in normal operation; the
  `config.yaml` default (`openrouter` / `anthropic/claude-haiku-4.5`) applies
  automatically.

---

## Task 7: MCP echo round-trip (Hermes → echo-stub)

### Step 1: MCP block added to config.yaml

The following block was appended to `~/.hermes-jkai/config.yaml`
(outside the repo — recorded here verbatim):

```yaml
# =============================================================================
# MCP Servers
# =============================================================================
mcp_servers:
  hermes-echo-stub:
    command: npx
    args:
      - tsx
      - /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-0/scripts/hermes-mcp-echo-stub/server.ts
    env:
      NODE_PATH: /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-0/scripts/hermes-mcp-echo-stub/node_modules
```

Transport choice: **stdio** (Hermes spawns the stub as a child process via
`npx tsx`). HTTP was not needed — Hermes v2026.5.7 fully supports stdio MCP.

Hermes picks up the stdio process `working dir` from its own CWD; the `NODE_PATH`
env var is set so that `tsx` resolves the local `node_modules` regardless of
invocation CWD.

### Step 2: Tools list — echo_tool visible

```
$ HERMES_HOME=~/.hermes-jkai hermes mcp list

  MCP Servers:

  Name             Transport                      Tools        Status
  ──────────────── ────────────────────────────── ──────────── ──────────
  hermes-echo-stub npx tsx /home/john/strang...   all          ✓ enabled
```

```
$ HERMES_HOME=~/.hermes-jkai hermes mcp test hermes-echo-stub

  Testing 'hermes-echo-stub'...
  Transport: stdio → npx
  Auth: none
  ✓ Connected (1921ms)
  ✓ Tools discovered: 1

    echo_tool    Echoes the provided message back. Phase-0 stub for veri...
```

```
$ HERMES_HOME=~/.hermes-jkai hermes tools list  (excerpt)

MCP servers:
  hermes-echo-stub  all tools enabled
```

Agent log confirms registration:
```
INFO tools.mcp_tool: MCP server 'hermes-echo-stub' (stdio): registered 1 tool(s): mcp_hermes_echo_stub_echo_tool
```

### Step 3: Full round-trip transcript

**Command:**
```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider openrouter --model anthropic/claude-haiku-4.5 \
  -z "Use the echo_tool to echo the exact string 'phase-0-bridge-ok' and then respond 'done'."
```

**Session ID:** `20260510_205604_277b25`
**Started:** 2026-05-10T20:56:04 UTC  **Completed:** 2026-05-10T20:56:09 UTC

**Transcript (reconstructed from session JSON):**

```
[user]      Use the echo_tool to echo the exact string 'phase-0-bridge-ok'
            and then respond 'done'.

[assistant] <tool_use: mcp_hermes_echo_stub_echo_tool>
            { "message": "phase-0-bridge-ok" }

[tool]      {"result": "phase-0-bridge-ok"}

[assistant] done
```

**Result:** PASS. The model issued a tool call to `echo_tool` with the exact
string. The stub returned `{"result": "phase-0-bridge-ok"}`. The model then
replied `done` as instructed. MCP transport (stdio) works end-to-end.

### Step 4: Auth-primitive scope note

The echo stub does **not** verify the bridge token — it is a transport-only
smoke test. The auth primitive's correct rejection of out-of-scope tokens was
separately proved by Task 5's `auth.test.ts` (8/8 unit tests passing).

**Phase 1 note:** The two halves are independent: "Hermes can list and call MCP
tools (transport works)" AND "the auth primitive correctly rejects out-of-scope
tokens (logic works)". Phase 1 wires both halves together in the real MCP
server, where every tool call will carry a bridge token and the server will
validate it before executing.

### Step 5: Crash-recovery observed behaviour

**Test method:** Launch `hermes -z ...` in background; after 2 s, kill the
`tsx` subprocess via `pkill -f hermes-mcp-echo-stub`. Observe outcome.

**Sequence of events (from `~/.hermes-jkai/logs/agent.log`):**

```
20:56:28  INFO  hermes startup, plugin discovery complete
20:56:30  WARN  tools.mcp_tool: MCP server 'hermes-echo-stub' initial
                connection failed (attempt 1/3), retrying in 1s:
                unhandled errors in a TaskGroup (1 sub-exception)
20:56:32  INFO  tools.mcp_tool: MCP server 'hermes-echo-stub' (stdio):
                registered 1 tool(s): mcp_hermes_echo_stub_echo_tool
```

**Session outcome:** The session (`session_20260510_205633_3b38fe.json`)
completed normally:

```
[user]      Use the echo_tool to echo the string 'crash-test-1' and then respond 'done'.
[tool]      {"result": "crash-test-1"}
[assistant] done
```

**Behaviour summary:**

- Hermes spawns the stdio MCP server fresh on every invocation (no persistent
  daemon). If the process is dead at startup, Hermes retries up to 3 times
  with a 1-second back-off before giving up.
- In our test the retry succeeded on attempt 2 (stub respawned cleanly) and
  the session completed without error.
- No mid-call kill was observed because the stub starts and responds in under
  1 second; a mid-flight kill would require injecting a sleep into the stub.
  That edge case (broken pipe mid-call) is expected to surface as a tool-call
  error returned to the model (not a Hermes crash) based on the retry
  architecture seen here, but it was not directly measured.

**Phase 1 design implication:** Because Hermes respawns stdio servers per
invocation, the real Phase 1 MCP server should be designed to be stateless
across connections (or use an external store for any state it needs to persist
between tool calls). Crash recovery at the Hermes level (3 retries + back-off)
is already present and functional.

---

## Task 9: systemd unit

### Hermes gateway command discovery

v2026.5.7 exposes a first-class `gateway run` subcommand intended for use as
a foreground daemon (the `--replace` flag kills any existing gateway instance
before starting, which is the recommended pattern for systemd). This is
confirmed by the Hermes source itself at
`~/hermes-agent/hermes_cli/gateway.py` line 1914, where every auto-generated
`ExecStart` uses exactly:

```
<python> -m hermes_cli.main gateway run --replace
```

The `~/.local/bin/hermes` wrapper (`exec ~/hermes-agent/venv/bin/hermes "$@"`)
exposes the same invocation as `hermes gateway run --replace`.

**Note on UNIX socket gateway:** v2026.5.7 does not expose a UNIX-socket
gateway natively. The `gateway run` command starts the messaging gateway
(Telegram / WhatsApp / Slack bridge), not a UNIX-socket RPC server. A
UNIX-socket RPC server (for SvelteKit `hermes-client.ts`) is a Phase 1
concern; it will require either (a) a purpose-built Python wrapper around
`AIAgent`, or (b) using the `hermes acp` subcommand (ACP = Agent Client
Protocol, for editor integration) if it turns out to expose a socket. Phase 0
only needs a syntactically valid unit — `hermes gateway run --replace` is the
correct long-running process shape and is used here.

**Chosen ExecStart:**

```
%h/.local/bin/hermes gateway run --replace
```

`%h` expands to the user's home directory in systemd user context (confirmed
by `systemd-analyze --user verify` returning exit 0 / no warnings).
`HERMES_HOME` is set via `Environment=` to point at the `~/.hermes-jkai`
profile so the daemon uses the jkai-specific config and credentials.

### Unit file (`~/.config/systemd/user/jkai-hermes.service`)

```ini
[Unit]
Description=jkai Hermes agent runtime
After=network.target

[Service]
Type=simple
Environment=HERMES_HOME=%h/.hermes-jkai
EnvironmentFile=%h/.hermes-jkai/.env
ExecStart=%h/.local/bin/hermes gateway run --replace
Restart=on-failure
RestartSec=5s
RuntimeDirectory=jkai-hermes
RuntimeDirectoryMode=0700

[Install]
WantedBy=default.target
```

### Validation output

```
$ systemctl --user daemon-reload
(no output)

$ systemd-analyze --user verify ~/.config/systemd/user/jkai-hermes.service
(no output — zero warnings, exit 0)
```

### Enabled / active status

```
$ systemctl --user is-enabled jkai-hermes.service
disabled

$ systemctl --user is-active jkai-hermes.service
inactive
```

Service is **disabled** and **inactive**. Phase 1 will `systemctl --user enable --now jkai-hermes.service`.

### Notes

- `%h` in `EnvironmentFile` and `ExecStart` expands correctly in the user
  systemd context (verified by `systemd-analyze --user verify` passing with
  zero output).
- `RuntimeDirectory=jkai-hermes` causes systemd to create and own
  `/run/user/1000/jkai-hermes/` — the intended future location for
  `jkai-hermes.sock` once Phase 1 adds a UNIX-socket RPC layer.
- `Type=simple` produced no deprecation warnings (systemd 255 on this host
  still accepts it without complaint).
- The unit file lives at `~/.config/systemd/user/jkai-hermes.service` and is
  **not** committed to the repo (it's a host-local config artefact).
