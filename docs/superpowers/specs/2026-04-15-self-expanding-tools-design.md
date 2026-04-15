# Self-Expanding Tools for JKAI Chat

**Date:** 2026-04-15
**Status:** Approved

## Problem

When JKAI encounters a capability gap (e.g., "where exactly is my family?" with GPS coordinates but no reverse geocoder), it reports what it can't do instead of solving the problem. The toolset is static — only tools defined in TypeScript source files at build time are available.

## Solution

Allow JKAI to recognise capability gaps, propose a new tool with a high-level design, and — after user approval — create, register, persist, and call that tool within the same conversation. Tools persist across restarts, so the toolset grows organically over time.

## Conversation Flow

1. JKAI recognises it needs a capability it doesn't have
2. Proposes the tool: name, purpose, what API/approach it'll use, parameters, expected output
3. Waits for user approval
4. Calls `create_tool` with the full definition including handler code
5. The tool is registered immediately in the runtime registry
6. JKAI calls the new tool in the same conversation to answer the original question
7. The tool is persisted to DB and available in all future conversations

## Components

### 1. Database Table: `custom_tools`

New Drizzle table in `schema.ts`:

| Column | Type | Description |
|--------|------|-------------|
| id | text (PK) | Auto-generated UUID |
| name | text (unique) | Tool name in snake_case |
| description | text | What the tool does |
| toolset | text | Toolset category (e.g., "geo", "utility") |
| parameters | jsonb | JSON Schema for tool arguments |
| handler_code | text | Async JS function body |
| created_at | timestamp | When created |
| enabled | boolean | Whether to load on startup (default true) |

### 2. Meta-Tool: `create_tool`

Added to `meta-tools.ts` alongside `activate_toolset` and `jkai_help`. Also added to `META_TOOL_DEFINITIONS` so it's always available.

**Parameters:**
- `name` (string, required) — snake_case tool name
- `description` (string, required) — what it does
- `toolset` (string, required) — category name
- `parameters` (object, required) — JSON Schema for args
- `handler_code` (string, required) — async function body with `args` and `fetch` in scope

**On execution:**
1. Validate name doesn't conflict with existing tools
2. Wrap `handler_code` in `new AsyncFunction('args', 'fetch', code)` with error handling
3. Call `register()` from `registry-internal.ts` to add to runtime registry
4. Insert into `custom_tools` DB table
5. Return success with tool name and toolset

**Handler execution context:**
- `args`: the tool arguments object
- `fetch`: global fetch for HTTP requests
- No access to: `db`, `fs`, `process`, `require`, or any server internals
- Wrapped in try/catch — handler errors return `{ success: false, error: message }` rather than crashing

### 3. Custom Tool Loader

A new module `custom-tool-loader.ts` in `site-tools/`:

- `loadCustomTools()` — reads all enabled rows from `custom_tools`, wraps each handler, calls `register()`
- Called from `registry.ts` after the static domain module imports
- Async (DB access), so registry initialization becomes async — `loadCustomTools()` is called from the workflow engine startup in `workflows/index.ts` alongside `syncPrompts()`

### 4. General Chat Integration

In `general-chat.ts`, when `create_tool` is handled:
- After registering the tool, push the new tool's OpenAI-format definition into `activeTools` so it's immediately callable in the same conversation without needing `activate_toolset`
- The toolset is also added to `activatedToolsets` so keyword inference works for future messages

### 5. System Prompt Update

Replace the existing `06-problem-solving.md` with instructions specific to the `create_tool` mechanism:

- When you can't answer something directly, think about whether a tool could solve it
- Propose the tool to the user with: name, what it does, what API/service it calls, parameters, expected output
- Wait for approval before calling `create_tool`
- After creating, immediately call the new tool to answer the original question
- Custom tools should be thin API wrappers — use public APIs, keep handler code simple
- Examples of the full flow (gap recognition → proposal → creation → usage)

### 6. Meta-Tool: `list_custom_tools`

Small addition to see what custom tools exist. Returns name, description, toolset, created_at for all custom tools. Useful for JKAI to check if a tool already exists before proposing a new one.

## What's Out of Scope

- Admin UI for managing custom tools (future)
- Tool versioning or updates (just delete and recreate for now)
- Complex handlers that need DB access or filesystem — those are proper TypeScript tools
- Mechanical approval gate — approval is conversational via system prompt

## File Changes

| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | Add `customTools` table |
| `src/lib/workflows/site-tools/meta-tools.ts` | Add `create_tool` and `list_custom_tools` to `META_TOOL_DEFINITIONS`, add handlers |
| `src/lib/workflows/site-tools/custom-tool-loader.ts` | New file — loads persisted custom tools on startup |
| `src/lib/workflows/site-tools/registry.ts` | Import and call `loadCustomTools()` |
| `src/lib/workflows/index.ts` | Call `loadCustomTools()` on startup |
| `src/lib/workflows/chat/general-chat.ts` | Handle `create_tool` and `list_custom_tools` in tool call dispatch, inject new tools into `activeTools` |
| `data/prompts/06-problem-solving.md` | Rewrite with `create_tool` flow and examples |
| DB migration | `npx drizzle-kit push` to create the table |
