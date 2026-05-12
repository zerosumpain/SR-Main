# Hermes Phase 1.5 — General Chat via Skill-Organised Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Phase 1's Hermes coverage from canvas-only to also include the `/jkai` general chat hub. Replace the workflow-only toolset gate with Hermes' native skill system: one skill per existing toolset domain, with the agent self-selecting which skill applies to the current query.

**Architecture:** The shared chat endpoint at `/api/workflows/orchestrator/chat` already routes both canvas chats (with `workflow_id`) and general chats (with `conversation_id`) through Hermes when the flag is on — the wiring is in place. What's missing is (a) the agent's ability to handle the non-workflow case meaningfully, and (b) tool-call access to non-workflow domains. Both gaps close by writing per-domain Hermes skills that declare their tool scope and triggers; the SvelteKit MCP layer stops gating and trusts the skill system. A new top-level `jkai-general` skill acts as the entry-point router for non-canvas chats.

**Tech Stack:** Hermes Agent v2026.5.7 (skills format), TypeScript (SvelteKit MCP dispatcher), Python plugin (chat metadata propagation), markdown (~9 new skill files).

**Spec reference:** `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md`. This plan amends Phase 1 to cover general chat.

---

## Skill inventory

The site-tools registry exposes ~101 tools across 21 domains. Phase 1 wired canvas (22 workflows tools) only. Phase 1.5 covers the remaining general-chat-relevant domains. Phases 2 and 3 will cover builds (12) and curate.

| Skill | Existing toolset(s) | Tool count | Phase |
|---|---|---|---|
| `jkai-canvas` | workflows | 22 | 1 (existing — no change) |
| `jkai-general` | meta + ephemeral-tools | 3 + meta routing | 1.5 (new) |
| `jkai-blog` | blog | 5 | 1.5 |
| `jkai-gmail` | gmail | 8 | 1.5 |
| `jkai-health` | health | 5 | 1.5 |
| `jkai-research` | research | 10 | 1.5 |
| `jkai-scheduled` | scheduled | 5 | 1.5 |
| `jkai-scraper` | scraper | 6 | 1.5 |
| `jkai-home-assistant` | home-assistant | 5 | 1.5 |
| `jkai-files` | files | 2 | 1.5 |
| `jkai-utility` | visualise (3) + memory (3) + heartbeat (3) + followup (3) + diagnostics (3) + web (1) + whatsapp (1) + media-write-document (1) + media-generate-image (1) + media-generate-audio-tts (1) | 20 | 1.5 (bundled — small per-domain footprint) |
| `jkai-builds` | builds | 12 | 2 (deferred) |
| `jkai-curate` | curate | TBD | 3 (deferred) |

Phase 1.5 ships **9 new skills** + 1 update to canvas, covers ~64 tools.

## Approach to skill content

Each skill follows the format established by `jkai-canvas/SKILL.md`:

1. **Frontmatter** — `name`, `description`, `version`, `metadata.hermes.tags`, `metadata.hermes.related_skills`. Match the Phase 1 canvas skill's pattern exactly.
2. **Identity** — one paragraph: who you are, what scope you cover.
3. **When to invoke / yield** — concrete triggers. When does the user's query route here? When should you yield to another skill (e.g. canvas)?
4. **Tool inventory** — list each MCP tool name with a one-line purpose. Group by sub-category if natural. Reference the canonical descriptions from `src/lib/workflows/site-tools/tools/<domain>.ts`.
5. **Examples** — 3–5 concrete scenarios per skill, each ~50–100 words.
6. **Termination signals** — when to stop calling tools and yield to the user.

The bar is **the agent picks the right skill 90%+ of the time on a typical query** and uses its tools correctly. Lower bar than canvas because general chat tolerates more iteration.

## File structure

| Path | Purpose | Action |
|---|---|---|
| `~/.hermes-jkai/skills/jkai-general/SKILL.md` | Top-level router | New |
| `~/.hermes-jkai/skills/jkai-blog/SKILL.md` | Blog domain | New |
| `~/.hermes-jkai/skills/jkai-gmail/SKILL.md` | Gmail | New |
| `~/.hermes-jkai/skills/jkai-health/SKILL.md` | Health (sleep/training/biome) | New |
| `~/.hermes-jkai/skills/jkai-research/SKILL.md` | Research / intel | New |
| `~/.hermes-jkai/skills/jkai-scheduled/SKILL.md` | Cron / scheduled jobs | New |
| `~/.hermes-jkai/skills/jkai-scraper/SKILL.md` | Stealth scraper | New |
| `~/.hermes-jkai/skills/jkai-home-assistant/SKILL.md` | HA state + control | New |
| `~/.hermes-jkai/skills/jkai-files/SKILL.md` | File vault | New |
| `~/.hermes-jkai/skills/jkai-utility/SKILL.md` | Cross-cutting helpers | New |
| `~/.hermes-jkai/skills/jkai-canvas/SKILL.md` | Add cross-skill yield notes | Modify |
| `src/lib/mcp/jsonrpc.ts` | Remove workflows-only toolset gate | Modify |
| `src/lib/mcp/jsonrpc.test.ts` | Drop the gate test; add an "all tools callable" check | Modify |
| `~/.hermes-jkai/extensions/jkai_platform/adapter.py` | Propagate `kind` + `kind_id` into `MessageEvent.raw_message` so the skill router sees chat context | Modify |
| `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md` | Section 6: add Phase 1.5 between Phase 1 and Phase 2 | Modify |
| `docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md` | Extend with general-chat scenarios | Modify |

---

## Task 0: Preliminaries — worktree ready

**Files:** None. (This is operational, not content.)

- [ ] **Step 1: Confirm worktree state**

```bash
cd /home/john/strange_rambling_svelte/.claude/worktrees/hermes-phase-1-general
git branch --show-current   # → worktree-hermes-phase-1-general
git log --oneline -2        # → tip at f984f74 (phase-1 merge)
ls .env                     # → present
ls node_modules | wc -l     # → 800+
```

- [ ] **Step 2: Verify baseline tests + Hermes service**

```bash
npx vitest run src/lib/mcp/ src/lib/jkai/ 2>&1 | tail -5
# Expect 55+ pass, 0 fail (excluding the pre-existing job-store.test.ts heartbeat)
systemctl --user is-active jkai-hermes.service   # → active
curl -sS http://127.0.0.1:18790/platforms/jkai/health    # → {"ok":true,...}
```

If any of these fail, STOP and report BLOCKED.

---

## Task 1: Spec amendment — add Phase 1.5 to section 6

**Files:**
- Modify: `docs/superpowers/specs/2026-05-10-hermes-replacement-design.md`

- [ ] **Step 1: Insert a new "Phase 1.5 — General chat via skills" section** between the existing Phase 1 and Phase 2 in section 6.

The section should describe:
- Scope: extend Hermes coverage from canvas-only to /jkai general chat too.
- Mechanism: per-domain Hermes skills replace the SvelteKit-side toolset gate as the constraint mechanism. The agent self-selects skills via Hermes' native router.
- Deliverables: 9 new skills + 1 update (jkai-canvas yield notes) + remove the workflows-only gate in `jsonrpc.ts` + propagate `kind`/`kind_id` to Hermes session metadata.
- Exit criteria: 5 additional acceptance scenarios pass on `JKAI_HERMES_CANVAS_CHAT=1` (multi-domain general chat). One-week soak now covers both canvas and general.

Suggested length: ~250 words. Match the existing per-phase section style (Deliverables + Exit criteria + Rollback).

Mention in passing that Phase 1.5 makes Hermes' built-in skill system load-bearing (the constraint mechanism shifts from a hand-rolled SvelteKit allowlist to Hermes-native skill scope declarations).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-10-hermes-replacement-design.md
git commit -m "docs(spec): add Phase 1.5 — general chat via skill-organised tools"
```

---

## Task 2: Remove the workflows-only toolset gate in `jsonrpc.ts`

**Files:**
- Modify: `src/lib/mcp/jsonrpc.ts`
- Modify: `src/lib/mcp/jsonrpc.test.ts`

The gate added in commit `2bff8d4` (Issue #4 from cross-cutting review) restricts `tools/call` to the 22 workflows-toolset tools. Phase 1.5 widens to all tools; the constraint shifts to Hermes' skill system.

- [ ] **Step 1: Remove the gate**

Open `src/lib/mcp/jsonrpc.ts`. Find the block that builds `ALLOWED_TOOLS` from `getToolsByToolset('workflows')` and the check inside `tools/call` that rejects out-of-toolset names. Delete both.

Replace with a comment:
```typescript
// Phase 1.5: all 132 registered tools are exposed via MCP. Hermes' skill
// system constrains which subset the agent considers for a given chat
// (jkai-canvas for workflow chats; jkai-general + domain skills for /jkai).
// We trust the skill router; we don't gate at the MCP layer.
```

- [ ] **Step 2: Update the test**

In `src/lib/mcp/jsonrpc.test.ts`, find the test asserting `INVALID_PARAMS` for `blog_create` (or whichever non-workflows tool the previous task used). Replace it with a positive assertion:

```typescript
it('exposes the full tool registry to MCP callers (no SvelteKit-side toolset gate)', async () => {
  // Phase 1.5: skill-system-based constraint, not SvelteKit-side gating.
  // Hermes' active skill restricts which tools the agent considers; the
  // MCP server is permissive.
  const { response } = await dispatchJsonRpc(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'blog_list', arguments: {} },
    },
    { authBearer: SECRET },
  );
  // Either success or a tool-layer error — what we don't want is the old
  // -32602 "not exposed in this profile" rejection.
  if ('error' in (response as Record<string, unknown>)) {
    const err = response as { error: { code: number; message: string } };
    expect(err.error.message).not.toMatch(/not exposed/i);
  }
});
```

(`blog_list` is a real tool; verify by reading `src/lib/workflows/site-tools/tools/blog.ts`.)

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/lib/mcp/ 2>&1 | tail -5
# Expect all pass.
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/jsonrpc.ts src/lib/mcp/jsonrpc.test.ts
git commit -m "feat(mcp): remove workflows-only toolset gate — skill system is the constraint

Phase 1.5: Hermes' native skill router is the constraint mechanism for
which tools the agent considers. The MCP layer exposes the full registry
to any caller with the bearer; skills declare their in-scope tools and
the agent self-selects.

The original gate was a Phase 1 safety belt — useful when only canvas
chat went through Hermes. Now that general chat is in scope and skills
are how we organise tool access, the gate would block every non-canvas
tool call."
```

---

## Task 3: Propagate `kind` + `kind_id` to Hermes session metadata

**Files:**
- Modify: `~/.hermes-jkai/extensions/jkai_platform/adapter.py`
- Out-of-repo; no commit.

The Phase 1 adapter already constructs a `MessageEvent` with `raw_message` containing `kind` and `kind_id`. Hermes' skill router uses session metadata to decide which skill to start the conversation with. Confirm the propagation is happening cleanly and the values reach Hermes' skill-selection layer.

- [ ] **Step 1: Read the current `handle_inbound` in adapter.py**

```bash
sed -n '150,210p' ~/.hermes-jkai/extensions/jkai_platform/adapter.py
```

Confirm the `raw_message` dict includes `kind`, `kind_id`, and `session_id`. If not (the linter may have modified the file since Phase 1), add them.

- [ ] **Step 2: Check Hermes' skill router**

```bash
grep -rn "skill_route\|skill_select\|auto_select_skill\|SkillResolver" ~/hermes-agent/ 2>/dev/null | head -10
```

Find where Hermes picks a skill for a new session. If it can read `MessageEvent.raw_message['kind']` (or a similar custom field), no further work needed. If not, document the gap — the agent will fall back to general behaviour, which is fine for Phase 1.5 because each skill's "triggers" section will route by query content.

- [ ] **Step 3: Smoke-test that messages flow**

```bash
# Restart the service to pick up any adapter changes
systemctl --user restart jkai-hermes.service
sleep 4
# Direct platform POST with kind='canvas_chat' and kind='manual' (general)
SECRET=$(grep "^HERMES_BRIDGE_SECRET=" ~/.hermes-jkai/.env | cut -d= -f2)
# (Token-mint via the SvelteKit primitive; or skip and rely on the hermes-client tests.)
tail -20 ~/.hermes-jkai/logs/agent.log
```

Confirm Hermes processes both with no "no message handler registered" or shape errors.

- [ ] **Step 4: No commit** (adapter is outside the repo)

---

## Task 4: `jkai-general` top-level hub skill

**Files:**
- Create: `~/.hermes-jkai/skills/jkai-general/SKILL.md`
- Out-of-repo; no commit.

This skill is the entry-point for non-canvas chats. It introduces the agent to the available domain skills and tells it how to route.

- [ ] **Step 1: Read the canvas skill for reference**

```bash
wc -l ~/.hermes-jkai/skills/jkai-canvas/SKILL.md
cat ~/.hermes-jkai/skills/jkai-canvas/SKILL.md | head -50
```

Match the frontmatter and section structure.

- [ ] **Step 2: Read the existing general-chat code paths**

```bash
sed -n '1,80p' src/lib/workflows/chat/general-chat.ts
grep -rln "meta-tools\|metaTool" src/lib/workflows/ | head -5
```

Capture how the legacy path organises tool access (the `activate_toolset` pattern, the meta-tools). This is the behavioural source-of-truth for what `jkai-general` should reproduce.

- [ ] **Step 3: Write the skill**

`~/.hermes-jkai/skills/jkai-general/SKILL.md` should cover:

- **Identity:** "You are jkai's general chat assistant inside strangeramblings.com. Users come to you with everything from 'check my email' to 'write a blog post' to 'what's my training load this week'. Your job: figure out the right domain skill for the task and use its tools."
- **Routing decisions:** A one-line trigger per available domain skill. E.g. "blog operations → jkai-blog. email → jkai-gmail. health/sleep/training → jkai-health. research/web/intel → jkai-research. cron/scheduling → jkai-scheduled. scraping → jkai-scraper. home automation → jkai-home-assistant. file vault → jkai-files. utility tools (memory, viz, follow-ups, etc.) → jkai-utility."
- **When to do work yourself:** simple chats that don't need a tool ("hi", "thanks", "what can you do"). Use built-in Hermes capabilities here.
- **Vocabulary:** mirror canvas (build, iteration, workflow, etc.) plus general chat terms.
- **When to refer to canvas:** if the user asks about workflow editing inside /jkai (not /jkai/canvas), surface that they're in the wrong chat surface and point at canvas.
- **Examples** (~5): one per major routing scenario.
- **Termination:** yield to user after each tool-call burst, don't loop.

Aim for ~250–350 lines. Quality > length.

- [ ] **Step 4: No commit**

---

## Task 5: Domain skills batch A — blog, gmail, health

**Files:**
- Create: `~/.hermes-jkai/skills/jkai-blog/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-gmail/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-health/SKILL.md`

Three skills. Each follows the same shape: identity, when-to-invoke, tool inventory (with canonical descriptions from the source file), examples, termination.

- [ ] **Step 1: jkai-blog**

Read `src/lib/workflows/site-tools/tools/blog.ts` for the 5 tools (likely `blog_list`, `blog_get`, `blog_create`, `blog_update`, `blog_unpublish` or similar). Write the skill following the format above.

Triggers: "user wants to read, write, edit, or publish a blog post on strangeramblings.com".

Examples: "draft a post about X", "list my recent drafts", "publish the post about Y", "unpublish the broken one from 2024".

- [ ] **Step 2: jkai-gmail**

Read `src/lib/workflows/site-tools/tools/gmail.ts` for the 8 tools.

Triggers: "user wants to read, send, label, or search email on their connected Gmail accounts". Note multi-account.

Examples: "search for receipts last month", "send X to alice@example.com", "label that thread as 'reviewed'", "what's in my inbox that's unread".

Note: the Gmail account selection is a configuration step the agent should mention if the user hasn't picked which account to use.

- [ ] **Step 3: jkai-health**

Read `src/lib/workflows/site-tools/tools/health.ts` for the 5 tools.

Triggers: "user asks about their sleep, training load, readiness, heart rate, or biome data".

Examples: "how was my sleep last night", "weekly training summary", "what's my biome's particle density right now", "readiness for today's run".

Important note for the skill: per the existing CLAUDE.md / memory, HR data comes from the Apple device webhook, NOT Whoop — the skill should reflect that.

- [ ] **Step 4: No commit**

---

## Task 6: Domain skills batch B — research, scheduled, scraper

**Files:**
- Create: `~/.hermes-jkai/skills/jkai-research/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-scheduled/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-scraper/SKILL.md`

- [ ] **Step 1: jkai-research**

Read `src/lib/workflows/site-tools/tools/research.ts` for the 10 tools — research sessions, search, findings, reports.

Triggers: "user wants to research something (web search, deep dive, gather sources, build a report)".

Examples: "research the latest on X", "find papers about Y", "summarise what we've found on Z", "close the research session and give me the report".

- [ ] **Step 2: jkai-scheduled**

Read `src/lib/workflows/site-tools/tools/scheduled.ts` for the 5 tools.

Triggers: "user wants to schedule something to run on a cron, see what's scheduled, cancel a scheduled job, or check what ran".

Examples: "schedule the scraper to run daily at 7am", "what's scheduled this week", "cancel the news-digest job", "did this morning's job succeed".

- [ ] **Step 3: jkai-scraper**

Read `src/lib/workflows/site-tools/tools/scraper.ts` for the 6 tools.

Triggers: "user wants to set up, debug, or run a stealth scrape (gov.uk job board, ecommerce, social, etc.)".

Important: the existing `~/strange_rambling_svelte/CLAUDE.md` says scraper-related code is homeserv-only (residential IP); the skill should reflect this constraint — don't suggest running from production unless `SCRAPER_ALLOW_NON_HOMESERV=1`.

Examples: "test selectors on this URL", "what credentials do I have for site X", "show the last 5 scrape runs", "debug why this scrape is captcha-trapped".

- [ ] **Step 4: No commit**

---

## Task 7: Domain skills batch C — home-assistant, files, utility

**Files:**
- Create: `~/.hermes-jkai/skills/jkai-home-assistant/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-files/SKILL.md`
- Create: `~/.hermes-jkai/skills/jkai-utility/SKILL.md`

- [ ] **Step 1: jkai-home-assistant**

Read `src/lib/workflows/site-tools/tools/home-assistant.ts` for the 5 tools.

Triggers: "user wants to query or control a Home Assistant entity (lights, sensors, automations, scripts)".

Examples: "is the front door locked", "turn off the kitchen lights", "what's the current temperature in the office", "run the 'goodnight' automation".

- [ ] **Step 2: jkai-files**

Read `src/lib/workflows/site-tools/tools/files.ts` for the 2 tools.

Triggers: "user wants to list or read files in the personal vault at /admin/files (and the WebDAV mount at strangeramblings.com/dav/)".

Examples: "list files in /drive/photos", "read the contents of /drive/notes/today.md".

- [ ] **Step 3: jkai-utility**

This is the bundled skill covering the small-footprint domains. Inventory:
- visualise (3 tools): chart, map, table renderers
- memory (3 tools): save_fact, recall_fact, forget_fact
- heartbeat (3 tools): check-in / status / pending
- followup (3 tools): track / get / complete tasks
- diagnostics (3 tools): scheduler status, service logs, recent runs
- web (1 tool): fetch URL
- whatsapp (1 tool): send WhatsApp message
- media-write-document (1 tool): write DOCX/PDF/MD
- media-generate-image (1 tool): generate image
- media-generate-audio-tts (1 tool): generate audio

Triggers organised by category:
- "visualise X as a chart/map/table" → visualise tools
- "remember that X" / "what do I know about Y" → memory tools
- "follow up on X" / "did I do Y" → followup tools
- "send a WhatsApp to X" → whatsapp
- "fetch the page at URL" → web
- "make a chart / table / map" → visualise
- "generate an image / write to PDF / read this aloud" → media-*

Aim for ~400 lines (this skill has a lot of variety).

- [ ] **Step 4: No commit**

---

## Task 8: Update `jkai-canvas` skill with cross-skill yield notes

**Files:**
- Modify: `~/.hermes-jkai/skills/jkai-canvas/SKILL.md`

Phase 1's canvas skill doesn't mention the other skills (they didn't exist). Phase 1.5 needs the canvas skill to know it should yield to the user / suggest they switch chat context when the user asks something off-topic.

- [ ] **Step 1: Add a "Yield to other skills" subsection**

Insert near the bottom of the skill, before "Common pitfalls" (or wherever the existing structure best fits):

```markdown
## Yielding to other skills

You are pinned to ONE workflow's DAG. If the user asks about something
non-workflow:
- email / blog / health / scraper / scheduled / home automation / files /
  research / utility — surface that they should chat at /jkai (the general
  chat hub) instead, where `jkai-general` will route them to the right
  domain skill.
- another workflow's DAG — see the existing refusal pattern; ask them to
  open that workflow's canvas.

Don't try to handle off-topic requests yourself. The right answer is
"that's not in scope for this canvas — open /jkai or the other workflow's
canvas".
```

- [ ] **Step 2: No commit**

---

## Task 9: Live skill-selection sanity test

**Files:**
- Append observations to a scratch note (no commit until Task 10).

Run a battery of test prompts against the live Hermes service. For each, verify the agent picks the right skill and calls the right tool.

- [ ] **Step 1: Smoke-test canvas (should still pick canvas)**

```bash
HERMES_HOME=~/.hermes-jkai hermes -z "I'm on canvas wf_test_12. Add a manual-trigger node. (DRY RUN — just say what tools you'd call.)"
```

Expect: canvas skill activates; `workflow_add_node` mentioned with `workflow_id='wf_test_12'`.

- [ ] **Step 2: Smoke-test each domain skill**

For each of the 9 new skills, craft a representative prompt:

| Skill | Test prompt |
|---|---|
| jkai-general (no clear domain) | "Hi, what can you do?" |
| jkai-blog | "List my recent blog drafts." |
| jkai-gmail | "Search my email for receipts from last month." |
| jkai-health | "How was my sleep this week?" |
| jkai-research | "Start a research session on the latest stealth-scraping techniques." |
| jkai-scheduled | "What jobs are scheduled this week?" |
| jkai-scraper | "Test selectors against civilservicejobs.gov.uk." |
| jkai-home-assistant | "Is the front door locked?" |
| jkai-files | "List files in /drive/photos." |
| jkai-utility | "Remember that my keys are in the blue bowl." |

For each: run the prompt as a one-shot (`hermes -z "..."`), inspect the agent's response, note which skill it activated (Hermes should mention the skill it's using; or check `~/.hermes-jkai/logs/agent.log`), and whether the right tool was chosen.

Expect ~80% to route correctly first try. Where they don't, iterate the skill's triggers/examples and re-test.

- [ ] **Step 3: Cross-domain prompt**

```bash
HERMES_HOME=~/.hermes-jkai hermes -z "Find scheduled jobs that include 'scrape' in their name, then send me a WhatsApp with the count."
```

Expect: jkai-scheduled or jkai-general → `scheduled_*` tool → jkai-utility → `whatsapp_send`. Multi-skill flow.

- [ ] **Step 4: No commit yet — fixes happen via edits to the skill files**

If any skill consistently fails to be picked: iterate. If a skill picks but calls the wrong tool: iterate. Bar: 90% first-try success on the 11 prompts above.

---

## Task 10: Extend acceptance log with general-chat scenarios

**Files:**
- Modify: `docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md`

The Phase 1 acceptance log has 5 canvas scenarios. Phase 1.5 adds general-chat scenarios.

- [ ] **Step 1: Append a "Phase 1.5 acceptance" section**

Mirror the format of the existing scenario sections. For each of these 5 scenarios, run end-to-end against the flag-on dev server and document the verbatim agent response + tool calls observed:

| # | Scenario | Prompt | Expected |
|---|---|---|---|
| G1 | Blog | "Draft a short blog post about my favourite tea." | blog skill → blog_create (with title + body) |
| G2 | Gmail | "Search my email for invoices from January." | gmail skill → gmail_search |
| G3 | Health | "How did I sleep this week, day by day?" | health skill → health_get_sleep |
| G4 | Multi-domain | "What scrape jobs run weekly?" | scheduled skill → scheduled_list (filtered) |
| G5 | Skill selection (ambiguous) | "Help me with X." (where X is vague) | jkai-general → asks a clarifying question instead of guessing |

For each: paste the actual transcript (truncated to <1000 chars) and mark PASS / FAIL / PARTIAL.

- [ ] **Step 2: Update the "Staging the soak" section**

The Phase 1 instructions said the soak covers canvas chat. Update to:

> The soak now covers **both canvas chat and /jkai general chat**. With
> `JKAI_HERMES_CANVAS_CHAT=1`, every chat at `/jkai` and `/jkai/canvas/<id>`
> runs through Hermes. Watch over 7 days for canvas regressions AND
> general-chat regressions (tool selection, multi-domain flows, skill
> picking).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md
git commit -m "docs(hermes-phase-1.5): general-chat acceptance scenarios + soak staging update

5 new scenarios for the /jkai general chat path through Hermes' skill
system. Soak now covers both canvas and general chat."
```

---

## Task 11: Final cross-cutting review

**Files:**
- None directly; the reviewer flags issues to fix.

- [ ] **Step 1: Dispatch a code-reviewer over the Phase 1.5 diff**

```bash
git diff hermes-migration..HEAD --stat
```

Run a single `feature-dev:code-reviewer` pass over the whole branch, looking for:
- Skill-content quality (concrete triggers, no contradiction between skills, examples reflect actual tool names).
- The MCP gate removal didn't break anything subtle.
- The metadata-propagation in adapter.py doesn't break Phase 1 acceptance.
- No leftover gate references in spec or code.

- [ ] **Step 2: Fix any flagged issues**, single commit:

```bash
git add <changed-files>
git commit -m "fix(hermes-phase-1.5): cleanup from cross-cutting review"
```

- [ ] **Step 3: Merge to `hermes-migration`**

```bash
# Exit worktree (using ExitWorktree tool or git operations)
git checkout hermes-migration
git merge --no-ff worktree-hermes-phase-1-general -m "merge: hermes phase 1.5 — general chat via skills"
```

Don't tag yet — `hermes-phase-1-complete` waits until the post-soak `loop.ts` deletion.

---

## Self-review checklist

(For the executing agent before merge.)

**Skills coverage** — every existing toolset domain except `builds` and `curate` has a skill (or is rolled into `jkai-utility`). 9 new skills + 1 canvas update.

**Toolset gate removed** — `jsonrpc.ts` no longer references `getToolsByToolset('workflows')` for gating; all 132 tools reachable.

**Skill router signal** — `kind` and `kind_id` reach Hermes via `raw_message`; Hermes' skill system can use them.

**Acceptance** — 5 new scenarios verify general chat works; the 5 Phase 1 canvas scenarios still pass (regression check).

**Soak instructions updated** — `docs/superpowers/research/2026-05-11-hermes-phase-1-acceptance.md` reflects the wider coverage.

**No flag flip in committed `.env`** — same as Phase 1: flag stays off until John flips it for soak.

**`loop.ts` still present** — post-soak deletion, same as Phase 1's plan.
