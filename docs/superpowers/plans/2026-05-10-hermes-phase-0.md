# Hermes Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Hermes Agent standalone on homeserv, create the `jkai` profile, configure providers, prove the MCP-with-bridge-token bridge works end-to-end with a stub server, and decide whether Hermes' session backend can plug Postgres without forking.

**Architecture:** Hermes runs as a Python process on homeserv. Profile lives at `~/.hermes-jkai/`. A standalone Node MCP echo-stub at `scripts/hermes-mcp-echo-stub/` proves the bridge shape. Bridge-token HMAC primitive lives in `src/lib/mcp/auth.ts` (its eventual home). systemd unit is created but **not enabled** — Phase 1 turns it on. No SvelteKit code paths are wired to Hermes yet.

**Tech Stack:** Python 3.11+ (Hermes), Node 22 / Bun (MCP echo stub, TS auth primitive), `@modelcontextprotocol/sdk` (MCP TS SDK), Vitest (TS tests), `pytest` (only if needed), bash + systemd (homeserv config).

**Spec reference:** `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md`

---

## File Structure

| Path | Purpose | Created/Modified |
|---|---|---|
| `~/hermes-agent/` | Hermes source tree (cloned, pip-installed editable) | New (outside repo) |
| `~/.hermes-jkai/` | Hermes profile dir (HERMES_HOME) | New (outside repo) |
| `~/.hermes-jkai/.hermes.md` | Profile config: providers, default model, MCP server URL | New |
| `~/.hermes-jkai/SOUL.md` | Assistant identity prompt | New |
| `~/.hermes-jkai/USER.md` | Facts about John | New |
| `~/.hermes-jkai/MEMORY.md` | Empty initially; Hermes-managed thereafter | New |
| `~/.config/systemd/user/jkai-hermes.service` | systemd user unit — created, **not enabled** | New |
| `scripts/hermes-mcp-echo-stub/package.json` | Standalone MCP stub manifest | New |
| `scripts/hermes-mcp-echo-stub/server.ts` | One-tool MCP server (`echo_tool`) | New |
| `scripts/hermes-mcp-echo-stub/server.test.ts` | Vitest tests for the stub | New |
| `scripts/hermes-mcp-echo-stub/README.md` | How to run, how Hermes invokes it | New |
| `src/lib/mcp/auth.ts` | Bridge-token HMAC primitive (sign/verify/scope) | New |
| `src/lib/mcp/auth.test.ts` | Vitest tests | New |
| `docs/superpowers/research/2026-05-10-hermes-session-backend.md` | Investigation memo (option-D check) | New |
| `docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md` | Phase 0 acceptance log (proof commands ran, outputs) | New |

---

## Task 1: Install Hermes Agent on homeserv

**Files:**
- Create: `~/hermes-agent/` (git clone)
- Create: `~/hermes-agent/.hermes-pin` (text file recording the pinned tag/commit)

- [ ] **Step 1: Confirm prerequisites are present**

Run:
```bash
python3 --version  # expect >= 3.11
node --version     # expect >= 20
which ripgrep      # expect a path
which ffmpeg       # expect a path
```

Expected: each command returns success; record versions in the acceptance log later. If any are missing, install via `apt` before continuing.

- [ ] **Step 2: Clone Hermes to a known location**

Run:
```bash
git clone https://github.com/nousresearch/hermes-agent ~/hermes-agent
cd ~/hermes-agent
git tag --sort=-creatordate | head -5
```

Expected: clone succeeds; the tag list shows recent versions. **Pick the latest stable tag** (not a release candidate). For this plan, call it `<HERMES_TAG>`.

- [ ] **Step 3: Pin to that tag**

Run:
```bash
cd ~/hermes-agent
git checkout <HERMES_TAG>
echo "<HERMES_TAG>" > ~/hermes-agent/.hermes-pin
git rev-parse HEAD >> ~/hermes-agent/.hermes-pin
```

Expected: `~/hermes-agent/.hermes-pin` contains the tag and the commit SHA.

- [ ] **Step 4: Install Hermes editable**

Run:
```bash
cd ~/hermes-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
which hermes  # expect ~/hermes-agent/.venv/bin/hermes
hermes --version
```

Expected: `hermes --version` prints a version matching `<HERMES_TAG>`.

- [ ] **Step 5: Make `hermes` available without sourcing the venv**

Add a wrapper at `~/.local/bin/hermes` so the CLI works from any shell:

Create `~/.local/bin/hermes`:
```bash
#!/usr/bin/env bash
exec ~/hermes-agent/.venv/bin/hermes "$@"
```

Run:
```bash
chmod +x ~/.local/bin/hermes
hash -r
hermes --version  # must work in a fresh shell
```

Expected: same output as Step 4 in a new terminal.

- [ ] **Step 6: Commit nothing yet**

Hermes lives outside the repo — no commit. Continue to Task 2.

---

## Task 2: Create the `jkai` Hermes profile

**Files:**
- Create: `~/.hermes-jkai/.hermes.md`
- Create: `~/.hermes-jkai/SOUL.md`
- Create: `~/.hermes-jkai/USER.md`
- Create: `~/.hermes-jkai/MEMORY.md` (empty — Hermes-managed thereafter)

- [ ] **Step 1: Create the profile directory with restrictive perms**

Run:
```bash
mkdir -p ~/.hermes-jkai
chmod 700 ~/.hermes-jkai
```

Expected: directory exists; `ls -ld ~/.hermes-jkai` shows `drwx------`.

- [ ] **Step 2: Write `SOUL.md`**

Create `~/.hermes-jkai/SOUL.md`:
```markdown
# Identity

You are jkai's engine — the agent runtime behind the strange_rambling_svelte
personal site at strangeramblings.com.

You act through MCP tools. You never expose Hermes-specific terminology
("session", "skill", "AIAgent", "compression") in user-facing strings — those
are internal. User-visible strings use jkai vocabulary: "build", "iteration",
"pinned note", "pending message", "workflow", "node".

You are not a chat assistant. Users do not see you directly. The SvelteKit
UI at /jkai, /jkai/builds, /jkai/canvas, /jkai/curate is the only surface
they interact with. Your job is to drive those flows correctly.

When in doubt about scope or destructive action, decline and ask for
explicit user approval via the appropriate MCP tool.
```

- [ ] **Step 3: Write `USER.md` seeded from existing memory**

Create `~/.hermes-jkai/USER.md`:
```markdown
# John

- Owner of strangeramblings.com (Hetzner VPS, 157.180.19.38).
- Primary project: `~/strange_rambling_svelte/` — SvelteKit personal site.
- Machine: homeserv (Tailscale `homeserv.tail668b8c.ts.net`).
- Communication preference: terse, technical, no marketing tone, no emojis
  unless explicitly asked.
- Language: English only.
- After UI/UX changes to strange_rambling_svelte, deploy to production
  before iterating on visual fixes — local-only tweaks waste cycles.
- Design system lives at `~/strange-ramblings-design/` (canonical) and is
  enforced sitewide. Don't invent fonts. Don't selectively reconcile.
- DB: PostgreSQL 16 + Drizzle ORM. Schema changes via `npx drizzle-kit push`.
- Deploy: `~/strange_rambling_svelte/scripts/deploy.sh`.
```

- [ ] **Step 4: Create empty `MEMORY.md`**

Run:
```bash
: > ~/.hermes-jkai/MEMORY.md
```

Expected: file exists, is empty. Hermes will populate it via agent-curated memory once sessions start.

- [ ] **Step 5: Write minimal `.hermes.md` (config skeleton)**

The exact format depends on `<HERMES_TAG>`. Read the canonical example:
```bash
ls ~/hermes-agent/examples/ ~/hermes-agent/docs/ 2>/dev/null
# locate the profile config example, then:
cat ~/hermes-agent/<path-to-example>/.hermes.md  # or equivalent
```

Create `~/.hermes-jkai/.hermes.md` matching that format, with **placeholder provider blocks only** (real keys are added in Task 3). The file must declare:
- profile name: `jkai`
- default provider/model (placeholder for now)
- providers section with three placeholder entries: `zai`, `openrouter`, `anthropic`
- (no MCP block yet — added in Task 7)

If Hermes' format diverges from this plan's assumptions, follow the format Hermes ships with — adapt, don't fight.

- [ ] **Step 6: Verify Hermes recognises the profile**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai --help
```

Expected: help text prints; no "profile not found" error. (Output won't include providers yet — that's Task 3.)

- [ ] **Step 7: Commit nothing**

This profile lives outside the repo. Continue.

---

## Task 3: Configure providers (z.ai, OpenRouter, Anthropic)

**Files:**
- Modify: `~/.hermes-jkai/.hermes.md`
- Create: `~/.hermes-jkai/.env` (mode 600)

- [ ] **Step 1: Locate API keys for the three providers**

Sources to check on homeserv (existing jkai uses these):
```bash
grep -r "ZAI_API_KEY\|ANTHROPIC_API_KEY\|OPENROUTER_API_KEY" ~/strange_rambling_svelte/.env 2>/dev/null
grep -r "ZAI_API_KEY\|ANTHROPIC_API_KEY\|OPENROUTER_API_KEY" ~/vps-strange-rambling/ 2>/dev/null
```

Expected: at least one location yields each key. Copy values for the next step.

- [ ] **Step 2: Write `~/.hermes-jkai/.env` with the three keys**

Create `~/.hermes-jkai/.env`:
```
ZAI_API_KEY=<paste>
OPENROUTER_API_KEY=<paste>
ANTHROPIC_API_KEY=<paste>
```

Run:
```bash
chmod 600 ~/.hermes-jkai/.env
ls -l ~/.hermes-jkai/.env
```

Expected: perms `-rw-------`.

- [ ] **Step 3: Update `.hermes.md` to reference the env keys**

Edit `~/.hermes-jkai/.hermes.md`. Replace placeholders so each provider entry references the env variable for its key. (Exact YAML/TOML keys depend on Hermes' format from Task 2 Step 5 — match its conventions.)

For each provider, set:
- z.ai: model `glm-4.6`, base url `https://api.z.ai/api/coding/paas/v4`, api key from `ZAI_API_KEY`
- OpenRouter: model `anthropic/claude-haiku-4.5` (cheap default for smoke tests), base url `https://openrouter.ai/api/v1`, api key from `OPENROUTER_API_KEY`
- Anthropic: model `claude-haiku-4-5-20251001`, api mode `anthropic_messages`, api key from `ANTHROPIC_API_KEY`

Default provider/model: `openrouter` / `anthropic/claude-haiku-4.5` (cheapest verifiable round-trip for smoke tests).

- [ ] **Step 4: Verify Hermes sees the providers**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai providers list
# (or whatever the equivalent command is in <HERMES_TAG> — check `hermes --help`)
```

Expected: all three providers listed; no auth errors at this stage (auth is verified per-call in Task 4).

- [ ] **Step 5: Commit nothing**

`.env` is sensitive and outside the repo. Continue.

---

## Task 4: Provider smoke tests

**Files:**
- Append to: `docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md` (created in this task if missing)

- [ ] **Step 1: Create the acceptance log file**

Run first to ensure the parent dir exists:
```bash
cd ~/strange_rambling_svelte
mkdir -p docs/superpowers/research
```

Then create `docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md`:
```markdown
# Hermes Phase 0 Acceptance Log

This file records the actual commands run and the outputs observed during
Phase 0 verification. Each section is a checklist item from the design
spec's "Phase 0 — Exit criteria."

## Hermes install
- Tag: <HERMES_TAG>
- Commit: <SHA>
- `hermes --version` output: <pasted>

## Provider smoke tests

### z.ai
(filled in next)
```

- [ ] **Step 2: Smoke-test z.ai**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai \
  --provider zai --model glm-4.6 \
  "Reply with exactly the word: pong."
```

Expected: model returns text containing `pong` within ~10 seconds.

Append the command and the literal output to the acceptance log under "z.ai".

- [ ] **Step 3: Smoke-test OpenRouter**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai \
  --provider openrouter --model anthropic/claude-haiku-4.5 \
  "Reply with exactly the word: pong."
```

Expected: same — `pong` returned. Append to the acceptance log.

- [ ] **Step 4: Smoke-test Anthropic direct**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai \
  --provider anthropic --model claude-haiku-4-5-20251001 \
  "Reply with exactly the word: pong."
```

Expected: same — `pong` returned. Append to the acceptance log.

- [ ] **Step 5: Commit the acceptance log**

Run:
```bash
cd ~/strange_rambling_svelte
git add docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md
git commit -m "docs(hermes-phase-0): provider smoke test results"
```

---

## Task 5: Bridge-token HMAC primitive

**Files:**
- Create: `~/strange_rambling_svelte/src/lib/mcp/auth.ts`
- Create: `~/strange_rambling_svelte/src/lib/mcp/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mcp/auth.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { mintBridgeToken, verifyBridgeToken, type TokenScope } from './auth';

const SECRET = 'test-secret-do-not-use-in-prod-32-bytes-please';

describe('mcp/auth bridge tokens', () => {
  const scope: TokenScope = {
    sessionId: 'sess_abc',
    kind: 'canvas_chat',
    kindId: 'wf_42',
    expiresAt: Date.now() + 60_000,
  };

  it('mints a token that verifies under matching scope', () => {
    const token = mintBridgeToken(scope, SECRET);
    const result = verifyBridgeToken(token, scope, SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects a token whose kind_id does not match the call target', () => {
    const token = mintBridgeToken(scope, SECRET);
    const wrongTarget: TokenScope = { ...scope, kindId: 'wf_99' };
    const result = verifyBridgeToken(token, wrongTarget, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('scope_mismatch');
  });

  it('rejects a token whose kind does not match', () => {
    const token = mintBridgeToken(scope, SECRET);
    const wrongKind: TokenScope = { ...scope, kind: 'build' };
    const result = verifyBridgeToken(token, wrongKind, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('scope_mismatch');
  });

  it('rejects an expired token', () => {
    const expired: TokenScope = { ...scope, expiresAt: Date.now() - 1 };
    const token = mintBridgeToken(expired, SECRET);
    const result = verifyBridgeToken(token, expired, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a tampered token (signature mismatch)', () => {
    const token = mintBridgeToken(scope, SECRET);
    const tampered = token.slice(0, -4) + 'AAAA';
    const result = verifyBridgeToken(tampered, scope, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintBridgeToken(scope, SECRET);
    const result = verifyBridgeToken(token, scope, 'different-secret-also-32-bytes-long-eh');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });
});
```

- [ ] **Step 2: Run the test — expect import failure**

Run:
```bash
cd ~/strange_rambling_svelte
npx vitest run src/lib/mcp/auth.test.ts
```

Expected: FAIL with `Cannot find module './auth'` or equivalent.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/mcp/auth.ts`:
```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'build' | 'canvas_chat' | 'curate' | 'manual';

export interface TokenScope {
  sessionId: string;
  kind: TokenKind;
  kindId: string;
  expiresAt: number; // epoch ms
}

export type VerifyResult =
  | { ok: true; scope: TokenScope }
  | { ok: false; reason: 'malformed' | 'signature_mismatch' | 'scope_mismatch' | 'expired' };

const SEPARATOR = '.';

function payloadString(scope: TokenScope): string {
  return [scope.sessionId, scope.kind, scope.kindId, String(scope.expiresAt)].join('|');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function mintBridgeToken(scope: TokenScope, secret: string): string {
  const payload = payloadString(scope);
  const sig = sign(payload, secret);
  return Buffer.from(payload, 'utf8').toString('base64url') + SEPARATOR + sig;
}

export function verifyBridgeToken(
  token: string,
  expectedScope: TokenScope,
  secret: string,
): VerifyResult {
  const [encodedPayload, sig] = token.split(SEPARATOR);
  if (!encodedPayload || !sig) return { ok: false, reason: 'malformed' };

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const expectedSig = sign(payload, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  const [sessionId, kind, kindId, expiresAtStr] = payload.split('|');
  const expiresAt = Number(expiresAtStr);

  if (
    sessionId !== expectedScope.sessionId ||
    kind !== expectedScope.kind ||
    kindId !== expectedScope.kindId
  ) {
    return { ok: false, reason: 'scope_mismatch' };
  }

  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, scope: { sessionId, kind: kind as TokenKind, kindId, expiresAt } };
}
```

- [ ] **Step 4: Run the test — expect pass**

Run:
```bash
npx vitest run src/lib/mcp/auth.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/lib/mcp/auth.ts src/lib/mcp/auth.test.ts
git commit -m "feat(mcp/auth): bridge-token HMAC primitive

Sign and verify scoped tokens (sessionId, kind, kind_id, expiresAt).
Used to scope Hermes MCP calls per design spec section 5.4."
```

---

## Task 6: MCP echo-stub server (Node)

**Files:**
- Create: `scripts/hermes-mcp-echo-stub/package.json`
- Create: `scripts/hermes-mcp-echo-stub/server.ts`
- Create: `scripts/hermes-mcp-echo-stub/server.test.ts`
- Create: `scripts/hermes-mcp-echo-stub/README.md`
- Create: `scripts/hermes-mcp-echo-stub/tsconfig.json`

- [ ] **Step 1: Initialise the stub package**

Run:
```bash
cd ~/strange_rambling_svelte
mkdir -p scripts/hermes-mcp-echo-stub
cd scripts/hermes-mcp-echo-stub
```

Create `scripts/hermes-mcp-echo-stub/package.json`:
```json
{
  "name": "hermes-mcp-echo-stub",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": "server.ts",
  "scripts": {
    "start": "tsx server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

Create `scripts/hermes-mcp-echo-stub/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"]
}
```

Run:
```bash
cd scripts/hermes-mcp-echo-stub
npm install
```

Expected: install succeeds; `node_modules/` exists.

- [ ] **Step 2: Write the failing test**

Create `scripts/hermes-mcp-echo-stub/server.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { handleToolCall, listTools } from './server';

describe('echo-stub MCP server', () => {
  it('lists exactly one tool: echo_tool', async () => {
    const tools = await listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo_tool');
  });

  it('echoes the message back', async () => {
    const result = await handleToolCall('echo_tool', {
      message: 'hello hermes',
      bridgeToken: 'irrelevant-for-stub',
    });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'hello hermes' });
  });

  it('rejects unknown tool names', async () => {
    await expect(handleToolCall('nope', {})).rejects.toThrow(/unknown tool/i);
  });
});
```

- [ ] **Step 3: Run the test — expect import failure**

Run:
```bash
cd scripts/hermes-mcp-echo-stub
npm test
```

Expected: FAIL — `Cannot find module './server'`.

- [ ] **Step 4: Implement the stub server**

Create `scripts/hermes-mcp-echo-stub/server.ts`:
```typescript
#!/usr/bin/env tsx
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
  const server = new Server({ name: 'hermes-mcp-echo-stub', version: '0.0.0' }, {
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return await handleToolCall(req.params.name, req.params.arguments ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run the test — expect pass**

Run:
```bash
cd scripts/hermes-mcp-echo-stub
npm test
```

Expected: 3 tests pass.

- [ ] **Step 6: Manually exercise the stdio server**

Run:
```bash
cd scripts/hermes-mcp-echo-stub
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx tsx server.ts
```

Expected: a JSON-RPC response listing `echo_tool`. Record the output in the acceptance log.

- [ ] **Step 7: Write the stub README**

Create `scripts/hermes-mcp-echo-stub/README.md`:
```markdown
# hermes-mcp-echo-stub

Phase-0 standalone MCP server. One tool: `echo_tool`.

Used to verify the Hermes ↔ MCP bridge shape before wiring the 132-tool
SvelteKit MCP server in Phase 1.

## Run standalone (stdio)
    npx tsx server.ts

## Test
    npm test

## Wire into Hermes
See `~/.hermes-jkai/.hermes.md` MCP block (Task 7).
This stub is removed once Phase 1 lands the real MCP server.
```

- [ ] **Step 8: Commit**

Run:
```bash
cd ~/strange_rambling_svelte
git add scripts/hermes-mcp-echo-stub/
git commit -m "feat(scripts): hermes MCP echo stub for phase-0 bridge test

Single-tool MCP server (echo_tool) used to verify the Hermes ↔ MCP
bridge shape end-to-end. Removed when Phase 1 lands the real server."
```

---

## Task 7: End-to-end MCP smoke test (Hermes → echo-stub)

**Files:**
- Modify: `~/.hermes-jkai/.hermes.md` (add MCP server block)
- Append to: `docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md`

- [ ] **Step 1: Add the MCP block to the profile config**

Edit `~/.hermes-jkai/.hermes.md` and add an MCP server entry pointing at the stub. Exact syntax depends on `<HERMES_TAG>` — match Hermes' MCP config format (see `~/hermes-agent/docs/` or example configs).

The entry must launch the stub via stdio:
- command: `npx`
- args: `tsx /home/john/strange_rambling_svelte/scripts/hermes-mcp-echo-stub/server.ts`
- working dir: `/home/john/strange_rambling_svelte/scripts/hermes-mcp-echo-stub`

If Hermes' format is HTTP-only, fall back to running the stub on a localhost port and pointing Hermes at it. Document the choice in the acceptance log.

- [ ] **Step 2: Verify Hermes lists the echo tool**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai tools list
# (or `hermes -p jkai mcp tools` — whatever <HERMES_TAG> exposes)
```

Expected: `echo_tool` appears in Hermes' tool inventory.

- [ ] **Step 3: Drive Hermes to call the echo tool**

Run:
```bash
HERMES_HOME=~/.hermes-jkai hermes -p jkai \
  --provider openrouter --model anthropic/claude-haiku-4.5 \
  "Use the echo_tool to echo the exact string 'phase-0-bridge-ok' and then respond 'done'."
```

Expected: model performs a tool call to `echo_tool` with `message="phase-0-bridge-ok"`; the tool returns the same string; the model responds with the word `done` or similar.

Append the full transcript to the acceptance log.

- [ ] **Step 4: Verify scope rejection works at the primitive level**

Run a Vitest scope-rejection assertion already covered in Task 5 — this is the proof. The stub itself doesn't validate the bridge token (it's a stub) — token verification ships with the real MCP server in Phase 1. What we proved here:
  - Hermes can list and call MCP tools (transport works).
  - The auth primitive correctly rejects out-of-scope tokens (logic works).

In Phase 1, both halves are wired together. Document this distinction in the acceptance log.

- [ ] **Step 5: Service crash recovery check**

Run:
```bash
# Start the stub manually in a background terminal and send Hermes a tool-call,
# then kill the stub mid-call and observe Hermes' error handling.
HERMES_HOME=~/.hermes-jkai hermes -p jkai \
  --provider openrouter --model anthropic/claude-haiku-4.5 \
  "Call echo_tool with message='crash-test' and tell me the result."
# In another shell while the call is in flight:
pkill -f hermes-mcp-echo-stub
```

Expected: Hermes either retries (per its built-in retry/fallback path) or surfaces a clean tool-failed error. Append the actual behaviour to the acceptance log — this informs Phase 1's error-handling design.

- [ ] **Step 6: Commit the updated acceptance log**

Run:
```bash
cd ~/strange_rambling_svelte
git add docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md
git commit -m "docs(hermes-phase-0): MCP echo round-trip and crash test results"
```

---

## Task 8: Investigation memo — does Hermes expose a session-backend hook?

**Files:**
- Create: `docs/superpowers/research/2026-05-10-hermes-session-backend.md`

- [ ] **Step 1: Locate the session storage code in Hermes**

Run:
```bash
cd ~/hermes-agent
grep -rn "sessions.db\|hermes_state\|session_storage\|SessionStore" --include="*.py" | head -40
ls hermes_cli/ hermes/ 2>/dev/null
```

Expected: identify the file(s) that own session persistence (the WebFetch named `hermes_state.py` and `gateway/session.py` — confirm they're real in `<HERMES_TAG>`).

- [ ] **Step 2: Determine whether persistence is pluggable**

Read the session storage file(s) end-to-end. Look for:
- A protocol / abstract class / Protocol definition that backends implement.
- A registry pattern (similar to how Hermes registers tools at import time).
- An env var or config key that selects a backend.
- Any mention of "adapter", "backend", "provider", "driver" near session code.

Capture findings.

- [ ] **Step 3: Write the memo**

Create `docs/superpowers/research/2026-05-10-hermes-session-backend.md`:
```markdown
# Hermes session-backend hook investigation

**Question:** Can a Postgres-backed session store be plugged into Hermes
without forking?

**Hermes tag:** <HERMES_TAG> (commit <SHA>)

## Findings

### Session storage location
- Files: <list>
- Class(es): <list>
- API surface (methods called by AIAgent): <list>

### Pluggability
- [ ] Abstract base class / Protocol exists: <yes/no, reference>
- [ ] Backend registry exists: <yes/no, reference>
- [ ] Config-selectable backend: <yes/no, reference>
- [ ] Methods are small enough to override cleanly: <subjective>

### Verdict
One of:
- **D-yes**: Postgres adapter is plug-in-able. Recommend prototype in
  Phase 0 spike (1 day) — schedule and outcome below.
- **D-no**: Fork required. Lock in option A (dual-store, MCP bridge).
  No further work in Phase 0.

### If D-yes — spike
- Time-boxed to 1 day.
- Adapter: <module path>.
- Tests: <file paths>.
- Result: <pass / fail>.

### Decision
<One sentence: "We are proceeding with option <A | D>." with link to
the corresponding section of the spec.>
```

Fill in every section based on the investigation.

- [ ] **Step 4: If D-yes, run the 1-day spike**

If — and only if — Step 3's verdict is **D-yes**:
- Implement a minimal Postgres-backed `SessionStore` subclass under
  `~/.hermes-jkai/extensions/postgres_session_store.py` (or wherever
  Hermes' extension mechanism expects it).
- Connect to the existing strange_rambling_svelte Postgres instance.
- Schema: a single `hermes_session_records(id, parent_id, profile, payload jsonb, updated_at)` table.
- Test: start a Hermes session, send a message, kill the process,
  restart Hermes, observe the session reloads from Postgres.

Document the result in the memo's "If D-yes — spike" section.

If the spike succeeds, the spec's section 3 is updated in a follow-up
commit to declare option D as the chosen state strategy.

- [ ] **Step 5: Commit**

Run:
```bash
cd ~/strange_rambling_svelte
git add docs/superpowers/research/2026-05-10-hermes-session-backend.md
git commit -m "docs(hermes-phase-0): session-backend hook investigation"
```

If the spec needs updating because the verdict is D-yes, do it as a separate commit:
```bash
git add docs/superpowers/specs/2026-05-10-hermes-replacement-design.md
git commit -m "docs(spec): lock in option D — postgres session backend"
```

---

## Task 9: Create the systemd unit (not enabled)

**Files:**
- Create: `~/.config/systemd/user/jkai-hermes.service`

- [ ] **Step 1: Determine Hermes' socket-gateway invocation**

Find the exact command Hermes uses to expose its agent loop over a UNIX socket. Check:
```bash
hermes --help | grep -i "gateway\|socket\|listen\|serve"
hermes gateway --help 2>/dev/null
ls ~/hermes-agent/hermes_cli/ 2>/dev/null
```

Record the canonical command for `<HERMES_TAG>` — call it `<HERMES_GATEWAY_CMD>`. Example might be `hermes -p jkai gateway --listen unix:///run/user/1000/jkai-hermes.sock`, but verify.

If the released `<HERMES_TAG>` does not yet expose a UNIX-socket gateway, document this in the acceptance log and move to a fallback: a small Python wrapper script under `~/.hermes-jkai/bin/socket-gateway.py` that wraps `AIAgent` directly. (This is a contingency — try the native gateway first.)

- [ ] **Step 2: Write the systemd unit**

Create `~/.config/systemd/user/jkai-hermes.service`:
```ini
[Unit]
Description=jkai Hermes agent runtime
After=network.target

[Service]
Type=simple
Environment=HERMES_HOME=%h/.hermes-jkai
EnvironmentFile=%h/.hermes-jkai/.env
ExecStart=<HERMES_GATEWAY_CMD>
Restart=on-failure
RestartSec=5s
RuntimeDirectory=jkai-hermes
RuntimeDirectoryMode=0700

[Install]
WantedBy=default.target
```

Replace `<HERMES_GATEWAY_CMD>` with the verified command from Step 1.

- [ ] **Step 3: Validate the unit syntactically**

Run:
```bash
systemctl --user daemon-reload
systemd-analyze --user verify ~/.config/systemd/user/jkai-hermes.service
```

Expected: zero output (valid unit).

- [ ] **Step 4: Confirm it is NOT enabled**

Run:
```bash
systemctl --user is-enabled jkai-hermes.service
systemctl --user is-active jkai-hermes.service
```

Expected: both return `disabled` and `inactive`. **Do not enable it.** Phase 1 enables it.

- [ ] **Step 5: Commit nothing**

This file lives outside the repo. Record the file's contents and the validation output in the acceptance log instead:

```bash
cd ~/strange_rambling_svelte
# Append unit contents + verify output to the acceptance log
git add docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md
git commit -m "docs(hermes-phase-0): systemd unit prepared (disabled)"
```

---

## Task 10: Phase 0 acceptance — final pass

**Files:**
- Modify: `docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md`

- [ ] **Step 1: Confirm each exit criterion is met**

Read the spec's "Phase 0 — Exit criteria" section and walk through:

| Criterion | Where verified |
|---|---|
| `hermes -p jkai "hello"` returns from each provider | Task 4 Steps 2–4 |
| Bridge-token + MCP echo round-trip works | Task 5 + Task 6 + Task 7 |
| Session-backend question has a documented answer | Task 8 |

For any not yet ticked, return to the corresponding task and complete it. Do not declare Phase 0 done until all three pass.

- [ ] **Step 2: Append the final acceptance summary**

Append to `docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md`:
```markdown
## Final acceptance

- Provider smoke tests: PASS / PASS / PASS (z.ai, openrouter, anthropic)
- Bridge-token unit tests: PASS (6/6)
- MCP echo end-to-end (Hermes → stub → response): PASS
- MCP crash-recovery behaviour: <observed behaviour pasted>
- Session-backend verdict: <A or D>
- systemd unit prepared, validated, NOT enabled: PASS

Phase 0 is complete. Phase 1 (canvas orchestrator chat) can begin.
```

- [ ] **Step 3: Commit**

Run:
```bash
git add docs/superpowers/research/2026-05-10-hermes-phase-0-acceptance.md
git commit -m "docs(hermes-phase-0): final acceptance — all exit criteria met"
```

- [ ] **Step 4: Tag the milestone**

Run:
```bash
git tag hermes-phase-0-complete
git log --oneline -10  # confirm the tag points at the acceptance commit
```

(Push the tag separately when ready — not required by Phase 0 itself.)

---

## Self-review checklist

(To be performed by the executing agent before declaring Phase 0 complete.)

**Spec coverage** — every Phase 0 deliverable in the spec section 6.0 has a corresponding task above:
- Profile created with `.hermes.md`, `SOUL.md`, `USER.md` → Task 2
- Providers configured for z.ai, OpenRouter, Anthropic → Task 3
- `hermes -p jkai` works against each provider → Task 4
- MCP smoke test with stub `echo_tool` → Tasks 5–7
- Bridge-token primitive → Task 5
- Session-backend hook investigation → Task 8
- systemd unit created but not enabled → Task 9

**Type consistency** — `TokenScope` in `auth.ts` declares `kind: 'build' | 'canvas_chat' | 'curate' | 'manual'`, matching the spec's `hermes_sessions.kind` enum. The echo stub's tool input includes a `bridgeToken` field (unverified at the stub layer; verified in Phase 1 by the real MCP server using `verifyBridgeToken`).

**No commits to `~/.hermes-jkai/` content** — that directory is sensitive and host-specific; only files inside `~/strange_rambling_svelte/` are committed. The acceptance log records what's installed where.

**No SvelteKit code paths talk to Hermes yet** — Phase 0 is install + verification. `hermes-client.ts`, the real MCP server, and the route changes all land in Phase 1.
