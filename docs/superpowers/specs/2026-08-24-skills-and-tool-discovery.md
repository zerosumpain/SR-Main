# Stage 2 — skills library and tool discovery in-repo

**Status:** shipped · **Date:** 2026-08-24 · Hermes exit plan, S2

## Problem

`skill_view` (174 calls / 14d) and `tool_search` + `tool_describe` (147) are the
second heaviest category on the jkai chat surface after the site's own tools —
321 of 1,233 calls, 26%. All three are Hermes verbs. The in-process lane had
`activate_toolset` and `jkai_help`, which answer "what toolsets exist" but not
"is there a tool for X" or "how is Y done here".

## What moved

126 `SKILL.md` files plus 307 textual reference documents into `data/skills/`
(7.2 MB), which `ci-release.sh:50` already rsyncs — so no CI work, and rsync is
incremental so the size is a one-off.

Excluded: 14.4 MB of `.gz`, plus `.pdf`, `.xsd`, `.tex`, `.sty` and images —
26 MB of the source tree that no chat turn reads.

## Design

- `src/lib/jkai/skills/registry.ts` — index, resolve, read, search, render.
- `src/lib/workflows/site-tools/tools/discovery.ts` — `skills_list`,
  `skill_view`, `tool_search`, `tool_describe`.
- Discovery is seeded into `activeTools` alongside `META_TOOL_DEFINITIONS`, from
  the registry rather than hand-copied, because tools for finding tools are
  useless if you must already know to activate them.
- The skill index goes into the system prompt with FULL descriptions.

## Decision Log

| # | Decision | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Which skills to port | the 29 actually used / all 126 | **All 126** | Porting only what got used would bake in the routing bug: usage reflects which keywords survived Hermes' 60-char cut, not merit. 1.5 MB of SKILL.md makes the "saving" false. | Yes |
| 2 | References | exclude / include textual / include all | **Textual only** | 46 of 126 bodies link `references/`, so excluding breaks a third of them. Archives and PDFs are 26 MB no turn reads. | Yes |
| 3 | Skill id | frontmatter name / path | **Path** | Names are not unique — two skills declare `computer-use`. Paths are unique by construction. Names still resolve when unambiguous. | Yes |
| 4 | Description truncation | 60 chars (Hermes parity) / full | **Full** | The 60-char cut is precisely why `google-workspace` owned every calendar question: it was the only line short enough to keep the word. 41 of 126 exceed 60. | Yes |
| 5 | Discovery reachability | activatable toolset / always-on | **Always-on** | Chicken-and-egg otherwise. Seeded from `getToolsetDefinitions('discovery')` so schemas cannot drift from the `register()` calls. | Yes |
| 6 | `skills_list` default | full list / require a query | **Full list, query optional** | 126 lines is a cheap tool result and matches how the index already reads. | Yes |

## Bugs found while building

1. **YAML block scalars were parsed as their marker.** Skills using
   `description: |` indexed with a description of `"|"` — invisible to search and
   useless in the index. Minimum description length was 1 character; it is now 38.
2. **Exact id tied with exact name in ranking.** Searching `computer-use`
   returned `autonomous-ai-agents/computer-use`, because both scored the same
   +10 and alphabetical order broke the tie. Id now outranks name.

## Verification

- 30 new tests: index, collisions, traversal guard, block-scalar parsing, the
  60-char trap (a keyword past the 60th character must still be findable), and
  all four tools.
- `gate:check` 0 errors · `gate:test` 612 files / 7171 tests / 0 failures.
