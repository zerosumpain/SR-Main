# jkai Prefill Reduction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut first-response prefill on a fresh `/jkai` conversation from ~45k tokens to ~10–15k, putting warm-call first-token latency under 3s and cold-call under 5s.

**Architecture:** Three independent fixes against the static prefill cost. Ordered by ratio of (impact / effort / risk). Each phase is shippable on its own and revertable.

**Tech Stack:** Hermes Python (gateway + jkai_platform plugin), SvelteKit MCP server.

**Repos touched:**
- `/home/john/.hermes-jkai/` (Hermes config + jkai_platform plugin) — Fix 1, Fix 3
- `/home/john/strange_rambling_svelte/` (MCP server + workflows) — Fix 2 (the meta-tool)
- `/home/john/hermes-agent/` — Fix 2 only if Hermes-side tool plumbing needs changes (likely not)

**Hermes restart required:** after every fix (Hermes loads jkai_platform on startup).

---

## Diagnostic baseline (already collected — 2026-05-27)

Captured via temporary payload dump on `agent/chat_completion_helpers.py`. Now reverted.

A fresh `/jkai` chat with prompt `"Hey!"`:

| Slice | Tokens | Notes |
|---|---|---|
| System message | 5,449 | Identity + tool-use enforcement + skills index + project context (`/home/john/CLAUDE.md`) + current-session context. **Already lean.** |
| Tool definitions | 28,000 | **133 tools** = 29 Hermes built-ins (cronjob, delegate_task, terminal, session_search, skill_manage, etc.) + 104 jkai MCP tools |
| User message | **11,847** | **Surprise:** 11.8k of this is the full `~/.hermes-jkai/skills/jkai-general/SKILL.md` file injected ahead of `"Hey!"` (the actual user text) |
| **Total prefill** | **~45,296** | |

Observed first-chunk latency at z.ai GLM-5-turbo ≈ 0.15ms/token, so 45k → 6–7s, plus 1–2s of pipeline = 8–9s.

Hermes log line proving the injection (sampled from `/tmp/jkai_prompt_dump.json` during diagnostic):
```
[user message head]
  "[IMPORTANT: The 'jkai-general' skill is auto-loaded. Follow its instructions for this session.]
  ---
  name: jkai-general
  description: ...
  ... <25kb of jkai-general SKILL.md content> ...
  [Skill directory: /home/john/.hermes-jkai/skills/jkai-general]
  Hey!"
```

This is the root cause of the warm-call latency: the skill content lives in the cache-busting per-turn slot instead of the cached system-prompt slot.

---

## Phase 1 — Move auto-loaded skill into the cached system prompt

**Goal:** stop paying 6.4k of prefill per turn for content that's identical across the entire chat.

**Files:**
- Modify: `/home/john/.hermes-jkai/extensions/jkai_platform/adapter.py` (find the skill-injection site; relocate the content to a system-prompt addendum)
- Test: extend `/home/john/.hermes-jkai/extensions/jkai_platform/tests/test_adapter.py` with a payload-shape assertion

**Background:** Currently the jkai_platform adapter, when handling inbound messages, prepends the active skill's full SKILL.md to the user content. We need to keep the LLM aware of the skill (so behavior is identical) but move the content to a slot Hermes will cache.

Hermes' `system_prompt.py` doc explicitly says: *"The agent's system prompt is built once per session and reused across all turns — only context compression triggers a rebuild. This keeps the upstream prefix cache warm."*

Two viable approaches:

**Approach A (preferred):** Pass the skill content via `system_message` parameter when calling `AIAgent.advance()` / equivalent — Hermes already supports per-session system message addenda (the "context" tier in `build_system_prompt_parts`). Once set per session, it's part of the cached prefix.

**Approach B (fallback):** Use Hermes' native `skill_view` tool — let the LLM call it once per session to load the skill. Adds one round-trip to turn 1, but turn-2+ has the content in conversation history (which IS cached by z.ai's prefix cache up to the divergence point).

Pick A. B is for the next phase (Fix 2-equivalent for skills).

### Tasks

- [ ] **Step 1: Locate the skill-injection site in `jkai_platform/adapter.py`.**

```bash
cd /home/john/.hermes-jkai
grep -n "auto-loaded\|skill is auto\|skill_directory\|prepend.*skill\|SKILL\.md" extensions/jkai_platform/adapter.py | head -10
```

Find the function that builds the user payload (probably `handle_inbound` or a helper called from it). Confirm exactly how the skill content gets concatenated to the user text.

- [ ] **Step 2: Verify the AIAgent / inbound API surface supports a per-session `system_message`.**

Read `/home/john/hermes-agent/agent/conversation_loop.py:235` (signature for `system_message` parameter) and `/home/john/hermes-agent/agent/system_prompt.py:67` (`build_system_prompt_parts`). Confirm `system_message` is the right kwarg for context addenda that should be cached.

Specifically verify: is `system_message` rebuilt every turn, or set once per session? If every turn, this approach is no better than the current state — fall back to Approach B (use `skill_view`).

- [ ] **Step 3: Refactor the injection point.**

Replace the per-turn user-message prefix with a one-time-per-session system-message addendum. Sketch:

```python
# In adapter.py, where the skill is currently injected:

# BEFORE: user content includes the skill
# user_text = f"[IMPORTANT: ...]\n---\n{skill_md_content}\n---\n[Skill directory: ...]\n\n{user_text}"

# AFTER: skill goes to system_message (cached), user text is bare
session_state = self._session_state(chat_id)
if not session_state.get("skill_injected"):
    self._set_session_system_message(
        chat_id,
        f"[The '{skill_name}' skill is active for this chat. Follow its instructions.]\n\n"
        f"---\n{skill_md_content}\n---\n"
        f"[Skill directory: {skill_dir}]\n"
    )
    session_state["skill_injected"] = True
# user_text stays as the raw user input
```

Variable names are illustrative; match the actual style in adapter.py.

- [ ] **Step 4: Validate caching behavior with a 2-turn test.**

Restart Hermes. Open a new `/jkai` chat. Send `"Hi"`. Wait for response. Send `"What time is it?"`.

Read the agent.log:
```bash
tail -50 /home/john/.hermes-jkai/logs/agent.log | grep -E "api_call|cache="
```

Expected: turn 1 cache hit ratio low (cold), turn 2 cache hit ratio >90% on the cached prefix. The `in=` token count on turn 2 should drop noticeably vs. baseline (where the skill content was re-paying every turn).

- [ ] **Step 5: Re-run the diagnostic to confirm.**

Temporarily re-add the payload dump from step 1 of this conversation's diagnostic (or re-create from `git log`). Capture one fresh-session API payload, confirm:
- System message includes the skill content
- User message is the bare user text (~50 tokens for "Hi")
- Tools unchanged (~28k)

Revert the diagnostic immediately after.

- [ ] **Step 6: Commit (Hermes-jkai).**

```bash
cd /home/john/.hermes-jkai
git add extensions/jkai_platform/adapter.py extensions/jkai_platform/tests/test_adapter.py
git commit -m "perf(jkai_platform): move auto-loaded skill from user-msg to system addendum

The active per-chat skill (jkai-general / jkai-canvas / etc.) was being
prepended to every user message — putting ~6.4k tokens of identical
content in the cache-busting slot. Move it to a per-session system_message
addendum so Hermes' system-prompt cache absorbs it. Skill behavior is
preserved; warm-call prefill drops by ~6.4k tokens per turn after turn 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 7: Restart + verify.**

```bash
systemctl --user restart jkai-hermes
sleep 5
curl -sS http://127.0.0.1:18790/platforms/jkai/health
```

Send a conversation in `/jkai`. Check console for `[ttft] Xms` on turn 2 — should be noticeably lower than turn 1.

---

## Phase 2 — Trim the jkai-general SKILL.md content

**Goal:** halve the skill content for a permanent ~3k-token reduction (helps even after Phase 1 caches it, because turn-1 cold-start still pays for it).

**Files:**
- Modify: `/home/john/.hermes-jkai/skills/jkai-general/SKILL.md`
- (Optional) similar pass on other large skills: `jkai-canvas` (36k chars), `jkai-utility` (19k chars), `jkai-scraper` (15k chars)

**Background:** The current jkai-general SKILL is 25,456 bytes / ~6,400 tokens. Top-level sections (from the dump):
- Identity, Vocabulary, When to route to a domain skill, Building static apps from chat
- 7 Examples (Email search, Health check, Blog draft, Cross-domain chained, Clarification, Workflow creation, Canvas edit redirect)
- Termination Signals

The 7 examples are the obvious target — each is multi-paragraph. LLMs typically learn from 1-2 well-chosen examples; 7 is redundant.

### Tasks

- [ ] **Step 1: Audit and identify cut candidates.**

Read `/home/john/.hermes-jkai/skills/jkai-general/SKILL.md` end-to-end. Mark candidate cuts:
- Examples that are largely redundant (e.g. if examples 1, 3, 4 cover the same routing pattern, keep just one)
- Verbose preambles
- Repeated guidance ("remember to...", "don't forget...")

Goal: get from ~25k chars to ~12k chars without losing distinct behaviors.

- [ ] **Step 2: Make the cuts in one pass.**

Use `Edit` (or rewrite the file fully via `Write`). Keep:
- Identity, Vocabulary (these are short and load-bearing)
- The routing decision tree (this is the core instruction)
- 2-3 best examples (one routing, one clarification, one cross-domain)
- Termination Signals (short, load-bearing)

Cut:
- Examples that duplicate routing logic
- Repeat instructions
- Long-winded prose about WHY

- [ ] **Step 3: Smoke-test the trimmed skill.**

Restart Hermes. Run 5 sample chats:
1. Plain greeting ("hi")
2. Health query ("how am I sleeping")
3. Cross-domain ("draft a blog post about my last 7 runs")
4. Clarification ("change the homepage")
5. Workflow ask ("build me a workflow that emails me when my training load is red")

Each should route correctly (jkai-health, blog, scheduling, etc.). If any miss obviously, the cut was too aggressive — add back the relevant example.

- [ ] **Step 4: Commit (Hermes-jkai).**

```bash
cd /home/john/.hermes-jkai
git add skills/jkai-general/SKILL.md
git commit -m "perf(skills): trim jkai-general SKILL by ~50%

Consolidated 7 examples to 3 distinct ones, cut verbose preambles, removed
duplicate routing guidance. Behavior verified across 5 smoke-test prompts.
Saves ~3k tokens on cold-start prefill; equally on every turn until Phase 1
ships (which moves the skill into the cached system prompt).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: (Optional follow-up) Repeat for jkai-canvas, jkai-utility, jkai-scraper if they look similarly verbose.**

Each is its own small commit. Don't bundle.

---

## Phase 3 — Meta-tool: collapse 133 tools to ~3–5 essentials + a router

**Goal:** cut the 28k-token tool manifest to ~3k by replacing 130 of the tools with a single dispatch tool that the LLM uses for discovery + invocation.

**Files:**
- Create: `/home/john/strange_rambling_svelte/src/lib/mcp/meta-tool.ts` (the dispatcher logic)
- Modify: `/home/john/strange_rambling_svelte/src/lib/mcp/jsonrpc.ts` (filter `tools/list` to essentials + meta-tool, route `tools/call` through dispatcher)
- Modify: `/home/john/strange_rambling_svelte/src/lib/mcp/tools/index.ts` (or wherever the registry lives — flag essentials vs. extended)
- Test: `/home/john/strange_rambling_svelte/src/lib/mcp/meta-tool.test.ts`

**Background:** This is the biggest single win on the board (~25k tokens) but also the highest-risk because it changes LLM behavior. New LLM-visible API:

```
ESSENTIALS (always in the manifest, ~3-5 tools, ~1-2k tokens):
  • save_memory(text)
  • recall_memories(query)
  • forget_memory(id)
  • schedule_reply_at(when, text)         ← user picked these as sticky
  • register_heartbeat_action(name, ...)
  • whatsapp_send(text)

META-TOOL (one new tool, ~500 tokens):
  jkai_extended(operation, args)
    operations:
      • "list"  → returns [{name, description}, ...] of all 128 extended tools
                  (filtered optionally by query string)
      • "schema" → returns full JSON schema for a single tool name
      • "invoke" → executes a tool by name with args, returns its result
```

Standard LLM flow:
1. User asks "search my email for X"
2. LLM sees no obvious tool in essentials → calls `jkai_extended({op: "list", query: "gmail"})`
3. Gets back: `[{name: "gmail_search", description: "..."}, {name: "gmail_get_message", ...}]`
4. Optionally calls `jkai_extended({op: "schema", name: "gmail_search"})` for full args
5. Calls `jkai_extended({op: "invoke", name: "gmail_search", args: {q: "..."}})`
6. Gets result, proceeds.

Round-trips on first tool use: 2-3 extra. But prefill drop is enormous, and most chats use 0-1 extended tools.

### Tasks

- [ ] **Step 1: Decide the essentials list.**

User has already chosen: `save_memory`, `recall_memories`, `forget_memory`, `schedule_reply_at`, `register_heartbeat_action`, `whatsapp_send`. Confirm in the registry which file these are defined in and add a `extended: false` flag (or move them to a separate `essential-tools.ts`).

For all other tools, default to `extended: true`.

- [ ] **Step 2: Write the meta-tool dispatcher.**

Create `/home/john/strange_rambling_svelte/src/lib/mcp/meta-tool.ts`:

```typescript
import type { Tool, ToolContext } from './types';  // adjust to actual types
import { getAllExtendedTools } from './registry';  // adjust to actual import

export const jkaiExtendedTool: Tool = {
  name: 'jkai_extended',
  description:
    "Discover and invoke jkai's extended tool catalogue (128 tools across " +
    "blog, health, workflow, gmail, research, scraper, files, build, " +
    "schedule, home-assistant, render, document, image, audio, and system " +
    "domains). Use 'list' to browse, 'schema' for full args, 'invoke' to call.",
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'schema', 'invoke'],
        description: "What to do: 'list' returns matching tool names + " +
          "one-line descriptions; 'schema' returns full args for one tool; " +
          "'invoke' executes a tool by name.",
      },
      query: {
        type: 'string',
        description: "For 'list': optional substring filter on name+description.",
      },
      name: {
        type: 'string',
        description: "For 'schema' and 'invoke': the tool name.",
      },
      args: {
        type: 'object',
        description: "For 'invoke': the tool's argument object.",
        additionalProperties: true,
      },
    },
    required: ['operation'],
  },
  handler: async (input, ctx: ToolContext) => {
    const { operation, query, name, args } = input;
    const allExtended = getAllExtendedTools();

    if (operation === 'list') {
      const matches = query
        ? allExtended.filter(t =>
            t.name.includes(query) || t.description.includes(query),
          )
        : allExtended;
      return matches.map(t => ({ name: t.name, description: t.description }));
    }

    if (operation === 'schema') {
      const tool = allExtended.find(t => t.name === name);
      if (!tool) return { error: `Unknown tool: ${name}` };
      return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
    }

    if (operation === 'invoke') {
      const tool = allExtended.find(t => t.name === name);
      if (!tool) return { error: `Unknown tool: ${name}` };
      return await tool.handler(args ?? {}, ctx);
    }

    return { error: `Unknown operation: ${operation}` };
  },
};
```

- [ ] **Step 3: Filter `tools/list` in the MCP server.**

In `/home/john/strange_rambling_svelte/src/lib/mcp/jsonrpc.ts`, the `tools/list` handler returns the full registry. Change it to:
- Return only `extended: false` tools (the essentials)
- Plus `jkaiExtendedTool` (the meta-tool)

The existing `tools/call` handler must continue to support direct calls to extended tools — Hermes' built-in tools (terminal, etc.) and the meta-tool's dispatch path both hit the same registry. Don't break that.

- [ ] **Step 4: Write the test.**

Create `/home/john/strange_rambling_svelte/src/lib/mcp/meta-tool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { jkaiExtendedTool } from '$lib/mcp/meta-tool';

describe('jkai_extended dispatcher', () => {
  const fakeCtx = { /* minimal stub */ } as any;

  it('list returns matching tool names', async () => {
    const result = await jkaiExtendedTool.handler!(
      { operation: 'list', query: 'gmail' }, fakeCtx,
    );
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).some(t => t.name.includes('gmail'))).toBe(true);
  });

  it('schema returns inputSchema for a known tool', async () => {
    const result: any = await jkaiExtendedTool.handler!(
      { operation: 'schema', name: 'gmail_search' }, fakeCtx,
    );
    expect(result.inputSchema).toBeDefined();
  });

  it('invoke dispatches to the real handler', async () => {
    // Use a safe read-only tool for the test
    const result = await jkaiExtendedTool.handler!(
      { operation: 'invoke', name: 'health_stats', args: {} }, fakeCtx,
    );
    expect(result).toBeDefined();
  });

  it('unknown tool returns an error object, not a throw', async () => {
    const result: any = await jkaiExtendedTool.handler!(
      { operation: 'invoke', name: 'does_not_exist', args: {} }, fakeCtx,
    );
    expect(result.error).toMatch(/unknown/i);
  });
});
```

Run: `npx vitest run src/lib/mcp/meta-tool.test.ts`

- [ ] **Step 5: Add a feature flag (allow rollback without revert).**

Behind `JKAI_MCP_META_TOOL=1` env var. When false (default initially), `tools/list` returns the full 104 tools as today. When true, returns essentials + meta-tool only.

This lets you ship the code with the flag off, then flip it for A/B testing.

In `jsonrpc.ts`:

```typescript
const META_TOOL_ENABLED = process.env.JKAI_MCP_META_TOOL === '1';

// In tools/list handler:
if (META_TOOL_ENABLED) {
  return [...getEssentialTools(), jkaiExtendedTool];
}
return getAllTools();  // legacy
```

- [ ] **Step 6: Type-check, build, commit, deploy (SvelteKit).**

```bash
cd /home/john/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npm run check
npm run build
git add src/lib/mcp/meta-tool.ts src/lib/mcp/jsonrpc.ts src/lib/mcp/meta-tool.test.ts \
        # plus whatever essentials-flag file you touched
git commit -m "feat(mcp): jkai_extended meta-tool collapses 128 tools to one dispatcher

New env-flagged tool catalogue. With JKAI_MCP_META_TOOL=1, tools/list
returns 6 essential tools + jkai_extended meta-tool (operations: list,
schema, invoke). Cuts MCP tools manifest from ~28k to ~3k tokens.

Default off (flag absent) — flip in production after manual smoke test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin master
~/strange_rambling_svelte/scripts/deploy.sh
```

- [ ] **Step 7: Flip the flag on VPS and live-test.**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38
cd /opt/strange-rambling-svelte
echo "JKAI_MCP_META_TOOL=1" >> .env
sudo systemctl restart strange-rambling-svelte
```

Restart Hermes locally to pick up the new MCP catalogue:
```bash
systemctl --user restart jkai-hermes
```

Send 5 test prompts in `/jkai`:
1. "hi" — should not need extended tools
2. "search my email for invoices" — should trigger `jkai_extended({op: 'list', query: 'gmail'})` then invoke
3. "what's my readiness today" — should hit the essential `health_*` tools (after Step 1 adds health_stats to essentials if you want it there)
4. "draft a blog post about my last 7 runs" — multi-tool, tests discovery flow
5. "schedule a heartbeat in 30 minutes" — direct essential

Watch `/tmp/jkai_prompt_dump.json` (re-add the diagnostic temporarily) on call #1 — total prefill should be ~15k or less.

- [ ] **Step 8: If smoke tests pass, leave the flag on. Document it.**

Add a paragraph to `~/strange_rambling_svelte/docs/jkai-tool-progress.md` (from the earlier Phase 6 plan) describing the meta-tool catalogue + when LLMs should call which operation.

If smoke tests fail (LLM doesn't drill in correctly), flip the flag off, investigate, iterate.

---

## Final projected state

After all three phases:

| Slice | Today | After P1 | After P1+P2 | After P1+P2+P3 |
|---|---|---|---|---|
| System message | 5.4k | 11.8k (skill moved in) | 8.4k (skill trimmed) | 8.4k |
| Tools | 28k | 28k | 28k | **3k** |
| User message | 12k | **~50 tok** | ~50 tok | ~50 tok |
| **Total prefill (cold turn 1)** | 45k | 40k | 36k | **~12k** |
| **Effective input (warm turn 2+)** | 12k (cache miss on user msg) | **~0 cache miss** | **~0** | **~0** |

**First-chunk latency (z.ai GLM-5-turbo, ~0.15ms/token):**

| State | Cold (turn 1) | Warm (turn 2+) |
|---|---|---|
| Today | 6.8s + overhead = 8–9s | 1.8s |
| After all 3 fixes | 1.8s + overhead = ~3s | <0.5s |

Sub-3s first-response on cold chat. Sub-second on warm.

---

## Risks & rollback

- **Phase 1:** Risk: Hermes' `system_message` parameter doesn't behave as expected for caching. Mitigation: Step 4 explicitly measures cache hit rates before committing. Rollback: single-file revert.

- **Phase 2:** Risk: a cut example was load-bearing for a behavior the user actually depends on. Mitigation: 5 smoke prompts in Step 3 cover the main routing surface. Rollback: `git revert` the SKILL.md commit.

- **Phase 3:** Risk: LLMs (especially GLM-5-turbo) may not consistently know to call `jkai_extended.list` when they need a non-essential tool — leading to "I can't do that" responses. Mitigation: env flag (Step 5) lets you flip off without a deploy. Also: ensure the `description` field of `jkai_extended` is unambiguous about what it covers. If GLM struggles, add a one-line hint to the essential-set system-prompt addendum: *"You have access to ~130 more tools via jkai_extended — call it with operation:'list' when you need to do something not covered by your built-in tools."*

---

## Out of scope (for follow-up)

- **Per-chat-kind essentials.** A canvas chat probably wants `workflow_*` in its essentials, while a general chat wants `blog_*`. The current plan uses one global essentials list. A per-kind override would shave further but adds complexity.
- **Prompt-caching `cache_control` hints** for Claude routing. z.ai may not support; check separately.
- **Hermes built-in tool trimming.** 29 built-ins is fewer than they look, but some (cronjob @ 1870 tok, delegate_task @ 1705 tok) are very heavy. Could be candidates for collapse into a similar Hermes-side meta-tool, but that's upstream work.
- **Async user-message DB write** (5–50ms saved on critical path; small).
