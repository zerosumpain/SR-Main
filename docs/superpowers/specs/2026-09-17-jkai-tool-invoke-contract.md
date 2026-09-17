# The JKAI tool-invoke contract

Written 17 September 2026 against SR-Main `3e68fa12`. The companion is
`SR-Infra/docs/JKAI-CORE.md`, which measured the extraction and left three
things marked as decisions rather than defaults. This spec settles all three and
builds the first of them.

## Why now

Policy Analysis, Health and Drive are extracted and live. `jkai-core` has sat at
`status: planned` in `SR-Infra/registry/apps.json` since 13 September with its
ports reserved, its repo named (`zerosumpain/SR-JKAI`) and nothing built. All
three of the original blockers were closed in SR-Main — #862 (the chat/canvas
transaction was dead code), #873 (the tool registry inverted to on-demand
loading, 396 → 108 static files) and #876 (the job store became the
`chat/activity.ts` seam). What stopped it was not code.

> "This is John's call, not a logged default: it is a production trust boundary,
> and it is the one part of this note that is not a measurement."
> — `JKAI-CORE.md`, on the invoke contract

So the work is: settle the decisions, then build the endpoint they were blocking.

## What this delivers

Main becomes able to **serve** tool invocations to a chat process that does not
live inside it. It does not move chat, and it changes nothing about how chat
runs today: the lane is closed unless configured, and with it unconfigured every
tool call takes exactly the path it takes now.

1. `POST /api/platform/tools/invoke` — the callee.
2. A two-lane service credential, the destructive lane closed by default.
3. `$lib/workflows/site-tools/remote.ts` — the caller, which is the code that
   moves to SR-JKAI verbatim.
4. `executor.ts` delegates to it when configured. That file is the seam the
   extraction note names; this is the change to its body.

## The route does not go under `/api/jkai`

A Step-0 check of my own, and it is the reason the path is what it is.

`jkai-core.excludePaths` does not list `/api/jkai/tools`, so under the registry
as it stands today that prefix routes to SR-JKAI. But everything under it is
Main's:

| path | serves | belongs to |
|---|---|---|
| `/api/jkai/tools/invoke` | the per-build bridge token | Main's forge/builder |
| `/api/jkai/tools/manifest` | the same | Main |
| `/api/jkai/tools/promote` | `promote_ephemeral_tool` | Main |

`/api/jkai/forge` and `/api/jkai/builds` are already excluded for exactly this
reason; `/api/jkai/tools` was missed. **It is added to `excludePaths` in
SR-Infra as part of this change.**

The new endpoint then deliberately avoids the prefix altogether and goes to
`/api/platform/tools/invoke`. `/api/platform` is already Main's own-machinery
namespace — `/api/platform/workflow-engine` is the watchdog probe that was moved
there precisely so an edge-routing change could not take it away. An endpoint
whose entire purpose is "Main serves this to another application" must not sit
on a prefix that a future registry edit could hand to that application.

## The contract

### Request

```
POST /api/platform/tools/invoke
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json  |  application/x-ndjson
```

```json
{
  "name": "site_blog_list",
  "args": { },
  "context": {
    "conversationId": "…",
    "workflowId": "…" | null,
    "jobId": "…",
    "modelContext": { },
    "thinkingLevel": "high" | null,
    "allowedTools": ["…"]
  }
}
```

Those are the seven fields `general-chat.ts` actually builds, and no others.
`ToolExecContext` has thirteen; the other six were measured in `JKAI-CORE.md`
and do not cross:

- `emit` — becomes the NDJSON framing below.
- `busKey` — its only users are `request-credential` and `update-credential`,
  both chat-intrinsic, so it stays inside SR-JKAI.
- `signal` — an `AbortSignal` does not serialise. Cancellation is already an
  explicit `DELETE /api/workflows/orchestrator/chat?jobId=`; aborting the
  request ends the stream.
- `deadline` — becomes the client's HTTP timeout.
- `depth` — guards `platform.call` recursion inside `ephemeral-tools.ts`, which
  is one process calling itself. Main-internal, and it stays that way.
- `buildId` / `iterationId` — build attribution, not chat's.

### Response

Default: the `ToolResult` **verbatim** — `{ success, data?, error?, evidence? }`.
Not wrapped. The whole point of the seam is that `executeSiteTool`'s signature
does not change when its body starts making an HTTP call, and a wrapper would
make every caller learn about the transport.

With `Accept: application/x-ndjson`: one JSON object per line, `{"status":"…"}`
for each `emit`, then a final `{"result": …}`. 137 of the 140 tools send one
line; `presentations`, `scraper` and `workflows` send several.

This is a spinner caption, not a protocol. `general-chat.ts` trims each emit to
200 characters, writes it to a job phase and forwards it as a `status` event —
nothing reads it back, nothing depends on ordering, and dropping one changes a
label. So it needs no correlation id and no delivery guarantee. A caller that
does not care reads the last line.

The reason it is NDJSON on the same endpoint rather than a job id: a job id
exists to let work outlive its caller, and here it cannot. If SR-JKAI restarts
mid-scrape the chat turn is gone regardless, because the turn lived in the
process that died. The scrape runs in Main and finishes either way. A job id
would buy durability for the one thing that is not durable, and cost a registry,
a poll loop and a reaper on Main's side. Bytes flowing also keep the connection
live, which is the real objection to holding a plain JSON response open for the
length of a scraper run.

### What the callee enforces

`registry.executeTool` already refuses a tool outside `ctx.allowedTools`
(`registry.ts:181`), returns `{success:false, error:'Unknown tool: …'}` for a
name it does not have, and validates arguments against the declared schema. The
endpoint adds one rule of its own — the destructive lane — and otherwise lets
the existing behaviour through unchanged, because a seam that reshapes errors is
a seam that has to be debugged twice.

## Decision 1 — the trust boundary

**Chosen: split the lane, starting closed.**

140 of the tools chat can call belong to Main domains; 25 `destructive: true`
declarations across 15 modules (`gmail`, `whatsapp`, `apple-calendar`,
`publish-page`, `workflows`, `builds`, `datastore`, `scraper`, `presentations`,
`node-builder`, `request-change`, `custom-tool-admin`, `api-integrations`,
`route-export`, and Drive's `file-share`). Chat's confirmation gate does not
move — it stays where the human is — so after the split what Main trusts is
**SR-JKAI's assertion that a human approved**, not a human.

There is no way for Main to verify that itself. It has no session for the
person, and any ticket SR-JKAI can be asked to present it can mint without one.

| option | why not |
|---|---|
| Trust the principal — one credential, full catalogue | Widens `studio-auth`'s precedent from one non-destructive action to 25 destructive ones, in one step, with no way back but a deploy |
| Keep destructive tools in Main's chat | Splits the catalogue by a property the model cannot see, and leaves two chat surfaces |
| **Split the lane, destructive unset** | Chosen |

Two environment variables:

- `JKAI_INVOKE_TOKEN` — the non-destructive lane.
- `JKAI_INVOKE_DESTRUCTIVE_TOKEN` — additionally permits `destructive: true`.
  **Unset means the lane does not exist**, and unset is the default.

Both carry the 32-character floor and the constant-time comparison
`studio-auth` already uses, including its length-check-first ordering, because
`timingSafeEqual` throwing on unequal buffers is itself an oracle.

Neither is loopback-gated, for the reason `studio-auth` states and which has an
outage behind it: on this VPS every request arrives through cloudflared and
appears to come from `127.0.0.1`. That is the property that turned
`AUTH_BYPASS=1` into a public `/admin` exposure on 2026-07-24. Loopback is not a
security property here, and pairing it with a secret would imply a protection
that does not exist. The token is the control, which is why the floor is not
optional.

**Why this is the reversible one.** "Can an unattended process send mail as
John" becomes a deployment fact rather than a code path — one variable, set or
not. With it unset the 25 destructive tools keep working exactly as they do
today, in-process, and chat degrades across the boundary to a message it already
has. It is the same rule the kit already states for the service lane: both
halves or neither.

**Reversibility:** one environment variable, no deploy of code.

## Decision 2 — `/jkai/canvas` drives a chat turn

**Chosen: it calls across.**

`/jkai/canvas/[slug]` stays in Main and is the only Main page that drives a chat
turn — it POSTs to `/api/workflows/orchestrator/chat` and cancels by job id. It
carries a browser session, so the gateway signs an identity for it and this
works unchanged. The alternative — giving the canvas orchestrator panel its own
endpoint in Main — duplicates the transport for one consumer and is only worth
it if the panel is meant to diverge, which nothing says it is.

**Reversibility:** free today (no code at all), and reversible later by adding
the endpoint if the panel diverges.

## Decision 3 — `/api/jkai/memory`

**Chosen: it travels with chat; Main reads across.**

It is a read of `jkaiMemories`, which chat writes. `/jkai/intel/memory` (Main)
and chat's context-panel drill both read it; the writer decides where it lives.
This is already what the registry does — `/api/jkai/memory` is not in
`excludePaths` — so the decision is to confirm that rather than change it, and
to record it so the next person does not re-open it.

**Reversibility:** a registry line.

## Decision 4 — the caller ships, but nothing in Main turns it on

The client half (`remote.ts`) is the code that will run in SR-JKAI. It could be
left unwritten until that repo exists. It is not, for two reasons: a contract
with no caller is a contract nobody has run, and "a tool nothing calls looks
like one that does not exist". So it ships with an integration test that stands
up the real route handler on a real socket and drives it through the real
client, JSON and NDJSON both.

What it does **not** get is a production caller. `executeSiteTool` is called by
workflow nodes, canvas routes and the build bridge as well as chat; routing any
of them over loopback HTTP inside the same process adds a hop for no benefit and
real risk. `JKAI_TOOL_INVOKE_URL` stays unset in Main, and unset means
in-process — the path every call takes today, byte for byte.

**Reversibility:** the switch is an environment variable, and the default is the
current behaviour.

## Decision 5 — the wire client uses `node:http`, not `fetch`

`$lib/server/extracted-app.ts` already has this scar: undici silently drops a
`Host` header, and a gateway that answers only for its canonical host 400s
everything else. Main has no gateway today, so a `fetch` would work right now —
and would break the day SR-JKAI's calls arrive through one, in a way that reads
as an auth problem. `remote.ts` mirrors `extracted-app.ts`, and a test asserts
the header is on the wire, so tidying it into `fetch` fails loudly.

**Reversibility:** local to one file.

## Decision 6 — `modelContext` and `thinkingLevel` cross as shape-checked JSON

Both are read by tools whose work outlives the turn (a build, a studio build, a
change request run later in a sidecar with no ambient context) and write them
onto their own row. They cross the wire as JSON and are checked for shape, not
validated against the model registry. A caller holding a valid token already has
the catalogue; deep validation here buys nothing and would drift from the
registry the moment a model is added.

**Reversibility:** one function.

## Not in scope

Moving chat, creating SR-JKAI, generating ingress for it, or the
`chat/activity.ts` body (it becomes a call to the chat application, which does
not exist yet). `jkai-core` stays `status: planned`.

## Verification

- Unit: contract coercion, both lanes, the NDJSON framing, the `Host` header.
- Integration: the real `POST` handler on a real socket, driven by the real
  client — JSON, NDJSON with several status lines, an unknown tool, a tool
  outside `allowedTools`, a destructive tool with and without the second lane,
  a bad token, a short token, no token.
- Gate on porkserv (`./scripts/gate-remote.sh`), not homeserv — the gate asks
  for an 8GB heap on a 7.6GB box here.
- Live: deploy by merging to master, then prove the endpoint is reachable and
  **closed** — an unauthenticated POST must 401, and with no token configured in
  production that is the only answer it can give.
