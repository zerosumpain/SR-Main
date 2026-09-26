# Access groups P5 (member chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** A member holding `jkai.chat` can chat with jkai on /jkai, on a closed tool list, in their own threads, with none of the owner's data reachable and none of their words reaching the owner's stores.

**Spec:** `docs/superpowers/specs/2026-09-26-access-groups-design.md` (jkai chat).

## Why two slices

These are live leaks the moment a non-owner thread exists, so they close BEFORE the area opens:
background deliveries into "the newest thread" (Gmail preview, daydream notes, chat-continuation,
check-ins); every-thread sweeps into the owner's memory, intel graph, briefing, profile; WhatsApp
escalation of any job; the chat POST loading any conversation id / attachment / canvas; meta tools
(`activate_toolset`, `jkai_help`, authoring) that bypass the executor allow-list; `fetch_url`'s weak
SSRF guard (redirect-follow, no CGNAT block, DNS rebind); `PATCH thinkingLevel` writing a GLOBAL
setting; the job APIs listing and cancelling every job.

- **Slice A (this PR, area stays closed):** tasks 1–13. Owner behaviour byte-for-byte unchanged:
  every new branch keys on `areaAccess`, which is `OWNER_ACCESS` for the owner.
- **Slice B:** catalogue opens `jkai.chat`, the /jkai page load's member branch, UI trimming, the
  end-to-end member integration test.

## Slice A tasks

1. Schema: `jkai_conversations.principal_id`, `jkai_attachments.principal_id` (default 'owner').
2. `src/lib/jkai/chat-access.server.ts`: `requireConversation(event,id,'read'|'write'|'post')` (post = own
   thread only, owner included), `conversationListScope` (owner → own threads only), `requireOwnJob`,
   `reserveChatTurn` (access_usage kind 'chat', advisory lock, 50/24h or `access.chat.dailyTurns`).
3. `src/lib/jkai/member-chat/policy.ts`: `MEMBER_CHAT_TOOLS`, `TurnRestriction`, member persona + capabilities.
4. Executor: `ToolExecContext.principalId`; `executeTool` refuses a non-owner principal without `allowedTools`.
5. `general-chat.ts` restricted mode: `ChatOptions.restriction`; refuse owner-grade turns on non-owner
   threads (thread-principal guard at the top of `generalChat`); refuse any tool outside the allow-list at
   the top of `runSingleToolCall` (before meta tools); no memory/graph/integrations/roster/router context;
   member persona; tiers 1–3 replaced by the allow-list; no thinking escalation, no plan phase, default rounds;
   per-turn tool-call cap.
6. Job store: `JobScope.principalId`; per-principal list/cancel.
7. Chat job routes (POST/GET/DELETE/PATCH, stream, active, presence): member branches, own-job checks,
   restriction passed to generalChat, default model only, no drive refile.
8. `wa-escalation.ts`: never escalate a non-owner job.
9. Owner filters on every background reader/picker of threads (gmail bridge, daydream deliver,
   chat-continuation, conversation-checkin, think/reads, briefing/gather, appetite/pack, ponder/profile,
   recall session_search, memory-review, chat-extract, native today/model, layout activeRuns) and
   chokepoints refusing non-owner threads in heartbeatTurn, targeted, scheduled tools, heartbeat tool.
10. Lists/handlers/uploads: `getConversationList`/`searchConversationList` default to owner threads;
    conversations GET/POST/[id] GET/PATCH/DELETE/messages scoped; context-panel/drill/memory/trace refuse
    non-owners; attachments stamped + scoped, no /drive mirror for non-owners; events scoped.
11. SSRF: `fetchUrlContent` on `guardedPublicFetch` (DNS pinning, per-hop redirects, CGNAT).
12. Hub layout `memberHome` counts `/jkai` itself.
13. `chat-route-access.test.ts`: every jkai.chat route calls the guard; owner-only surfaces never listed.

Each task's detail (file:line cut points, tests) is in the session plan this file summarises; the
integration tests follow `members.integration.test.ts` / `research-access.integration.test.ts`.
