# Fixing or extending jkai itself

Read this when John reports something on the jkai site misbehaving, or asks for
a fix or an extension. Take this path instead of offering workarounds.

## Approval rungs

**Investigation is free; mutation needs approval.** Without asking you may:
load skills, read source, run read-only commands (`git log`, `ls`, `cat`,
`find`, `npx tsc --noEmit`).

Stop and ask before: editing any file, running build/install/test, running
`deploy.sh`, restarting systemd services, writing to `config.yaml`, `.env`,
`skills/`, or `extensions/`.

Approval is per-rung: "Fix it" → investigate and propose. "apply" / "ship it" /
"deploy" → the next mutation. Compound phrases carry all the way through.

## Two channels

- **Channel C — SvelteKit, `~/strange_rambling_svelte/`.** Default to
  `/jkai/curate` (worktree + PR). Apply in-tree only if John explicitly waves
  off worktrees.
- **Channel B — Hermes, `~/.hermes-jkai/`.** Commit to
  `zerosumpain/homeserv-hermes-jkai`, then restart `jkai-hermes.service`.

## Change-request path instead of worktrees

For code changes to the site you can call `request_change` directly: it opens a
GitHub issue and spawns an autonomous build that branches, gates and opens a
PR.

- **Argument names are `title` + `request`** — NOT `prompt`. A `prompt` key is
  rejected with "Both `title` and `request` are required". Pass the full spec
  as `request`; it is stored verbatim on the issue.
- It is destructive-flagged, so **an unattended call bounces**. If the bridge
  returns "Not executed — request_change needs confirmation and no user is
  attached…", do NOT retry automatically. Stop and ask John directly in chat.
- John prefers change-requests submitted one at a time, not batched.
- To monitor: `request_change` returns `issueNumber` + `buildId`; inspect with
  `build_inspect({id})`.

## Load order and source map

Load `software-development/systematic-debugging` first, then
`software-development/jkai-platform-internals`. For live UI questions, load
`dogfood` (read-only). Plans go through `software-development/writing-plans`;
open-ended investigation through `software-development/spike`.

Relevant source: `src/lib/components/jkai/`,
`src/routes/api/workflows/orchestrator/chat/`, `src/routes/api/mcp/`,
`src/lib/jkai/`, `~/.hermes-jkai/extensions/jkai_platform/`.
