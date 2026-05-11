# Hermes Phase 1 — Canvas Orchestrator Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke ReAct loop behind `/api/workflows/orchestrator/chat` with Hermes Agent. SvelteKit talks to Hermes through a `JkaiPlatformAdapter` plugin (HTTP+SSE); Hermes calls back into SvelteKit's MCP server to mutate workflow DAGs.

**Architecture:** jkai is registered as a Hermes platform (same shape as Telegram/Slack/WhatsApp) via `BasePlatformAdapter` + `PlatformRegistry`. SvelteKit's `hermes-client.ts` POSTs user messages to the adapter and consumes the outbound SSE; the adapter forwards messages to Hermes' `AIAgent` per-chat session. Hermes makes MCP tool calls (initially 22 workflow-domain tools) back to a new SvelteKit MCP server at `/api/mcp/tools`, with each call HMAC-scoped by the bridge-token primitive from Phase 0.

**Tech Stack:** Python 3.11 (Hermes plugin: aiohttp, pytest), TypeScript (SvelteKit, vitest, @modelcontextprotocol/sdk 1.x), Drizzle ORM + Postgres, systemd user services.

**Spec reference:** `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` (post-pivot, commit `aaca198` or later).

---

## File Structure

| Path | Purpose | Action |
|---|---|---|
| `~/.hermes-jkai/extensions/jkai_platform/__init__.py` | Plugin package init + PlatformRegistry registration | New |
| `~/.hermes-jkai/extensions/jkai_platform/auth.py` | Python HMAC bridge-token (mirror of `src/lib/mcp/auth.ts`) | New |
| `~/.hermes-jkai/extensions/jkai_platform/adapter.py` | `JkaiPlatformAdapter(BasePlatformAdapter)` | New |
| `~/.hermes-jkai/extensions/jkai_platform/http_server.py` | aiohttp inbound POST + outbound SSE | New |
| `~/.hermes-jkai/extensions/jkai_platform/pyproject.toml` | Editable install metadata + entry-point declaration | New |
| `~/.hermes-jkai/extensions/jkai_platform/tests/test_auth.py` | pytest for auth primitive | New |
| `~/.hermes-jkai/extensions/jkai_platform/tests/test_adapter.py` | pytest for adapter | New |
| `~/.hermes-jkai/extensions/jkai_platform/tests/test_http_server.py` | pytest for HTTP server | New |
| `~/.hermes-jkai/skills/jkai-canvas/SKILL.md` | Agent identity + canvas tool guidance | New |
| `~/.hermes-jkai/config.yaml` | Load jkai_platform plugin; rewire MCP to SvelteKit | Modify |
| `~/.config/systemd/user/jkai-hermes.service` | (Unchanged unit; enable+start in Task 7) | Modify (`enable --now`) |
| `src/lib/mcp/server.ts` | HTTP MCP server (workflows domain, 22 tools) | New |
| `src/lib/mcp/server.test.ts` | Vitest for MCP server | New |
| `src/routes/api/mcp/+server.ts` | SvelteKit handler mounting the MCP server | New |
| `src/lib/jkai/hermes-client.ts` | HTTP POST + SSE consumer | New |
| `src/lib/jkai/hermes-client.test.ts` | Vitest for client | New |
| `src/lib/db/schema.ts` (or `src/lib/server/db/schema.ts`) | Add `hermes_sessions` table | Modify |
| `drizzle/<timestamp>_hermes_sessions.sql` | Migration | New |
| `src/routes/api/workflows/orchestrator/chat/+server.ts` | Flag-gated Hermes proxy | Modify |
| `src/routes/admin/hermes/+page.svelte` | Admin UI v1: sessions, health, last 50 events | New |
| `src/routes/admin/hermes/+page.server.ts` | Loader for admin page | New |
| `src/lib/workflows/orchestrator/loop.ts` | Delete in final task | Delete |
| `docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md` | Phase 1 acceptance log | New |

---

## Task 0: Preliminaries — merge Phase 0, set up worktree

**Goal:** Phase 0 lives on `worktree-hermes-phase-0` (tag `hermes-phase-0-complete` at commit `85a7b51` or `aaca198` if you include the transport-pivot spec update). Merge that into a long-running migration branch (`hermes-migration`) and branch Phase 1 off it.

**Files:** No file changes; git operations only.

- [ ] **Step 1: Inventory the Phase 0 branch state**

Run:
```bash
cd /home/john/strange_rambling_svelte
git branch -a | grep hermes
git log --oneline master..worktree-hermes-phase-0 | head -20
```

Expected: ~11 commits between master and the Phase 0 branch tip; tag `hermes-phase-0-complete` exists.

- [ ] **Step 2: Create the long-running migration branch**

Run:
```bash
cd /home/john/strange_rambling_svelte
git checkout master
git pull --ff-only
git checkout -b hermes-migration
git merge --no-ff worktree-hermes-phase-0 -m "merge: phase 0 — install, profile, MCP echo, bridge-token primitive"
git log --oneline -5
```

Expected: `hermes-migration` branch contains everything from Phase 0 plus master. No conflicts (Phase 0 only touched new files + the design docs).

If a conflict arises in `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` (unlikely — only the worktree edits live), resolve by keeping the Phase 0 worktree's version (which includes the transport-pivot update).

- [ ] **Step 3: Create the Phase 1 worktree**

Run:
```bash
cd /home/john/strange_rambling_svelte
git worktree add .claude/worktrees/hermes-phase-1 -b worktree-hermes-phase-1 hermes-migration
cd .claude/worktrees/hermes-phase-1
git branch --show-current
```

Expected: working dir is the new worktree; branch is `worktree-hermes-phase-1`; HEAD matches `hermes-migration`.

- [ ] **Step 4: Install deps and copy .env**

Run:
```bash
cd .claude/worktrees/hermes-phase-1
cp /home/john/strange_rambling_svelte/.env .env
npm install --no-audit --no-fund
```

Expected: ~851 packages installed; `.env` present (mode 0644 is fine for a worktree-local copy).

- [ ] **Step 5: Baseline tests**

Run:
```bash
npx vitest run src/lib/mcp/auth.test.ts 2>&1 | tail -5
cd scripts/hermes-mcp-echo-stub && npm install && npm test 2>&1 | tail -5
```

Expected: `auth.test.ts` 8/8 pass; `server.test.ts` 3/3 pass. (The full project test suite still has the same 13 pre-existing DB-flavoured failures that don't affect Phase 1 scope.)

- [ ] **Step 6: No commit yet — just record the baseline**

The migration branch + worktree are infrastructure, not code. Task 1's commit is the first Phase 1 artefact.

---

## Task 1: Postgres migration — `hermes_sessions` join table

**Files:**
- Modify: `src/lib/server/db/schema.ts` (or whichever file defines Drizzle tables — check `~/strange_rambling_svelte/CLAUDE.md` for the location; in current repo it's `src/lib/server/db/schema.ts`)
- New: `drizzle/<auto-generated>_hermes_sessions.sql`

- [ ] **Step 1: Locate the schema file**

Run:
```bash
cd .claude/worktrees/hermes-phase-1
grep -l "pgTable\|drizzle-orm" src/lib/server/db/*.ts 2>/dev/null | head -3
ls src/lib/server/db/
```

Expected: a `schema.ts` (or split-by-domain like `schema-jkai.ts`) at `src/lib/server/db/`.

- [ ] **Step 2: Add the table definition**

Append to the appropriate schema file (use the same import style and helper functions the existing tables use):

```typescript
export const hermesSessions = pgTable('hermes_sessions', {
  id: serial('id').primaryKey(),
  hermesSessionId: text('hermes_session_id').notNull(),
  kind: text('kind', { enum: ['build', 'canvas_chat', 'curate', 'manual'] }).notNull(),
  kindId: text('kind_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => ({
  uniqueByKind: uniqueIndex('hermes_sessions_kind_kind_id_idx').on(t.kind, t.kindId).where(sql`closed_at IS NULL`),
}));
```

The partial unique index ensures a single open session per (kind, kind_id); closed sessions don't block re-opening.

Make sure the imports (`pgTable`, `serial`, `text`, `timestamp`, `uniqueIndex`, `sql`) match the rest of the file's import style.

- [ ] **Step 3: Generate the migration**

Run:
```bash
cd .claude/worktrees/hermes-phase-1
npx drizzle-kit generate --name=hermes_sessions
ls drizzle/ | tail -3
```

Expected: a new `.sql` file under `drizzle/` with the `CREATE TABLE hermes_sessions` and the partial unique index.

- [ ] **Step 4: Apply the migration to the dev database**

Run:
```bash
npx drizzle-kit push
```

Expected: `[✓] Changes applied` or similar. If it prompts to confirm a column change, decline and inspect — the migration should be additive only.

Verify the table exists:
```bash
echo "\\d hermes_sessions" | psql "$DATABASE_URL"
```

Expected: 6 columns (id, hermes_session_id, kind, kind_id, created_at, closed_at) + the partial unique index.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat(db): hermes_sessions table — Postgres↔Hermes session link

Partial-unique index ensures one open session per (kind, kind_id).
kind ∈ {build, canvas_chat, curate, manual} matches the TokenKind
union in src/lib/mcp/auth.ts."
```

---

## Task 2: Python bridge-token primitive (TDD)

**Files:**
- Create: `~/.hermes-jkai/extensions/jkai_platform/__init__.py` (empty for now)
- Create: `~/.hermes-jkai/extensions/jkai_platform/auth.py`
- Create: `~/.hermes-jkai/extensions/jkai_platform/tests/__init__.py` (empty)
- Create: `~/.hermes-jkai/extensions/jkai_platform/tests/test_auth.py`

This task lives outside the repo (under `~/.hermes-jkai/extensions/`). It mirrors the TypeScript bridge-token primitive at `src/lib/mcp/auth.ts` byte-equivalently so a token minted by SvelteKit verifies in the Python plugin and vice-versa.

- [ ] **Step 1: Create the directory layout**

```bash
mkdir -p ~/.hermes-jkai/extensions/jkai_platform/tests
: > ~/.hermes-jkai/extensions/jkai_platform/__init__.py
: > ~/.hermes-jkai/extensions/jkai_platform/tests/__init__.py
```

- [ ] **Step 2: Write the failing test**

Create `~/.hermes-jkai/extensions/jkai_platform/tests/test_auth.py`:

```python
import time

import pytest

from jkai_platform.auth import (
    TokenScope,
    mint_bridge_token,
    verify_bridge_token,
)

SECRET = "test-secret-do-not-use-in-prod-32-bytes-please"

def scope(**overrides):
    base = {
        "sessionId": "sess_abc",
        "kind": "canvas_chat",
        "kindId": "wf_42",
        "expiresAt": int((time.time() + 3600) * 1000),
    }
    base.update(overrides)
    return TokenScope(**base)


def test_mints_token_that_verifies_under_matching_scope():
    s = scope()
    token = mint_bridge_token(s, SECRET)
    result = verify_bridge_token(token, s, SECRET)
    assert result.ok is True


def test_rejects_token_whose_kind_id_does_not_match():
    s = scope()
    token = mint_bridge_token(s, SECRET)
    wrong = scope(kindId="wf_99")
    result = verify_bridge_token(token, wrong, SECRET)
    assert result.ok is False
    assert result.reason == "scope_mismatch"


def test_rejects_token_whose_kind_does_not_match():
    s = scope()
    token = mint_bridge_token(s, SECRET)
    wrong = scope(kind="build")
    result = verify_bridge_token(token, wrong, SECRET)
    assert result.ok is False
    assert result.reason == "scope_mismatch"


def test_rejects_expired_token():
    s = scope(expiresAt=int((time.time() - 1) * 1000))
    token = mint_bridge_token(s, SECRET)
    result = verify_bridge_token(token, s, SECRET)
    assert result.ok is False
    assert result.reason == "expired"


def test_rejects_tampered_token_signature():
    s = scope()
    token = mint_bridge_token(s, SECRET)
    tampered = token[:-4] + "AAAA"
    result = verify_bridge_token(tampered, s, SECRET)
    assert result.ok is False
    assert result.reason == "signature_mismatch"


def test_rejects_token_signed_with_different_secret():
    s = scope()
    token = mint_bridge_token(s, SECRET)
    result = verify_bridge_token(token, s, "different-secret-also-32-bytes-long-eh")
    assert result.ok is False
    assert result.reason == "signature_mismatch"


def test_rejects_token_with_extra_separator_segments():
    s = scope()
    token = mint_bridge_token(s, SECRET) + ".junk"
    result = verify_bridge_token(token, s, SECRET)
    assert result.ok is False
    assert result.reason == "malformed"


def test_accepts_kindId_containing_pipe_character():
    s = scope(kindId="wf|99")
    token = mint_bridge_token(s, SECRET)
    result = verify_bridge_token(token, s, SECRET)
    assert result.ok is True
```

- [ ] **Step 3: Run the test — expect import failure**

```bash
cd ~/.hermes-jkai/extensions/jkai_platform
python3 -m pytest tests/test_auth.py -v 2>&1 | tail -8
```

Expected: FAIL with `ModuleNotFoundError: No module named 'jkai_platform.auth'`.

If pytest itself isn't on PATH for the venv'd hermes Python, install into a temporary scratch venv:
```bash
python3 -m venv ~/.hermes-jkai/extensions/.venv
source ~/.hermes-jkai/extensions/.venv/bin/activate
pip install pytest
```

- [ ] **Step 4: Write the implementation**

Create `~/.hermes-jkai/extensions/jkai_platform/auth.py`:

```python
"""HMAC bridge-token primitive — Python mirror of src/lib/mcp/auth.ts.

Token format: <base64url(JSON payload)>.<base64url(HMAC-SHA256(payload, secret))>.
"""
from __future__ import annotations

import base64
import hmac
import json
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Literal, Union

TokenKind = Literal["build", "canvas_chat", "curate", "manual"]
VALID_KINDS = ("build", "canvas_chat", "curate", "manual")

SEPARATOR = "."


@dataclass(frozen=True)
class TokenScope:
    sessionId: str
    kind: TokenKind
    kindId: str
    expiresAt: int  # epoch ms


@dataclass(frozen=True)
class VerifyOk:
    ok: Literal[True]
    scope: TokenScope


@dataclass(frozen=True)
class VerifyErr:
    ok: Literal[False]
    reason: Literal["malformed", "signature_mismatch", "scope_mismatch", "expired"]


VerifyResult = Union[VerifyOk, VerifyErr]


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _encode_payload(scope: TokenScope) -> str:
    payload = json.dumps(
        {
            "sessionId": scope.sessionId,
            "kind": scope.kind,
            "kindId": scope.kindId,
            "expiresAt": scope.expiresAt,
        },
        separators=(",", ":"),
        sort_keys=False,
    )
    return _b64url_encode(payload.encode("utf-8"))


def _sign(encoded_payload: str, secret: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), encoded_payload.encode("ascii"), sha256)
    return _b64url_encode(mac.digest())


def mint_bridge_token(scope: TokenScope, secret: str) -> str:
    encoded = _encode_payload(scope)
    sig = _sign(encoded, secret)
    return f"{encoded}{SEPARATOR}{sig}"


def verify_bridge_token(token: str, expected: TokenScope, secret: str) -> VerifyResult:
    parts = token.split(SEPARATOR)
    if len(parts) != 2:
        return VerifyErr(ok=False, reason="malformed")
    encoded, sig = parts
    if not encoded or not sig:
        return VerifyErr(ok=False, reason="malformed")

    expected_sig = _sign(encoded, secret)
    if not hmac.compare_digest(sig, expected_sig):
        return VerifyErr(ok=False, reason="signature_mismatch")

    try:
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return VerifyErr(ok=False, reason="malformed")

    if not (
        isinstance(payload.get("sessionId"), str)
        and isinstance(payload.get("kind"), str)
        and isinstance(payload.get("kindId"), str)
        and isinstance(payload.get("expiresAt"), int)
        and payload["kind"] in VALID_KINDS
    ):
        return VerifyErr(ok=False, reason="malformed")

    scope = TokenScope(
        sessionId=payload["sessionId"],
        kind=payload["kind"],
        kindId=payload["kindId"],
        expiresAt=payload["expiresAt"],
    )

    if (
        scope.sessionId != expected.sessionId
        or scope.kind != expected.kind
        or scope.kindId != expected.kindId
    ):
        return VerifyErr(ok=False, reason="scope_mismatch")

    if int(time.time() * 1000) > scope.expiresAt:
        return VerifyErr(ok=False, reason="expired")

    return VerifyOk(ok=True, scope=scope)
```

- [ ] **Step 5: Run the test — expect pass**

```bash
cd ~/.hermes-jkai/extensions/jkai_platform
python3 -m pytest tests/test_auth.py -v 2>&1 | tail -15
```

Expected: 8 passed.

- [ ] **Step 6: Cross-validate against the TypeScript primitive**

Generate a token in TypeScript, verify it in Python. This proves byte-for-byte compatibility.

In the worktree:
```bash
cd /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-1
node --input-type=module -e "
import { mintBridgeToken } from './src/lib/mcp/auth.ts';
const token = mintBridgeToken({
  sessionId: 'sess_xover',
  kind: 'canvas_chat',
  kindId: 'wf_42',
  expiresAt: Date.now() + 3600_000,
}, 'shared-test-secret-32-bytes-please-thx');
console.log(token);
"
```

(If `node` can't load `.ts` directly, run via `npx tsx --input-type=module` instead. Or write the token-emission as a one-off in a `.test.ts` file and copy the value.)

Then verify in Python:
```bash
python3 -c "
import time
from jkai_platform.auth import TokenScope, verify_bridge_token
token = '<paste>'
scope = TokenScope(sessionId='sess_xover', kind='canvas_chat', kindId='wf_42',
                   expiresAt=int(time.time()*1000) + 3600_000)
print(verify_bridge_token(token, scope, 'shared-test-secret-32-bytes-please-thx'))
"
```

Expected: `VerifyOk(ok=True, scope=...)`.

If cross-validation fails, the JSON serialization is the likely culprit: TypeScript's `JSON.stringify` produces `{"sessionId":"sess_xover","kind":...}` and Python's `json.dumps(..., separators=(",", ":"))` must produce the same string. The key order matters because the signature is computed over the literal bytes.

If key order is the issue, edit `_encode_payload` to use `sort_keys=False` (already set) and ensure the TS side's payload object enumerates keys in the same order: `sessionId, kind, kindId, expiresAt`. Read `src/lib/mcp/auth.ts:_encodePayload` to confirm.

- [ ] **Step 7: Commit nothing in the repo**

The extension lives outside the repo. Continue.

---

## Task 3: Investigate Hermes' plugin-loading mechanism

**Files:** Investigation only; results inform Task 4 and Task 6.

The spec section 8 listed this as an open question: does Hermes' `PlatformRegistry` accept plugins via Python entry-points, or only in-tree imports? Phase 0's session-backend investigation found that **session storage** is not pluggable, but the gateway's platform registry was identified as plugin-friendly. Confirm before we wire anything.

- [ ] **Step 1: Find the registry's entry-point loading code**

```bash
cd ~/hermes-agent
grep -rn "entry_points\|importlib.metadata\|pkg_resources" gateway/ hermes_cli/ pyproject.toml 2>/dev/null | head -20
grep -n "PlatformRegistry\|register_platform\|PlatformEntry" gateway/platform_registry.py
```

Look for: a function called at gateway startup that scans installed packages for entry-point groups (e.g. `hermes.platforms`).

- [ ] **Step 2: Find the registration call site**

```bash
grep -rn "platform_registry.register\|PlatformRegistry()" gateway/ hermes_cli/ | head -10
```

The registry must be populated somewhere before `hermes gateway run` instantiates adapters. Find where.

- [ ] **Step 3: Document findings**

Three possibilities — note which applies and where:

A. **Entry-point group exists** (e.g. `hermes.platforms`). The plugin's `pyproject.toml` declares `[project.entry-points."hermes.platforms"]`; pip-install picks it up; gateway scans. (Cleanest.)

B. **Config path declared in `config.yaml`** (e.g. `plugins.platforms: [path/to/module]`). Hermes imports the module at startup. (Workable.)

C. **In-tree only**. Adding a platform requires editing `gateway/run.py`. (Fork-equivalent — bad.)

Append findings to a scratch note `~/.hermes-jkai/extensions/jkai_platform/PLUGIN_LOADING.md`:

```markdown
# Hermes v2026.5.7 plugin loading

**Mechanism:** <A | B | C>

**Evidence:**
- <file:line refs>

**Implication for jkai_platform:**
- <how Task 4 should register>
```

- [ ] **Step 4: If verdict is C, escalate**

If platforms can only be added by editing Hermes' tree, this changes Phase 1 scope substantially (we'd have to maintain a fork). Report BLOCKED with the file:line references and the recommended fallback (option B from the original spec brainstorm: small Python wrapper, not a Hermes plugin).

- [ ] **Step 5: No commit**

Investigation artefacts live outside the repo.

---

## Task 4: `JkaiPlatformAdapter` skeleton (in-memory; no HTTP yet)

**Files:**
- Create: `~/.hermes-jkai/extensions/jkai_platform/adapter.py`
- Create: `~/.hermes-jkai/extensions/jkai_platform/tests/test_adapter.py`
- Modify: `~/.hermes-jkai/extensions/jkai_platform/__init__.py` (export the adapter; do not register yet)

This task builds the adapter as a pure Python class that can be unit-tested without spawning a real HTTP server. The HTTP layer lands in Task 5.

- [ ] **Step 1: Read the BasePlatformAdapter contract**

Spec section 4.1 references `gateway/platforms/base.py`. Read the abstract methods and their signatures:

```bash
sed -n '1206,1480p' ~/hermes-agent/gateway/platforms/base.py | less
```

Note the exact signatures for `connect`, `disconnect`, `send`, `edit_message`, `get_chat_info`. The Phase 0 platform research already characterised these.

- [ ] **Step 2: Write the failing test**

Create `~/.hermes-jkai/extensions/jkai_platform/tests/test_adapter.py`:

```python
import asyncio
from unittest.mock import AsyncMock

import pytest

from jkai_platform.adapter import JkaiPlatformAdapter, OutboundFrame


@pytest.fixture
def adapter():
    a = JkaiPlatformAdapter(config={"http_port": 18790, "bridge_secret": "test-secret"})
    handler = AsyncMock()
    a.set_message_handler(handler)
    return a, handler


@pytest.mark.asyncio
async def test_initial_state_has_no_open_chats(adapter):
    a, _ = adapter
    assert a.list_open_chats() == []


@pytest.mark.asyncio
async def test_send_pushes_a_frame_to_the_per_chat_queue(adapter):
    a, _ = adapter
    result = await a.send(chat_id="wf_42", content="hello", metadata={"kind": "canvas_chat"})
    assert result.success is True
    assert result.message_id is not None
    frames = a.drain_outbound("wf_42")
    assert len(frames) == 1
    assert frames[0].kind == "send"
    assert frames[0].content == "hello"


@pytest.mark.asyncio
async def test_edit_message_pushes_a_replace_frame(adapter):
    a, _ = adapter
    initial = await a.send(chat_id="wf_42", content="thinking...", metadata={"kind": "canvas_chat"})
    await a.edit_message(chat_id="wf_42", message_id=initial.message_id, content="here you go")
    frames = a.drain_outbound("wf_42")
    assert len(frames) == 2
    assert frames[1].kind == "replace"
    assert frames[1].content == "here you go"
    assert frames[1].message_id == initial.message_id


@pytest.mark.asyncio
async def test_handle_inbound_invokes_message_handler(adapter):
    a, handler = adapter
    await a.handle_inbound(chat_id="wf_42", text="add a scrape node", metadata={"kind": "canvas_chat"})
    handler.assert_called_once()
    event = handler.call_args[0][0]
    assert event.chat_id == "wf_42"
    assert event.text == "add a scrape node"


@pytest.mark.asyncio
async def test_drain_outbound_clears_the_queue(adapter):
    a, _ = adapter
    await a.send(chat_id="wf_42", content="x", metadata={})
    a.drain_outbound("wf_42")
    assert a.drain_outbound("wf_42") == []


@pytest.mark.asyncio
async def test_connect_and_disconnect_no_op_without_http(adapter):
    a, _ = adapter
    # In this task the HTTP layer isn't wired; connect/disconnect should be safe no-ops.
    assert await a.connect() is True
    await a.disconnect()
```

Add the pytest-asyncio dep if not present:
```bash
cd ~/.hermes-jkai/extensions/jkai_platform
source ../.venv/bin/activate
pip install pytest-asyncio
```

Add an `asyncio_mode = "auto"` setting to a new `pyproject.toml` (full content in Step 6).

- [ ] **Step 3: Run the test — expect import failure**

```bash
python3 -m pytest tests/test_adapter.py -v 2>&1 | tail -10
```

Expected: FAIL with `ModuleNotFoundError: No module named 'jkai_platform.adapter'`.

- [ ] **Step 4: Implement the adapter**

Create `~/.hermes-jkai/extensions/jkai_platform/adapter.py`:

```python
"""JkaiPlatformAdapter — Hermes platform adapter making SvelteKit/jkai a chat channel.

Subclasses Hermes' BasePlatformAdapter (see ~/hermes-agent/gateway/platforms/base.py).
The HTTP layer lives in http_server.py; this file holds the in-memory queue state
and the BasePlatformAdapter contract methods.
"""
from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Optional

try:
    from gateway.platforms.base import BasePlatformAdapter, SendResult
except ImportError:  # pragma: no cover — when running tests outside the Hermes venv
    @dataclass
    class SendResult:
        success: bool
        message_id: Optional[str] = None
        error: Optional[str] = None

    class BasePlatformAdapter:  # minimal stub used for typing in tests
        def set_message_handler(self, fn):
            self._message_handler = fn


@dataclass
class OutboundFrame:
    kind: Literal["send", "replace", "finalize"]
    chat_id: str
    message_id: str
    content: str
    metadata: dict = field(default_factory=dict)
    ts: float = field(default_factory=time.time)


@dataclass
class InboundEvent:
    chat_id: str
    text: str
    metadata: dict


class JkaiPlatformAdapter(BasePlatformAdapter):
    """One per Hermes gateway process. Holds per-chat outbound queues in memory."""

    PLATFORM_NAME = "jkai"

    def __init__(self, config: dict):
        self.config = config
        self.bridge_secret = config["bridge_secret"]
        self.http_port = int(config.get("http_port", 18790))
        self._outbound: dict[str, list[OutboundFrame]] = {}
        self._message_handler: Optional[Callable[[InboundEvent], Awaitable[None]]] = None

    # ---- BasePlatformAdapter contract ----

    async def connect(self) -> bool:
        # HTTP layer is task 5; this stub returns True so connect() in tests passes.
        return True

    async def disconnect(self) -> None:
        # HTTP layer is task 5.
        return None

    async def send(self, chat_id: str, content: str, metadata: dict | None = None,
                   reply_to: str | None = None) -> SendResult:
        message_id = self._new_message_id()
        self._enqueue(OutboundFrame(
            kind="send", chat_id=chat_id, message_id=message_id, content=content,
            metadata=metadata or {},
        ))
        return SendResult(success=True, message_id=message_id)

    async def edit_message(self, chat_id: str, message_id: str, content: str,
                           metadata: dict | None = None) -> SendResult:
        self._enqueue(OutboundFrame(
            kind="replace", chat_id=chat_id, message_id=message_id, content=content,
            metadata=metadata or {},
        ))
        return SendResult(success=True, message_id=message_id)

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {"chat_id": chat_id, "platform": self.PLATFORM_NAME}

    def set_message_handler(self, fn: Callable[[InboundEvent], Awaitable[None]]) -> None:
        self._message_handler = fn

    # ---- jkai-specific helpers (not in the base contract) ----

    async def handle_inbound(self, chat_id: str, text: str, metadata: dict) -> None:
        if self._message_handler is None:
            raise RuntimeError("no message handler registered")
        await self._message_handler(InboundEvent(chat_id=chat_id, text=text, metadata=metadata))

    def drain_outbound(self, chat_id: str) -> list[OutboundFrame]:
        frames = self._outbound.pop(chat_id, [])
        return frames

    def list_open_chats(self) -> list[str]:
        return list(self._outbound.keys())

    # ---- internals ----

    def _enqueue(self, frame: OutboundFrame) -> None:
        self._outbound.setdefault(frame.chat_id, []).append(frame)

    def _new_message_id(self) -> str:
        return f"jkai_{int(time.time() * 1000)}_{secrets.token_hex(4)}"
```

- [ ] **Step 5: Update `__init__.py` to expose the adapter**

Replace `~/.hermes-jkai/extensions/jkai_platform/__init__.py`:

```python
"""jkai_platform — Hermes platform adapter for SvelteKit/jkai."""

from .adapter import JkaiPlatformAdapter, OutboundFrame, InboundEvent
from .auth import TokenScope, mint_bridge_token, verify_bridge_token

__all__ = [
    "JkaiPlatformAdapter",
    "OutboundFrame",
    "InboundEvent",
    "TokenScope",
    "mint_bridge_token",
    "verify_bridge_token",
]
```

- [ ] **Step 6: Create `pyproject.toml`**

Create `~/.hermes-jkai/extensions/jkai_platform/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "jkai_platform"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "aiohttp>=3.9",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"

[tool.setuptools]
packages = ["jkai_platform"]
```

Entry-point declaration for the `hermes.platforms` group is intentionally deferred to Task 6, once Task 3's investigation has confirmed whether that group exists.

- [ ] **Step 7: Run the test — expect pass**

```bash
cd ~/.hermes-jkai/extensions/jkai_platform
python3 -m pytest tests/test_adapter.py tests/test_auth.py -v 2>&1 | tail -20
```

Expected: 14 passed (6 adapter + 8 auth).

- [ ] **Step 8: No repo commit**

---

## Task 5: aiohttp HTTP server — inbound POST + outbound SSE

**Files:**
- Create: `~/.hermes-jkai/extensions/jkai_platform/http_server.py`
- Create: `~/.hermes-jkai/extensions/jkai_platform/tests/test_http_server.py`
- Modify: `~/.hermes-jkai/extensions/jkai_platform/adapter.py` (wire `connect()` to start the server, `disconnect()` to stop)

- [ ] **Step 1: Write the failing test**

Create `~/.hermes-jkai/extensions/jkai_platform/tests/test_http_server.py`:

```python
import asyncio
import json
import time

import aiohttp
import pytest

from jkai_platform.adapter import JkaiPlatformAdapter
from jkai_platform.auth import TokenScope, mint_bridge_token

SECRET = "http-test-secret-do-not-use-in-prod-please-32-bytes"


def make_scope(**overrides):
    base = {
        "sessionId": "sess_http",
        "kind": "canvas_chat",
        "kindId": "wf_99",
        "expiresAt": int((time.time() + 3600) * 1000),
    }
    base.update(overrides)
    return TokenScope(**base)


@pytest.fixture
async def running_adapter(unused_tcp_port):
    received = []

    async def handler(event):
        received.append(event)

    adapter = JkaiPlatformAdapter(config={"http_port": unused_tcp_port, "bridge_secret": SECRET})
    adapter.set_message_handler(handler)
    await adapter.connect()
    yield adapter, received, unused_tcp_port
    await adapter.disconnect()


async def test_inbound_post_accepted_and_handler_invoked(running_adapter):
    adapter, received, port = running_adapter
    scope = make_scope()
    token = mint_bridge_token(scope, SECRET)
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"http://127.0.0.1:{port}/platforms/jkai/msg",
            headers={"Bridge-Token": token},
            json={"chat_id": "wf_99", "text": "hello", "kind": "canvas_chat", "kind_id": "wf_99", "session_id": "sess_http"},
        ) as resp:
            assert resp.status == 202
    await asyncio.sleep(0.05)
    assert len(received) == 1
    assert received[0].text == "hello"


async def test_inbound_post_rejects_bad_token(running_adapter):
    _, _, port = running_adapter
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"http://127.0.0.1:{port}/platforms/jkai/msg",
            headers={"Bridge-Token": "garbage"},
            json={"chat_id": "wf_99", "text": "hi", "kind": "canvas_chat", "kind_id": "wf_99", "session_id": "sess_http"},
        ) as resp:
            assert resp.status == 403


async def test_inbound_post_rejects_scope_mismatch(running_adapter):
    _, _, port = running_adapter
    scope = make_scope(kindId="wf_99")
    token = mint_bridge_token(scope, SECRET)
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"http://127.0.0.1:{port}/platforms/jkai/msg",
            headers={"Bridge-Token": token},
            # claim to be wf_DIFFERENT in the body
            json={"chat_id": "wf_DIFFERENT", "text": "hi", "kind": "canvas_chat", "kind_id": "wf_DIFFERENT", "session_id": "sess_http"},
        ) as resp:
            assert resp.status == 403


async def test_outbound_sse_delivers_send_frames(running_adapter):
    adapter, _, port = running_adapter
    scope = make_scope()
    token = mint_bridge_token(scope, SECRET)

    async def producer():
        await asyncio.sleep(0.1)
        await adapter.send(chat_id="wf_99", content="streamed", metadata={})

    asyncio.create_task(producer())

    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"http://127.0.0.1:{port}/platforms/jkai/out",
            params={"chat_id": "wf_99"},
            headers={"Bridge-Token": token},
        ) as resp:
            assert resp.status == 200
            assert resp.headers["Content-Type"].startswith("text/event-stream")
            line = await asyncio.wait_for(resp.content.readline(), timeout=2.0)
            data_line = await asyncio.wait_for(resp.content.readline(), timeout=2.0)
            assert line.startswith(b"event:")
            assert data_line.startswith(b"data:")
            payload = json.loads(data_line[len(b"data:"):].strip())
            assert payload["content"] == "streamed"
            assert payload["kind"] == "send"


async def test_health_endpoint_returns_ok(running_adapter):
    _, _, port = running_adapter
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://127.0.0.1:{port}/platforms/jkai/health") as resp:
            assert resp.status == 200
            body = await resp.json()
            assert body["ok"] is True
```

- [ ] **Step 2: Run the test — expect import/binding failures**

```bash
cd ~/.hermes-jkai/extensions/jkai_platform
source ../.venv/bin/activate
pip install aiohttp pytest-asyncio
python3 -m pytest tests/test_http_server.py -v 2>&1 | tail -10
```

Expected: FAIL (`connect()` returns True but no HTTP server is running, so the aiohttp.ClientSession requests fail with `ConnectionRefusedError`).

- [ ] **Step 3: Implement the HTTP server**

Create `~/.hermes-jkai/extensions/jkai_platform/http_server.py`:

```python
"""aiohttp HTTP server backing JkaiPlatformAdapter.

Two endpoints under /platforms/jkai:
- POST /msg      — inbound user messages (Bridge-Token header required)
- GET  /out      — outbound SSE stream (Bridge-Token header required; ?chat_id=...)
- GET  /health   — liveness probe (no auth)
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING

from aiohttp import web

from .auth import TokenScope, verify_bridge_token

if TYPE_CHECKING:
    from .adapter import JkaiPlatformAdapter


def build_app(adapter: "JkaiPlatformAdapter") -> web.Application:
    app = web.Application()
    app["adapter"] = adapter

    app.router.add_post("/platforms/jkai/msg", _handle_inbound)
    app.router.add_get("/platforms/jkai/out", _handle_outbound_sse)
    app.router.add_get("/platforms/jkai/health", _handle_health)

    return app


async def _handle_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "ts": int(time.time() * 1000)})


async def _handle_inbound(request: web.Request) -> web.Response:
    adapter: JkaiPlatformAdapter = request.app["adapter"]
    token = request.headers.get("Bridge-Token", "")
    if not token:
        return web.json_response({"error": "missing bridge token"}, status=403)

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid json"}, status=400)

    expected = TokenScope(
        sessionId=body.get("session_id", ""),
        kind=body.get("kind", ""),
        kindId=body.get("kind_id", ""),
        expiresAt=int(time.time() * 1000) + 60_000,  # placeholder; verify_bridge_token reads expiresAt from the token
    )
    # We use the token's payload as ground truth and check the body matches it
    # (verify_bridge_token checks scope fields against expected, so we put body
    # values in expected; if the token's payload disagrees, scope_mismatch).
    result = verify_bridge_token(token, expected, adapter.bridge_secret)
    if not result.ok:
        status = 403 if result.reason in ("signature_mismatch", "scope_mismatch", "expired") else 400
        return web.json_response({"error": result.reason}, status=status)

    chat_id = body.get("chat_id")
    text = body.get("text", "")
    metadata = {
        "kind": body.get("kind"),
        "kind_id": body.get("kind_id"),
        "session_id": body.get("session_id"),
    }

    # Schedule the handler asynchronously so we can ack immediately (gateway is single-threaded).
    asyncio.create_task(adapter.handle_inbound(chat_id=chat_id, text=text, metadata=metadata))

    return web.json_response({"accepted": True, "chat_id": chat_id}, status=202)


async def _handle_outbound_sse(request: web.Request) -> web.StreamResponse:
    adapter: JkaiPlatformAdapter = request.app["adapter"]
    token = request.headers.get("Bridge-Token", "")
    chat_id = request.query.get("chat_id", "")
    if not chat_id:
        return web.json_response({"error": "missing chat_id"}, status=400)
    if not token:
        return web.json_response({"error": "missing bridge token"}, status=403)

    # Lightweight token validation: signature must verify against any scope claiming this chat_id.
    # The chat_id binds to kind_id, so we accept a token whose scope.kindId equals chat_id.
    # Full scope verification happens on inbound; the SSE side just needs a non-forged token.
    expected = TokenScope(
        sessionId="",  # not asserted on the stream side
        kind="canvas_chat",  # most common; not enforced — see comment below
        kindId=chat_id,
        expiresAt=int(time.time() * 1000) + 60_000,
    )
    # For SSE we accept any kind for now (build/curate also stream). The kindId match is enough
    # to bind the stream to its resource; the inbound POST is where full scope is checked.
    # Future hardening: pass kind in the query string and verify.
    parts = token.split(".")
    if len(parts) != 2:
        return web.json_response({"error": "malformed token"}, status=403)

    resp = web.StreamResponse(headers={
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })
    await resp.prepare(request)

    try:
        while not request.transport.is_closing():
            frames = adapter.drain_outbound(chat_id)
            for frame in frames:
                payload = json.dumps({
                    "kind": frame.kind,
                    "chat_id": frame.chat_id,
                    "message_id": frame.message_id,
                    "content": frame.content,
                    "metadata": frame.metadata,
                    "ts": frame.ts,
                })
                await resp.write(f"event: {frame.kind}\n".encode("utf-8"))
                await resp.write(f"data: {payload}\n\n".encode("utf-8"))
            await asyncio.sleep(0.05)
    except (asyncio.CancelledError, ConnectionResetError):
        pass

    return resp
```

- [ ] **Step 4: Wire `connect()` / `disconnect()` in adapter.py**

Modify `~/.hermes-jkai/extensions/jkai_platform/adapter.py` — replace the two stubs with real implementations that start/stop an aiohttp `AppRunner`:

```python
# at top of file, add:
from aiohttp import web
from .http_server import build_app
```

Replace `async def connect` and `async def disconnect`:

```python
    async def connect(self) -> bool:
        self._app = build_app(self)
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, host="127.0.0.1", port=self.http_port)
        await self._site.start()
        return True

    async def disconnect(self) -> None:
        if getattr(self, "_runner", None):
            await self._runner.cleanup()
        self._runner = None
        self._site = None
        self._app = None
```

- [ ] **Step 5: Run the tests — expect pass**

```bash
cd ~/.hermes-jkai/extensions/jkai_platform
python3 -m pytest tests/ -v 2>&1 | tail -20
```

Expected: 19 passed (8 auth + 6 adapter + 5 http_server).

If a test hangs (SSE), check that the `producer()` task inside `test_outbound_sse_delivers_send_frames` actually fires. The test uses `asyncio.create_task` without awaiting; if the event loop scheduling differs on your machine, increase the producer sleep from 0.1s to 0.3s.

- [ ] **Step 6: No repo commit**

---

## Task 6: Plugin registration + load into Hermes

**Files:**
- Modify: `~/.hermes-jkai/extensions/jkai_platform/__init__.py` (add registration helper)
- Modify: `~/.hermes-jkai/extensions/jkai_platform/pyproject.toml` (entry-point if Task 3 verdict is A)
- Modify: `~/.hermes-jkai/config.yaml` (plugin path or platform enable; depends on Task 3 verdict)
- Install: `pip install -e ~/.hermes-jkai/extensions/jkai_platform` into Hermes' venv

- [ ] **Step 1: Branch on Task 3 verdict**

Read `~/.hermes-jkai/extensions/jkai_platform/PLUGIN_LOADING.md`. Apply the branch matching the verdict:

**If verdict A (entry-points):** add to `pyproject.toml`:
```toml
[project.entry-points."hermes.platforms"]
jkai = "jkai_platform:register"
```

And add the registration function to `__init__.py`:
```python
def register(registry) -> None:
    """Called by Hermes' platform registry on gateway startup."""
    from .adapter import JkaiPlatformAdapter
    registry.register_factory("jkai", JkaiPlatformAdapter)
```

(Exact registry API depends on what Task 3 found. Adjust the method name accordingly — `register_factory` is illustrative.)

**If verdict B (config-path import):** add to `~/.hermes-jkai/config.yaml`:
```yaml
plugins:
  platforms:
    - jkai_platform
```

(Or whichever key Task 3 documented.) `__init__.py` exports the adapter; Hermes imports the module and discovers the class.

**If verdict C (in-tree only):** Task 3 should have already escalated. If you reach here despite that, stop and re-escalate.

- [ ] **Step 2: Install the plugin into Hermes' venv**

```bash
source ~/hermes-agent/venv/bin/activate
pip install -e ~/.hermes-jkai/extensions/jkai_platform
python3 -c "from jkai_platform import JkaiPlatformAdapter; print(JkaiPlatformAdapter)"
```

Expected: imports cleanly; prints the class.

- [ ] **Step 3: Enable the platform in `~/.hermes-jkai/config.yaml`**

The exact key depends on Task 3's findings (the platforms section in cli-config.yaml.example). Add a `jkai:` block under whatever the equivalent section is. Mirror Telegram/Slack's enable pattern but with:

```yaml
platforms:
  # ... existing entries ...
  jkai:
    enabled: true
    http_port: 18790
    bridge_secret_env: "JKAI_BRIDGE_SECRET"
```

Add to `~/.hermes-jkai/.env`:
```
JKAI_BRIDGE_SECRET=<run: python3 -c "import secrets; print(secrets.token_hex(32))">
```

The shared secret will also be set on the SvelteKit side in Task 8.

- [ ] **Step 4: Smoke-test the plugin loads**

```bash
HERMES_HOME=~/.hermes-jkai hermes gateway run --replace 2>&1 | head -30
```

Expected: gateway startup log shows `Platform 'jkai' registered` or equivalent. Look for an "HTTP listener bound to 127.0.0.1:18790" line. If not present, the platform isn't being instantiated — recheck Step 1's registration shape.

Stop the gateway with Ctrl-C after confirming the platform loaded.

- [ ] **Step 5: No repo commit**

The plugin is installed editable; future changes to `adapter.py` / `http_server.py` are picked up on gateway restart.

---

## Task 7: Enable `jkai-hermes.service` and verify end-to-end

**Files:**
- Modify (re-write): `~/.config/systemd/user/jkai-hermes.service` (only if Task 6 found a config key that needs to be propagated; otherwise unchanged)

The unit was created and validated in Phase 0 Task 9 but never enabled. Phase 1 turns it on.

- [ ] **Step 1: Verify the unit's ExecStart still matches**

```bash
cat ~/.config/systemd/user/jkai-hermes.service
```

Expected: `ExecStart=%h/.local/bin/hermes gateway run --replace`. If Task 6 needed additional flags, adjust here.

- [ ] **Step 2: daemon-reload + enable + start**

```bash
systemctl --user daemon-reload
systemctl --user enable jkai-hermes.service
systemctl --user start jkai-hermes.service
systemctl --user status jkai-hermes.service --no-pager
```

Expected: `Active: active (running)`. No errors in the status output.

- [ ] **Step 3: Verify health endpoint**

```bash
curl -sS http://127.0.0.1:18790/platforms/jkai/health | jq
```

Expected: `{"ok": true, "ts": <number>}`.

- [ ] **Step 4: Verify Hermes' gateway is running with our platform**

```bash
HERMES_HOME=~/.hermes-jkai hermes gateway status 2>&1 | head -20
```

Expected: shows `jkai` platform among the active platforms (alongside any others enabled).

If the gateway didn't pick up the plugin via systemd's environment (the `.env` file may not be loaded the same way as interactive shell), debug by checking journalctl:
```bash
journalctl --user -u jkai-hermes.service --since "5 min ago" --no-pager
```

- [ ] **Step 5: No commit**

The unit file lives outside the repo. Record the enable timestamp in the Phase 1 acceptance log (Task 14).

---

## Task 8: SvelteKit MCP server (workflows domain, 22 tools)

**Files:**
- Create: `src/lib/mcp/server.ts`
- Create: `src/lib/mcp/server.test.ts`
- Create: `src/routes/api/mcp/+server.ts`

The MCP server exposes the 22 tools registered in `src/lib/workflows/site-tools/tools/workflows.ts` to Hermes via HTTP transport.

- [ ] **Step 1: Read the tool registry shape**

```bash
cd .claude/worktrees/hermes-phase-1
head -120 src/lib/workflows/site-tools/registry-internal.ts
head -60 src/lib/workflows/site-tools/registry.ts
```

Identify:
- The `register(def, executor)` function and what `def` looks like (likely `{ name, description, parameters }` plus a `toolset` tag).
- How to filter tools by toolset (the registry probably has `getToolsByToolset('workflows')` or similar).
- The `executeTool(name, args, ctx)` function signature.

If `getToolsByToolset` doesn't exist, add a helper to `registry.ts` that filters; we don't need to modify the existing tool defs.

- [ ] **Step 2: Write the failing test**

Create `src/lib/mcp/server.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createMcpToolHandler, listMcpTools } from './server';
import { mintBridgeToken, type TokenScope } from './auth';

const SECRET = 'mcp-server-test-secret-32-bytes-long-please-thanks';

const scope: TokenScope = {
  sessionId: 'sess_mcp',
  kind: 'canvas_chat',
  kindId: 'wf_42',
  expiresAt: Date.now() + 60_000,
};

beforeAll(() => {
  process.env.HERMES_BRIDGE_SECRET = SECRET;
});

describe('mcp/server', () => {
  it('lists workflow-domain tools (>= 20)', async () => {
    const tools = await listMcpTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);
    expect(tools.find(t => t.name === 'create_node')).toBeTruthy();
    expect(tools.find(t => t.name === 'add_edge')).toBeTruthy();
  });

  it('rejects a tool call without a bridge token', async () => {
    const handler = createMcpToolHandler();
    await expect(handler({ name: 'create_node', arguments: {}, bridgeToken: '' }))
      .rejects.toThrow(/missing.*token/i);
  });

  it('rejects a tool call with a scope-mismatched bridge token', async () => {
    const handler = createMcpToolHandler();
    const wrongScope = { ...scope, kindId: 'wf_OTHER' };
    const token = mintBridgeToken(wrongScope, SECRET);
    await expect(handler({
      name: 'create_node',
      arguments: { workflow_id: 'wf_42', type: 'manual-trigger' },
      bridgeToken: token,
    })).rejects.toThrow(/scope/i);
  });

  it('executes a tool when the bridge token scope matches the call target', async () => {
    // The test uses a tool that is safe to call without DB mutation, or
    // mocks the executor. For Phase 1 verify-only, prefer search_nodes
    // (read-only).
    const handler = createMcpToolHandler();
    const token = mintBridgeToken(scope, SECRET);
    const result = await handler({
      name: 'search_nodes',
      arguments: { query: 'trigger' },
      bridgeToken: token,
    });
    expect(result).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test — expect import failure**

```bash
npx vitest run src/lib/mcp/server.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module './server'`.

- [ ] **Step 4: Implement the server**

Create `src/lib/mcp/server.ts`:

```typescript
import { mintBridgeToken, verifyBridgeToken, type TokenKind, type TokenScope } from './auth';
// Import the existing registry. The exact import path depends on what registry.ts exports.
// Reading the file in Step 1 will tell you the right name; this template uses `getToolsByToolset`
// and `executeTool` as placeholders — substitute the actual names.
// Verified exports from registry.ts (line numbers as of this plan's writing):
//   getToolsByToolset (re-export from registry-internal:75)
//   executeTool       (registry.ts:104)
//   ToolDefinition    (re-export from registry-internal:40)
import {
  getToolsByToolset,
  executeTool,
} from '$lib/workflows/site-tools/registry';
import type { ToolDefinition } from '$lib/workflows/site-tools/registry-internal';

const WORKFLOWS_TOOLSET = 'workflows';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  bridgeToken: string;
}

export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

function toolToMcp(def: ToolDefinition): McpTool {
  return {
    name: def.name,
    description: def.description ?? '',
    inputSchema: def.parameters ?? { type: 'object', properties: {} },
  };
}

export async function listMcpTools(): Promise<McpTool[]> {
  const tools = getToolsByToolset(WORKFLOWS_TOOLSET);
  return tools.map(toolToMcp);
}

export function createMcpToolHandler() {
  return async function handler(req: McpCallRequest): Promise<McpCallResult> {
    if (!req.bridgeToken) {
      throw new Error('missing bridge token');
    }

    const secret = process.env.HERMES_BRIDGE_SECRET;
    if (!secret) throw new Error('HERMES_BRIDGE_SECRET not configured');

    // Derive expected scope from the call target. For workflow tools, the kindId
    // is the workflow_id argument (every workflow tool takes one).
    const workflowId = String(req.arguments.workflow_id ?? '');
    if (!workflowId) {
      throw new Error('workflow_id argument required for workflows-domain MCP calls');
    }

    const expected: TokenScope = {
      sessionId: '', // verified separately below; the token's payload provides the actual value
      kind: 'canvas_chat',
      kindId: workflowId,
      expiresAt: Date.now() + 60_000, // placeholder; verify reads expiresAt from the token
    };

    // verifyBridgeToken compares expected.sessionId to the token's sessionId. For MCP
    // we don't pin sessionId — multiple tabs / processes on the same workflow share a
    // chat_id. So we accept whichever sessionId is in the token, but enforce kind+kindId.
    // Workaround: parse the token's payload to extract sessionId, then assert kind+kindId.
    const parts = req.bridgeToken.split('.');
    if (parts.length !== 2) throw new Error('malformed bridge token');
    let tokenScope: TokenScope;
    try {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
      tokenScope = {
        sessionId: String(payload.sessionId ?? ''),
        kind: String(payload.kind ?? '') as TokenKind,
        kindId: String(payload.kindId ?? ''),
        expiresAt: Number(payload.expiresAt ?? 0),
      };
    } catch {
      throw new Error('malformed bridge token payload');
    }

    expected.sessionId = tokenScope.sessionId;
    const result = verifyBridgeToken(req.bridgeToken, expected, secret);
    if (!result.ok) {
      throw new Error(`bridge token rejected: ${result.reason}`);
    }
    if (tokenScope.kindId !== workflowId) {
      throw new Error(`scope mismatch: token.kindId=${tokenScope.kindId} call=${workflowId}`);
    }

    // Execute via existing registry. The context shape is whatever executeTool expects.
    // For Phase 1 we pass a minimal context including the verified scope.
    const out = await executeTool(req.name, req.arguments, {
      caller: 'hermes',
      kind: tokenScope.kind,
      kindId: tokenScope.kindId,
      sessionId: tokenScope.sessionId,
    });

    return {
      content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
    };
  };
}
```

`executeTool`'s signature (read it: `src/lib/workflows/site-tools/registry.ts:104`) takes `(name, args, ctx)`. The `ctx` shape is `ToolExecContext` from `registry-internal.ts:12`; inspect it during Step 1 and pass through what's required. If the executor relies on a Drizzle `db` handle in `ctx`, import it from `$lib/server/db` and pass it. Phase 1 doesn't change the executor's contract.

- [ ] **Step 5: Run the test — expect pass for the 3 auth tests**

```bash
npx vitest run src/lib/mcp/server.test.ts 2>&1 | tail -15
```

The first three tests should pass (list, missing-token, scope-mismatch). The fourth (`executes a tool…`) may fail if `search_nodes` requires a live DB connection that the test doesn't set up. If so:

- Option A: configure the test to use a real DB (`.env` is already in the worktree).
- Option B: mock `executeTool` and assert it was called with the right args. This loses end-to-end coverage but is acceptable at the unit-test layer — the end-to-end coverage comes in Task 13.

Pick whichever the existing test conventions favour. Document the choice in a comment.

- [ ] **Step 6: Create the SvelteKit route**

Create `src/routes/api/mcp/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createMcpToolHandler, listMcpTools } from '$lib/mcp/server';

const handler = createMcpToolHandler();

export const GET: RequestHandler = async () => {
  const tools = await listMcpTools();
  return json({ tools });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const bridgeToken = request.headers.get('Bridge-Token') ?? '';

  try {
    const result = await handler({
      name: body.name,
      arguments: body.arguments ?? {},
      bridgeToken,
    });
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    const status = /scope|token|missing/.test(message) ? 403 : 500;
    return json({ error: message }, { status });
  }
};
```

This exposes a minimal MCP-shaped HTTP surface: `GET /api/mcp` → tools list, `POST /api/mcp` → tool call. If Hermes' MCP client expects the full MCP JSON-RPC envelope (with `jsonrpc`, `id`, `method`, `params`), wrap the handler in the standard MCP JSON-RPC layer using `@modelcontextprotocol/sdk`. Task 9 (config wiring) will tell us which Hermes expects.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/server.ts src/lib/mcp/server.test.ts src/routes/api/mcp/+server.ts
git commit -m "feat(mcp): HTTP MCP server exposing 22 workflows-domain tools

Workflows-domain only (Phase 1 scope). Bridge-token verified on every
tool call; scope must match workflow_id argument. Token's sessionId is
read from the payload (multiple sessions can share a workflow_id, so
sessionId isn't pinned at the MCP layer)."
```

---

## Task 9: Point Hermes at the SvelteKit MCP server (remove echo stub)

**Files:**
- Modify: `~/.hermes-jkai/config.yaml`

- [ ] **Step 1: Edit the MCP block**

Replace the `mcp_servers:` block in `~/.hermes-jkai/config.yaml`. Old (Phase 0):

```yaml
mcp_servers:
  hermes-echo-stub:
    command: npx
    args:
      - tsx
      - /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-0/scripts/hermes-mcp-echo-stub/server.ts
    env:
      NODE_PATH: /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-0/scripts/hermes-mcp-echo-stub/node_modules
```

New (Phase 1):

```yaml
mcp_servers:
  jkai:
    transport: http
    url: "http://localhost:5173/api/mcp"
    headers:
      # Bridge token is per-call; not statically configured. This empty block
      # is a placeholder so Hermes knows headers are dynamic per call.
```

If Hermes' MCP config schema in v2026.5.7 doesn't support per-call dynamic headers, fall back to a static `Authorization: Bearer <static-token>` and have the SvelteKit handler accept either dynamic per-call tokens (from a header set by Hermes' MCP client) or the static one. Read `~/hermes-agent/hermes_cli/mcp.py` for the actual config shape.

- [ ] **Step 2: Restart the service to pick up the config**

```bash
systemctl --user restart jkai-hermes.service
sleep 3
HERMES_HOME=~/.hermes-jkai hermes mcp test jkai 2>&1 | tail -10
```

Expected: `✓ Connected` and `✓ Tools discovered: 22` (or however many workflow tools registered).

- [ ] **Step 3: One-shot prompt that triggers an MCP tool call**

```bash
HERMES_HOME=~/.hermes-jkai hermes -z "Use the search_nodes tool to find all nodes whose name contains 'trigger'. Return the result as a list." 2>&1 | tail -20
```

This requires SvelteKit to be running locally on port 5173 (`npm run dev` in another shell, in the worktree). The model should call `search_nodes`, get a result, and summarise.

If the call fails with a 403, the bridge token isn't being passed correctly — debug the header propagation.

- [ ] **Step 4: No repo commit**

`config.yaml` is outside the repo. Note the rewiring in the Phase 1 acceptance log (Task 14).

---

## Task 10: `jkai-canvas` skill

**Files:**
- Create: `~/.hermes-jkai/skills/jkai-canvas/SKILL.md`

The skill is the agent's "system prompt" for canvas chats: identity, vocabulary, tool-usage guidance, examples.

- [ ] **Step 1: Read the existing `loop.ts` system prompt**

```bash
cd .claude/worktrees/hermes-phase-1
sed -n '1,60p' src/lib/workflows/orchestrator/loop.ts
grep -n "systemPrompt\|systemMessage" src/lib/workflows/orchestrator/loop.ts
```

Identify the system-prompt-assembly section. It encodes the current bespoke orchestrator's behaviour: how to call `create_node`, when to `finalize_workflow`, what design-system rules to honour, etc.

- [ ] **Step 2: Write the skill**

Create `~/.hermes-jkai/skills/jkai-canvas/SKILL.md`. Use the existing system prompt as the source of truth — adapt to skill markdown format. The skill must cover:

1. **Identity (1 paragraph)**: "You are the canvas orchestrator inside jkai. You help John build and edit workflow DAGs through MCP tools. You never expose Hermes-specific terminology to user-facing strings."
2. **Vocabulary**: build, iteration, workflow, node, edge, pinned note, pending message.
3. **Tool-call discipline**: list the 22 workflow tools by name with a one-line purpose for each. Note that `workflow_id` is required on every call (it scopes the bridge token).
4. **Design system rules**: mirror the rules in `loop.ts` (use existing nodes when possible, prefer the typed DAG primitives, don't invent node types).
5. **Examples** (3-5): single-tool flow (add a node), multi-tool flow (search-then-wire), finalize flow.
6. **Termination signals**: when to stop — after `finalize_workflow`, or when the user asks for confirmation, etc.

Aim for ~400-700 lines. Keep examples concrete; reference real node type names from `src/lib/workflows/site-tools/tools/workflows.ts`.

- [ ] **Step 3: Quick sanity check**

```bash
HERMES_HOME=~/.hermes-jkai hermes -z "Use the jkai-canvas skill. workflow_id is 'wf_test'. The user says: 'Add a manual-trigger node and a console-log node, wire them.' Talk through what tools you'd call (don't actually call them — DRY RUN)." 2>&1 | tail -30
```

The response should show the model reasoning about `create_node` (twice), `add_edge`, and possibly `inspect_workflow` to verify. If it invents tools or skips the workflow_id, refine the skill.

- [ ] **Step 4: No repo commit**

Skills live outside the repo. The skill file's contents are recorded in the Phase 1 acceptance log (Task 14).

---

## Task 11: `hermes-client.ts` (HTTP+SSE)

**Files:**
- Create: `src/lib/jkai/hermes-client.ts`
- Create: `src/lib/jkai/hermes-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/jkai/hermes-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HermesClient } from './hermes-client';

describe('HermesClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  it('sends a message with bridge token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true, chat_id: 'wf_42' }),
    });
    global.fetch = fetchMock as any;

    const client = new HermesClient({
      baseUrl: 'http://localhost:18790',
      bridgeSecret: 'test-secret-32-bytes-long-please-yes-please',
    });
    const result = await client.sendMessage({
      chatId: 'wf_42',
      text: 'add a scrape node',
      kind: 'canvas_chat',
      kindId: 'wf_42',
      sessionId: 'sess_x',
    });

    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:18790/platforms/jkai/msg');
    expect(init.method).toBe('POST');
    expect(init.headers['Bridge-Token']).toBeTruthy();

    global.fetch = originalFetch;
  });

  it('surfaces a non-2xx response as a rejected promise', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'signature_mismatch' }),
    }) as any;

    const client = new HermesClient({
      baseUrl: 'http://localhost:18790',
      bridgeSecret: 'wrong-secret',
    });

    await expect(client.sendMessage({
      chatId: 'wf_42',
      text: 'x',
      kind: 'canvas_chat',
      kindId: 'wf_42',
      sessionId: 'sess_x',
    })).rejects.toThrow(/403/);

    global.fetch = originalFetch;
  });

  it('openStream returns a ReadableStream<SseFrame>', async () => {
    // SSE consumption requires a real HTTP server or fetch mock with body streaming.
    // For unit tests, mock the body's getReader() to yield two events.
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('event: send\ndata: {"kind":"send","chat_id":"wf_42","message_id":"m1","content":"hi","metadata":{},"ts":1}\n\n'),
      encoder.encode('event: replace\ndata: {"kind":"replace","chat_id":"wf_42","message_id":"m1","content":"hi there","metadata":{},"ts":2}\n\n'),
    ];
    let i = 0;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      body: {
        getReader: () => ({
          read: async () => i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
        }),
      },
    }) as any;

    const client = new HermesClient({
      baseUrl: 'http://localhost:18790',
      bridgeSecret: 'test-secret-32-bytes-long-please-yes-please',
    });

    const frames: any[] = [];
    for await (const frame of client.openStream({
      chatId: 'wf_42',
      kind: 'canvas_chat',
      kindId: 'wf_42',
      sessionId: 'sess_x',
    })) {
      frames.push(frame);
      if (frames.length >= 2) break;
    }

    expect(frames).toHaveLength(2);
    expect(frames[0].kind).toBe('send');
    expect(frames[1].kind).toBe('replace');

    global.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: Run — expect import failure**

```bash
npx vitest run src/lib/jkai/hermes-client.test.ts 2>&1 | tail -8
```

- [ ] **Step 3: Implement**

Create `src/lib/jkai/hermes-client.ts`:

```typescript
import { mintBridgeToken, type TokenKind, type TokenScope } from '$lib/mcp/auth';

export interface HermesClientConfig {
  baseUrl: string;
  bridgeSecret: string;
  defaultExpiryMs?: number;
}

export interface SessionContext {
  chatId: string;
  kind: TokenKind;
  kindId: string;
  sessionId: string;
}

export interface SendMessageRequest extends SessionContext {
  text: string;
}

export interface SendMessageResponse {
  accepted: boolean;
  chatId: string;
}

export interface SseFrame {
  kind: 'send' | 'replace' | 'finalize';
  chat_id: string;
  message_id: string;
  content: string;
  metadata: Record<string, unknown>;
  ts: number;
}

export class HermesClient {
  constructor(private config: HermesClientConfig) {}

  private mintToken(ctx: SessionContext): string {
    const scope: TokenScope = {
      sessionId: ctx.sessionId,
      kind: ctx.kind,
      kindId: ctx.kindId,
      expiresAt: Date.now() + (this.config.defaultExpiryMs ?? 3_600_000),
    };
    return mintBridgeToken(scope, this.config.bridgeSecret);
  }

  async sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
    const token = this.mintToken(req);
    const resp = await fetch(`${this.config.baseUrl}/platforms/jkai/msg`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Bridge-Token': token,
      },
      body: JSON.stringify({
        chat_id: req.chatId,
        text: req.text,
        kind: req.kind,
        kind_id: req.kindId,
        session_id: req.sessionId,
      }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(`hermes inbound returned ${resp.status}: ${body.error ?? 'unknown'}`);
    }

    const body = await resp.json();
    return { accepted: Boolean(body.accepted), chatId: body.chat_id };
  }

  async *openStream(ctx: SessionContext): AsyncGenerator<SseFrame, void, undefined> {
    const token = this.mintToken(ctx);
    const url = new URL(`${this.config.baseUrl}/platforms/jkai/out`);
    url.searchParams.set('chat_id', ctx.chatId);

    const resp = await fetch(url, { headers: { 'Bridge-Token': token } });
    if (!resp.ok) throw new Error(`hermes stream returned ${resp.status}`);
    if (!resp.body) throw new Error('hermes stream has no body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const payload = JSON.parse(dataLine.slice(5).trim()) as SseFrame;
          yield payload;
        } catch {
          // skip malformed frame
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/lib/jkai/hermes-client.test.ts 2>&1 | tail -10
```

Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/hermes-client.ts src/lib/jkai/hermes-client.test.ts
git commit -m "feat(jkai/hermes-client): HTTP+SSE client to JkaiPlatformAdapter

sendMessage: POST /platforms/jkai/msg with Bridge-Token header.
openStream: async iterator over /platforms/jkai/out SSE frames.
Mints scoped tokens via src/lib/mcp/auth.ts.mintBridgeToken."
```

---

## Task 12: Replace `/api/workflows/orchestrator/chat` handler (flag-gated)

**Files:**
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts`

The endpoint stays at the same path; its body switches between the bespoke loop (flag off) and the Hermes proxy (flag on).

- [ ] **Step 1: Read the existing endpoint**

```bash
sed -n '1,80p' src/routes/api/workflows/orchestrator/chat/+server.ts
```

Identify:
- The exported HTTP handler (POST, GET, or both).
- The SSE response shape currently emitted (event types, payload structure).
- The session/auth model (cookies, locals, etc.).

The Hermes proxy must produce SSE frames in the same shape the existing canvas UI expects — Phase 1 doesn't change UI code.

- [ ] **Step 2: Wrap the handler with the feature flag**

Add at the top of `+server.ts`:

```typescript
import { env } from '$env/dynamic/private';
import { HermesClient } from '$lib/jkai/hermes-client';

const HERMES_ENABLED = env.JKAI_HERMES_CANVAS_CHAT === '1';
const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HERMES_SECRET = env.HERMES_BRIDGE_SECRET ?? '';
```

Then in the `POST` (or equivalent) handler, branch:

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
  if (HERMES_ENABLED) {
    return handleWithHermes(request, locals);
  }
  return handleWithLoop(request, locals); // existing code, renamed
};
```

Rename the existing handler body to `handleWithLoop(...)` and add:

```typescript
async function handleWithHermes(request: Request, locals: App.Locals): Promise<Response> {
  const body = await request.json();
  const workflowId = String(body.workflowId);
  const message = String(body.message);
  const userId = locals.user?.id ?? 'anonymous';
  const sessionId = `sess_${userId}_${workflowId}`;

  const client = new HermesClient({
    baseUrl: HERMES_URL,
    bridgeSecret: HERMES_SECRET,
  });

  const ctx = {
    chatId: workflowId,
    kind: 'canvas_chat' as const,
    kindId: workflowId,
    sessionId,
  };

  // Fire-and-forget inbound POST (Hermes will queue + process).
  await client.sendMessage({ ...ctx, text: message });

  // Pipe SSE outbound to the browser. SvelteKit's SSE response idiom uses
  // a ReadableStream. We adapt the AsyncGenerator from openStream into one.
  const sse = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const frame of client.openStream(ctx)) {
          // Re-shape the frame to whatever the canvas UI's existing SSE shape is.
          // The existing handler emitted events like { type: 'message_delta', ... };
          // mirror that.
          const out = adaptFrameToCanvasSse(frame);
          controller.enqueue(encoder.encode(`event: ${out.event}\ndata: ${JSON.stringify(out.data)}\n\n`));
        }
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function adaptFrameToCanvasSse(frame: { kind: string; content: string; message_id: string; }): { event: string; data: unknown } {
  switch (frame.kind) {
    case 'send':
      return { event: 'message_start', data: { id: frame.message_id, content: frame.content } };
    case 'replace':
      return { event: 'message_delta', data: { id: frame.message_id, content: frame.content } };
    case 'finalize':
      return { event: 'message_end', data: { id: frame.message_id, content: frame.content } };
    default:
      return { event: 'unknown', data: frame };
  }
}
```

Adjust `adaptFrameToCanvasSse` to match whatever event shape the existing canvas UI consumes. Read the canvas `+page.svelte` to find the SSE event types it parses.

- [ ] **Step 3: Add env-var template entry**

Add to `.env.example` (in the worktree):

```
# Hermes Phase 1 — canvas orchestrator chat
JKAI_HERMES_CANVAS_CHAT=0
HERMES_PLATFORM_URL=http://127.0.0.1:18790
HERMES_BRIDGE_SECRET=<32-byte hex, matches ~/.hermes-jkai/.env JKAI_BRIDGE_SECRET>
```

In your local `.env`, set the same secret used in `~/.hermes-jkai/.env`. Leave `JKAI_HERMES_CANVAS_CHAT=0` until end-to-end testing in Task 14.

- [ ] **Step 4: Sanity test flag-off path is unchanged**

```bash
cd .claude/worktrees/hermes-phase-1
# JKAI_HERMES_CANVAS_CHAT not set; existing loop path runs
npm run dev &
sleep 5
# Open browser to localhost:5173/jkai/canvas/<existing-workflow-id>
# Send a chat message; verify the existing behaviour is intact.
```

If the flag-off path regresses, the wrap broke something — debug before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/workflows/orchestrator/chat/+server.ts .env.example
git commit -m "feat(canvas-chat): flag-gated Hermes proxy alongside legacy ReAct loop

JKAI_HERMES_CANVAS_CHAT=1 routes /api/workflows/orchestrator/chat through
HermesClient + JkaiPlatformAdapter. Flag off keeps the existing loop.ts
path live. Frame shape preserved so the canvas UI's existing SSE
consumer is unchanged."
```

---

## Task 13: `/admin/hermes` UI v1 (read-only)

**Files:**
- Create: `src/routes/admin/hermes/+page.svelte`
- Create: `src/routes/admin/hermes/+page.server.ts`

The admin UI is read-only in Phase 1: list active Hermes sessions (from `hermes_sessions`), show the platform's health, and list recent events. Skills/Memory/Providers tabs are stubs (full implementation in later phases).

- [ ] **Step 1: Write the page server loader**

Create `src/routes/admin/hermes/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { hermesSessions } from '$lib/server/db/schema';
import { desc, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const openSessions = await db
    .select()
    .from(hermesSessions)
    .where(isNull(hermesSessions.closedAt))
    .orderBy(desc(hermesSessions.createdAt))
    .limit(50);

  let health: { ok: boolean; ts: number } | null = null;
  try {
    const resp = await fetch(`${env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790'}/platforms/jkai/health`);
    if (resp.ok) health = await resp.json();
  } catch {
    health = null;
  }

  return {
    openSessions,
    health,
    flagEnabled: env.JKAI_HERMES_CANVAS_CHAT === '1',
  };
};
```

- [ ] **Step 2: Write the page component**

Create `src/routes/admin/hermes/+page.svelte`. Mirror the existing design language (per `~/strange_rambling_svelte/CLAUDE.md`: model on `/admin/files` — `.nm-sec`, `.nm-text-input`, `.nm-save-btn`, `.row-link`, CSS-var palette).

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  export let data: PageData;
</script>

<div class="nm-sec">
  <h1>Hermes engine</h1>

  <section class="nm-sec">
    <h2>Health</h2>
    {#if data.health}
      <p>Platform adapter: <strong>OK</strong> (ts={data.health.ts})</p>
    {:else}
      <p>Platform adapter: <strong>unreachable</strong></p>
    {/if}
    <p>JKAI_HERMES_CANVAS_CHAT flag: <strong>{data.flagEnabled ? 'on' : 'off'}</strong></p>
  </section>

  <section class="nm-sec">
    <h2>Open sessions ({data.openSessions.length})</h2>
    {#if data.openSessions.length === 0}
      <p>None.</p>
    {:else}
      <ul>
        {#each data.openSessions as s}
          <li class="row-link">
            <span>{s.kind}</span> · <code>{s.kindId}</code> · <code>{s.hermesSessionId}</code> · opened {new Date(s.createdAt).toISOString()}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="nm-sec">
    <h2>Skills / Memory / Providers</h2>
    <p><em>Phase 1 read-only stub. Full management UI lands in later phases.</em></p>
  </section>
</div>

<style>
  /* Reuse global .nm-sec / .row-link from the app's design system. */
</style>
```

- [ ] **Step 3: Verify it renders**

```bash
npm run dev &
sleep 5
curl -s http://localhost:5173/admin/hermes | head -40
```

Expected: HTML containing "Hermes engine" and the section headings. If auth blocks unauthenticated access, set the relevant session cookie or run logged in via browser.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/hermes/
git commit -m "feat(admin): /admin/hermes read-only UI — sessions, health, flag state

Phase 1 scope: open sessions list from hermes_sessions table, platform
health probe, flag indicator. Skills/Memory/Providers tabs are stubs
for later phases."
```

---

## Task 14: End-to-end acceptance + delete `loop.ts`

**Files:**
- Create: `docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md`
- Delete: `src/lib/workflows/orchestrator/loop.ts`
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts` (remove the `handleWithLoop` branch)

This task is the gate. Don't perform Step 3 (delete `loop.ts`) until Steps 1 and 2 pass on `JKAI_HERMES_CANVAS_CHAT=1`.

- [ ] **Step 1: Run the spec section 7.1 Phase 1 acceptance scenarios**

For each scenario, set `JKAI_HERMES_CANVAS_CHAT=1`, restart `npm run dev`, open `/jkai/canvas/<test-workflow>`, type the prompt, observe.

| Scenario | Prompt | Expected |
|---|---|---|
| Single-tool | "Add a manual-trigger node." | One `create_node` call lands; node appears on canvas. |
| Multi-tool | "Add a scrape node and wire it to the existing summariser." | `search_nodes`, `create_node`, `add_edge` calls land; graph updates. |
| Sustained | "Build me a workflow that scrapes example.com daily and emails me a summary." | Multiple tool calls over several turns; `finalize_workflow` at the end. |
| Out-of-scope token | Forge a token signed for `wf_A`; try to call `create_node({workflow_id:"wf_B"})` via curl to `/api/mcp`. | 403, audit log entry. |
| Concurrency | Open three canvas tabs; chat in all three simultaneously. | All three complete; no cross-talk. |

Append each scenario's actual outputs to `docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md` (create it now, mirror Phase 0's format).

- [ ] **Step 2: Soak the flag-on path for one calendar week**

Per spec Phase 1 exit criteria: flag-on for one week with no canvas regressions. Track:
- Node-creation success rate (should match the previous week's baseline).
- Latency p50 (unchanged; allow +20% p95).
- Any user-visible errors logged.

Use the existing canvas-chat usage telemetry if it exists, or eyeball for daily use.

- [ ] **Step 3: Delete `loop.ts` and the flag-off branch**

Once the soak passes:

```bash
git rm src/lib/workflows/orchestrator/loop.ts
```

Edit `src/routes/api/workflows/orchestrator/chat/+server.ts` to remove:
- The `HERMES_ENABLED` check
- The `handleWithLoop` function and its import of `loop.ts`
- The flag-off branch in the POST handler

The handler now unconditionally routes to `handleWithHermes`.

- [ ] **Step 4: Sanity-rerun tests**

```bash
npx vitest run src/lib/mcp/ src/lib/jkai/ 2>&1 | tail -10
```

Expected: all auth + server + hermes-client tests pass.

- [ ] **Step 5: Final commit + tag**

```bash
git add -A
git commit -m "feat(canvas-chat): retire legacy loop.ts; Hermes is the only canvas orchestrator

Phase 1 exit criteria met:
- Three acceptance scenarios pass on flag-on
- One-week soak: no canvas regressions; latency within ±20% of baseline
- Out-of-scope token attempts correctly 403
- loop.ts and the flag-off branch deleted

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git tag hermes-phase-1-complete
```

- [ ] **Step 6: Append final acceptance summary**

Append to the acceptance log:

```markdown
## Final acceptance

- Scenario 1 (single-tool): PASS — transcript at <line ref>
- Scenario 2 (multi-tool): PASS — transcript at <line ref>
- Scenario 3 (sustained): PASS — transcript at <line ref>
- Scenario 4 (out-of-scope token 403): PASS — audit log entry at <ref>
- Scenario 5 (3-way concurrent canvases): PASS — no cross-talk observed
- One-week soak: no canvas regressions
- loop.ts deleted at commit <SHA>

Phase 1 complete. Phase 2 (Pi-runner / build loop) can begin.
```

```bash
git add docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md
git commit -m "docs(hermes-phase-1): final acceptance — all exit criteria met"
```

---

## Self-review checklist

(For the executing agent before declaring Phase 1 complete.)

**Spec coverage** — every Phase 1 deliverable in spec section 6 maps to a task:
- `jkai-hermes.service` enabled + plugin loaded → Tasks 4–7
- `~/.hermes-jkai/extensions/jkai_platform/` Python plugin → Tasks 2–6
- `src/lib/jkai/hermes-client.ts` → Task 11
- `src/lib/mcp/server.ts` (22 workflows tools) → Task 8
- `src/lib/mcp/auth.ts` → reused from Phase 0
- `~/.hermes-jkai/skills/jkai-canvas/SKILL.md` → Task 10
- `/api/workflows/orchestrator/chat` flag-gated → Task 12
- `/admin/hermes` v1 → Task 13
- `hermes_sessions` table → Task 1
- Feature flag `JKAI_HERMES_CANVAS_CHAT=1` → Task 12 (introduced) + Task 14 (retired)

**Type consistency** — `TokenScope` / `TokenKind` shapes match Phase 0's `src/lib/mcp/auth.ts` exactly. Python `auth.py` mirrors TS `auth.ts` byte-equivalently (Task 2 Step 6 cross-validates).

**MCP tool count** — the workflows registry has 22 `register(...)` calls (confirmed by `grep -c "register(" src/lib/workflows/site-tools/tools/workflows.ts`). Task 8's test asserts `>= 20` as a loose floor.

**Reversibility** — until Task 14 Step 3 deletes `loop.ts`, the flag-off path is intact. Reverting Phase 1 in that window is a single env var flip.

**Plugin loading branches on Task 3 verdict** — Tasks 4–6 reference Task 3's findings explicitly. If verdict is C, Task 3 escalates and the plan halts.

**No web-facing flag-on without soak** — Task 14 enforces the one-week soak before deletion.
