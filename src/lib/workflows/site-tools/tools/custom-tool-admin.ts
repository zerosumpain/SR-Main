// src/lib/workflows/site-tools/tools/custom-tool-admin.ts
//
// See, repair and remove the tools the platform has written for itself.
//
// These three existed already — `list_custom_tools`, `delete_tool` and a
// `create_tool` — but only inside `META_TOOL_DEFINITIONS`, which is consumed by
// `chat/general-chat.ts`. That engine went dormant at the cutover, so
// from the day the flag flipped none of them was reachable from chat. Verified
// against production 2026-08-11: absent from `tools/list`, and absent from every
// `jkai_extended` search that should have found them.
//
// The effect was quiet and total. Twenty-seven custom tools were live, written
// mostly by the nightly toolsmith, and chat could neither enumerate them nor
// remove one — so the only way to know what the platform could do was to read
// the database, and the only way to fix a bad tool was the admin UI. A tool
// that cannot be listed is a tool nobody audits; one that cannot be repaired
// gets replaced by a near-duplicate under a new name.
//
// `create_tool` is deliberately NOT revived. Authoring goes through
// `author_ephemeral_tool` → `promote_ephemeral_tool`, which runs the thing
// before storing it; a create-from-cold tool would be a second road with weaker
// evidence behind it. `update_tool` is here instead, and carries the same gate.

import { register, unregister } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildHandler } from '../custom-tool-loader';
import { staticScan, smokeTest, type SmokeCase } from '$lib/selfimprove/verify';

register({
  name: 'list_custom_tools',
  description:
    'List every tool the platform has written for itself — name, description, toolset, whether it is enabled, and its run and error counts. Use this before proposing a new tool (one may already exist), and to spot tools that are failing: a high error count against a high run count means the tool is broken, not unused. Built-in tools are not listed; they live in code.',
  toolset: 'custom-tools',
  category: 'Custom Tool',
  parameters: { type: 'object', properties: {} },
  handler: async (): Promise<ToolResult> => {
    try {
      const rows = await db.select().from(customTools);
      const tools = rows
        .map((r) => ({
          name: r.name,
          description: r.description,
          toolset: r.toolset,
          enabled: r.enabled,
          runCount: r.runCount ?? 0,
          errorCount: r.errorCount ?? 0,
          lastRunAt: r.lastRunAt ?? null,
          createdAt: r.createdAt ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      // Name the unhealthy ones rather than leaving the reader to divide two
      // columns in their head — this is the whole reason the counts are here.
      const failing = tools
        .filter((t) => t.runCount >= 3 && t.errorCount / t.runCount >= 0.5)
        .map((t) => `${t.name} (${t.errorCount}/${t.runCount} failed)`);
      return {
        success: true,
        data: { count: tools.length, tools, ...(failing.length ? { failing } : {}) },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'update_tool',
  description:
    "Replace a stored custom tool's handler code and/or description, in place. Use this to FIX a tool that is failing rather than creating a near-duplicate under a new name — the run history, the name and anything referring to it all survive. The new handler must pass the same checks a new tool does, and the old one stays live until the new one has proved itself, so a bad edit cannot take a working tool down.",
  toolset: 'custom-tools',
  category: 'Custom Tool',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the existing custom tool to update.' },
      handlerCode: {
        type: 'string',
        description:
          'New async JS function body, with args, fetch and platform in scope. Omit to change only the description.',
      },
      description: { type: 'string', description: 'New description. Omit to keep the current one.' },
      smokeCases: {
        type: 'array',
        items: { type: 'object' },
        description:
          'Argument sets the new handler must succeed on — REQUIRED when changing handlerCode, 1-3 of them, with real values. Every one must pass or the update is refused and the old handler is left running.',
      },
    },
    required: ['name'],
  },
  handler: async (args): Promise<ToolResult> => {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) return { success: false, error: 'name is required' };

    const [row] = await db.select().from(customTools).where(eq(customTools.name, name)).limit(1);
    if (!row) {
      return {
        success: false,
        error: `No custom tool named "${name}". Call list_custom_tools to see what exists. Built-in tools live in code and cannot be updated this way — those need request_change.`,
      };
    }

    const newDescription = typeof args.description === 'string' ? args.description.trim() : undefined;
    const newCode = typeof args.handlerCode === 'string' ? args.handlerCode : undefined;

    if (!newCode && !newDescription) {
      return { success: false, error: 'Nothing to change — pass handlerCode, description, or both.' };
    }

    // Description-only edits touch no executable code, so they need no proof.
    if (!newCode) {
      await db
        .update(customTools)
        .set({ description: newDescription! })
        .where(eq(customTools.name, name));
      register({
        name,
        description: newDescription!,
        toolset: row.toolset,
        category: 'Custom Tool',
        parameters: row.parameters as never,
        handler: buildHandler(name, row.handlerCode),
      });
      return { success: true, data: { name, changed: ['description'] } };
    }

    const scan = staticScan(newCode);
    if (!scan.ok) {
      return {
        success: false,
        error: `Refusing to update "${name}" — ${scan.violations.join('; ')}. The existing handler is untouched.`,
      };
    }

    const supplied = Array.isArray(args.smokeCases)
      ? (args.smokeCases as unknown[]).filter(
          (c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c),
        )
      : [];
    if (supplied.length === 0) {
      return {
        success: false,
        error:
          `Refusing to update "${name}" — changing handler code needs smokeCases: 1-3 sets of real ` +
          `arguments the new handler must succeed on. Without them there is no evidence the replacement ` +
          `is better than what is already running.`,
      };
    }

    const cases: SmokeCase[] = supplied.map((c, i) => ({ args: c, label: `case ${i + 1}` }));
    // Build the candidate WITHOUT registering it: buildHandler also increments
    // the stored run counters, and a trial should not pollute the health data
    // the caller just used to decide something was broken.
    const candidate = buildHandler(name, newCode);
    const smoke = await smokeTest(cases, candidate);
    if (!smoke.ok) {
      return {
        success: false,
        error:
          `Refusing to update "${name}" — the new handler failed: ${smoke.failureSummary ?? 'a case failed'}. ` +
          `The existing handler is still live and unchanged.`,
      };
    }

    await db
      .update(customTools)
      .set({
        handlerCode: newCode,
        ...(newDescription ? { description: newDescription } : {}),
        // The counters describe a handler that no longer exists. Carrying them
        // forward would make a fresh tool look like a proven one, and would
        // hide whether the repair actually worked.
        runCount: 0,
        errorCount: 0,
      })
      .where(eq(customTools.name, name));

    register({
      name,
      description: newDescription ?? row.description,
      toolset: row.toolset,
      category: 'Custom Tool',
      parameters: row.parameters as never,
      handler: buildHandler(name, newCode),
    });

    return {
      success: true,
      data: {
        name,
        changed: newDescription ? ['handlerCode', 'description'] : ['handlerCode'],
        casesPassed: cases.length,
        note: 'Run and error counts reset — they described the previous handler.',
      },
    };
  },
});

register({
  name: 'delete_tool',
  destructive: true,
  description:
    'Remove a stored custom tool permanently and unregister it, so nothing can call it afterwards. Prefer update_tool when a tool is merely broken — deleting loses the name and its history. Built-in tools cannot be deleted; only tools the platform wrote for itself.',
  toolset: 'custom-tools',
  category: 'Custom Tool',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Name of the custom tool to delete.' } },
    required: ['name'],
  },
  handler: async (args): Promise<ToolResult> => {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!name) return { success: false, error: 'name is required' };

    const [row] = await db.select().from(customTools).where(eq(customTools.name, name)).limit(1);
    if (!row) {
      return {
        success: false,
        error: `No custom tool named "${name}" exists. Built-in tools cannot be deleted — only tools created through promote_ephemeral_tool or the nightly improvement run.`,
      };
    }

    await db.delete(customTools).where(eq(customTools.name, name));
    const wasLive = unregister(name);
    return { success: true, data: { name, toolset: row.toolset, removedFromRegistry: wasLive } };
  },
});
