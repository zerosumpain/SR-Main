# Dynamic Prompt Loader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded system prompts with a file-based prompt system using numbered `.md` files, DB caching, daily refresh, and an API for site editing.

**Architecture:** Prompt files live in `data/prompts/` as numbered `.md` files. A loader reads them from disk, concatenates in filename order, and caches the result in a `promptCache` DB table. Both WhatsApp bridge and website orchestrator consume the cached prompt. API endpoints enable viewing and editing from the site.

**Tech Stack:** Node.js fs, Drizzle ORM, SvelteKit API routes, Vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `data/prompts/01-soul.md` | Create | Personality and tone |
| `data/prompts/02-capabilities.md` | Create | System capabilities summary |
| `data/prompts/03-tools.md` | Create | Tool usage guide |
| `data/prompts/04-context.md` | Create | User and platform context |
| `data/prompts/05-rules.md` | Create | Operating rules |
| `src/lib/db/schema.ts` | Modify | Add `promptCache` table |
| `src/lib/workflows/prompts/loader.ts` | Create | Prompt file reader, compiler, cache manager |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Modify | Replace hardcoded SYSTEM_PROMPT with compiled prompt |
| `src/lib/workflows/orchestrator/index.ts` | Modify | Replace loadSoulMd with compiled prompt |
| `src/lib/workflows/index.ts` | Modify | Add prompt sync to boot sequence |
| `src/routes/api/workflows/prompts/+server.ts` | Create | List files + force sync |
| `src/routes/api/workflows/prompts/[filename]/+server.ts` | Create | Get/update individual files |
| `tests/lib/workflows/prompts/loader.test.ts` | Create | Prompt loader tests |

---

### Task 1: Create Prompt Files and DB Schema

**Files:**
- Create: `data/prompts/01-soul.md`
- Create: `data/prompts/02-capabilities.md`
- Create: `data/prompts/03-tools.md`
- Create: `data/prompts/04-context.md`
- Create: `data/prompts/05-rules.md`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Create the prompts directory and seed 01-soul.md**

Read the current soul.md content from the database:

```bash
cd ~/strange_rambling_svelte
mkdir -p data/prompts
node -e "
import pg from 'pg';
const client = new pg.Client('postgresql://app:test@localhost:5433/strange_rambling');
await client.connect();
const res = await client.query(\"SELECT soul_md FROM whatsapp_config WHERE id = 'default'\");
if (res.rows[0]?.soul_md) {
  (await import('fs')).writeFileSync('data/prompts/01-soul.md', res.rows[0].soul_md);
  console.log('Written', res.rows[0].soul_md.length, 'bytes');
} else {
  console.log('No soul.md found');
}
await client.end();
"
```

- [ ] **Step 2: Create 02-capabilities.md**

Create `data/prompts/02-capabilities.md`:

```markdown
# Capabilities

You are deeply integrated with your user's personal platform (strangeramblings.com) and home infrastructure:

## Smart Home (Home Assistant)
- 400+ entities across 13 areas: lights, climate, media, cameras, sensors, location tracking
- Philips Hue lighting throughout the home
- Tado climate control
- Ring doorbell/cameras
- Sony BRAVIA TVs
- Amazon Alexa devices
- Use ha_* functions for direct control

## Health & Fitness
- Strava: running, cycling, hiking activities
- Apple Watch: heart rate, recovery metrics
- Weekly stats, readiness scores, sleep analysis, training load
- Use site_health_* functions to query

## Blog & Content
- Full blog CMS with drafts and publishing
- Markdown and HTML content support
- Use site_blog_* functions to manage posts

## JKAI Builder
- Autonomous code generation from prompts
- Build, monitor, and publish web apps
- Use jkai_* functions to control

## Deep Dive Research
- Multi-phase AI research on any topic
- Fact extraction, source credibility scoring, narrative building
- Use research_* functions to start and retrieve
```

- [ ] **Step 3: Create 03-tools.md**

Create `data/prompts/03-tools.md`:

```markdown
# Tool Usage Guide

When using function-calling tools, follow these principles:

## General
- Query before acting. Check state before changing it.
- Be specific with entity IDs and identifiers.
- Report results conversationally — don't dump raw JSON.

## Home Assistant
- Use exact entity_id values (e.g. "light.living_room_ceiling", not "the living room light")
- For lights: turn_on, turn_off, toggle. Use brightness (0-255) in service data.
- For climate: set_temperature with { temperature: N } in service data.
- Query sensor states to answer "what's the temperature" questions.

## Health
- site_health_readiness gives the most useful daily snapshot.
- site_health_stats for weekly summaries and personal records.
- site_health_sleep for sleep quality details.

## Blog
- Always list posts before trying to get/update a specific one.
- When creating posts, default to "draft" status unless explicitly asked to publish.

## JKAI
- Builds are asynchronous — start returns immediately, check status later.
- Don't publish builds without being asked.

## Research
- Research sessions take time (minutes). Start and check back.
- Use "standard" depth unless the user asks for more/less.
```

- [ ] **Step 4: Create 04-context.md**

Create `data/prompts/04-context.md`:

```markdown
# Context

## Who You're Helping
- John Kelly, software engineer
- Based in the UK
- Runs homeserv (home server) and strangeramblings.com (personal site)
- Phone: +447359228511

## Platform
- strangeramblings.com: SvelteKit app with health dashboard, blog, workflow engine, JKAI builder, deep dive research
- homeserv: Home server running Home Assistant, PostgreSQL, various Docker services
- Connected via Tailscale for secure networking

## Communication
- WhatsApp is the primary conversational channel
- Website orchestrator chat is the workflow-specific interface
- Keep the same personality across both
```

- [ ] **Step 5: Create 05-rules.md**

Create `data/prompts/05-rules.md`:

```markdown
# Rules

- Keep responses concise. This is WhatsApp, not an essay.
- Be direct, useful, and natural.
- Don't explain what you're about to do — just do it and report the result.
- If a tool call fails, say what happened briefly and suggest an alternative.
- Don't ask for confirmation before querying state. Just query and respond.
- Do ask for confirmation before making changes (turning things off, publishing posts, starting builds).
- Never expose raw JSON, API errors, or stack traces. Summarise for humans.
- When controlling the smart home, confirm what you did ("Living room lights off").
```

- [ ] **Step 6: Add promptCache table to schema**

Add at the end of `src/lib/db/schema.ts`:

```typescript
// ==========================================
// Prompt Cache
// ==========================================

export const promptCache = pgTable('prompt_cache', {
  id: text('id').primaryKey().default('default'),
  compiledPrompt: text('compiled_prompt').notNull().default(''),
  fileManifest: jsonb('file_manifest').notNull().default(sql`'[]'::jsonb`),
  lastSynced: timestamp('last_synced', { withTimezone: true }),
});

export type PromptCache = typeof promptCache.$inferSelect;
```

- [ ] **Step 7: Push schema**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

- [ ] **Step 8: Commit**

```bash
cd ~/strange_rambling_svelte
git add data/prompts/ src/lib/db/schema.ts
git commit -m "feat(prompts): add prompt files and promptCache db table"
```

---

### Task 2: Prompt Loader

**Files:**
- Create: `src/lib/workflows/prompts/loader.ts`
- Create: `tests/lib/workflows/prompts/loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/prompts/loader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// Mock DB
const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelect(),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        mockInsert(v);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      },
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({
  promptCache: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

import { syncPrompts, getPromptFiles, compilePromptFiles } from '$lib/workflows/prompts/loader';

const TEST_DIR = join(process.cwd(), 'test-prompts-tmp');

describe('Prompt Loader', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('reads and concatenates .md files in filename order', () => {
    writeFileSync(join(TEST_DIR, '02-second.md'), 'Second file');
    writeFileSync(join(TEST_DIR, '01-first.md'), 'First file');
    writeFileSync(join(TEST_DIR, '03-third.md'), 'Third file');
    writeFileSync(join(TEST_DIR, 'not-md.txt'), 'Ignored');

    const result = compilePromptFiles(TEST_DIR);

    expect(result.compiled).toBe('First file\n\n---\n\nSecond file\n\n---\n\nThird file');
    expect(result.manifest).toHaveLength(3);
    expect(result.manifest[0].name).toBe('01-first.md');
    expect(result.manifest[1].name).toBe('02-second.md');
    expect(result.manifest[2].name).toBe('03-third.md');
  });

  it('returns empty string for empty directory', () => {
    const result = compilePromptFiles(TEST_DIR);

    expect(result.compiled).toBe('');
    expect(result.manifest).toHaveLength(0);
  });

  it('creates directory if it does not exist', () => {
    const nonExistent = join(TEST_DIR, 'sub', 'dir');
    const result = compilePromptFiles(nonExistent);

    expect(result.compiled).toBe('');
    expect(result.manifest).toHaveLength(0);
  });

  it('getPromptFiles returns file contents', () => {
    writeFileSync(join(TEST_DIR, '01-test.md'), 'Test content');

    const files = getPromptFiles(TEST_DIR);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('01-test.md');
    expect(files[0].content).toBe('Test content');
  });

  it('syncPrompts writes compiled prompt to DB', async () => {
    writeFileSync(join(TEST_DIR, '01-a.md'), 'Alpha');
    writeFileSync(join(TEST_DIR, '02-b.md'), 'Beta');

    await syncPrompts(TEST_DIR);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        compiledPrompt: 'Alpha\n\n---\n\nBeta',
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/prompts/loader.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/prompts/loader'`

- [ ] **Step 3: Write the loader**

Create `src/lib/workflows/prompts/loader.ts`:

```typescript
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { db } from '$lib/db';
import { promptCache } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const DEFAULT_PROMPTS_DIR = join(process.cwd(), 'data', 'prompts');

interface FileManifestEntry {
  name: string;
  size: number;
  lastModified: string;
}

interface CompileResult {
  compiled: string;
  manifest: FileManifestEntry[];
}

export function compilePromptFiles(dir: string = DEFAULT_PROMPTS_DIR): CompileResult {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return { compiled: '', manifest: [] };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    return { compiled: '', manifest: [] };
  }

  const manifest: FileManifestEntry[] = [];
  const contents: string[] = [];

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf-8');
    contents.push(content);
    manifest.push({
      name: file,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
    });
  }

  return {
    compiled: contents.join('\n\n---\n\n'),
    manifest,
  };
}

export function getPromptFiles(dir: string = DEFAULT_PROMPTS_DIR): Array<{
  name: string;
  content: string;
  size: number;
  lastModified: string;
}> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return [];
  }

  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      return {
        name: file,
        content: readFileSync(filePath, 'utf-8'),
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
      };
    });
}

export function savePromptFile(name: string, content: string, dir: string = DEFAULT_PROMPTS_DIR): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dir, name), content, 'utf-8');
}

export async function syncPrompts(dir: string = DEFAULT_PROMPTS_DIR): Promise<string> {
  const { compiled, manifest } = compilePromptFiles(dir);

  await db
    .insert(promptCache)
    .values({
      id: 'default',
      compiledPrompt: compiled,
      fileManifest: manifest,
      lastSynced: new Date(),
    })
    .onConflictDoUpdate({
      target: promptCache.id,
      set: {
        compiledPrompt: compiled,
        fileManifest: manifest,
        lastSynced: new Date(),
      },
    });

  console.log(`[prompts] Synced ${manifest.length} files (${compiled.length} chars)`);
  return compiled;
}

export async function getCompiledPrompt(dir: string = DEFAULT_PROMPTS_DIR): Promise<string> {
  try {
    const [cached] = await db
      .select()
      .from(promptCache)
      .where(eq(promptCache.id, 'default'))
      .limit(1);

    if (cached?.compiledPrompt) {
      return cached.compiledPrompt;
    }
  } catch {}

  // Cache miss — sync from disk
  return syncPrompts(dir);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/prompts/loader.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/prompts/loader.ts tests/lib/workflows/prompts/loader.test.ts
git commit -m "feat(prompts): add prompt loader with compile, cache, and sync"
```

---

### Task 3: Wire Up Consumers

**Files:**
- Modify: `src/lib/workflows/whatsapp/orchestrator-bridge.ts`
- Modify: `src/lib/workflows/orchestrator/index.ts`
- Modify: `src/lib/workflows/index.ts`

- [ ] **Step 1: Update WhatsApp bridge**

In `src/lib/workflows/whatsapp/orchestrator-bridge.ts`:

Remove the hardcoded `SYSTEM_PROMPT` constant (the entire multi-line string at the top of the file).

Add import at the top:

```typescript
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
```

In the `handleMessage` method, find where `systemContent` is built. Replace:

```typescript
const systemContent = this.soulMd
    ? `${SYSTEM_PROMPT}${haSection}${siteSection}\n\n--- Personality & Style ---\n${this.soulMd}`
    : `${SYSTEM_PROMPT}${haSection}${siteSection}`;
```

With:

```typescript
const basePrompt = await getCompiledPrompt();
const systemContent = `${basePrompt}${haSection}${siteSection}`;
```

Also remove the `soulMd` field from the constructor and class, the `setSoulMd` method, and the `soulMd` parameter — they're no longer needed since soul.md is now part of the compiled prompt. Update the constructor to just take `sendFn`:

```typescript
constructor(sendFn: SendFn) {
    this.sendFn = sendFn;
}
```

Remove `private soulMd: string;` and `setSoulMd()`.

- [ ] **Step 2: Update callers of OrchestratorBridge constructor**

In `src/lib/workflows/index.ts`, find the `bootWhatsApp` function where `OrchestratorBridge` is constructed. Change:

```typescript
const bridge = new OrchestratorBridge(
    (to, text) => service.sendMessage(to, text),
    config.soulMd || '',
);
```

To:

```typescript
const bridge = new OrchestratorBridge(
    (to, text) => service.sendMessage(to, text),
);
```

In `src/routes/api/workflows/whatsapp/connect/+server.ts`, find the same pattern and update:

```typescript
const bridge = new OrchestratorBridge(
    (to, text) => service.sendMessage(to, text),
);
```

- [ ] **Step 3: Update website orchestrator**

In `src/lib/workflows/orchestrator/index.ts`:

Replace the `loadSoulMd` import and function with:

```typescript
import { getCompiledPrompt } from '$lib/workflows/prompts/loader';
```

Remove the `loadSoulMd` function entirely.

In `generateWorkflow`, replace:

```typescript
const soulMd = await loadSoulMd();
const basePrompt = buildToolUseSystemPrompt(grounding);
const systemPrompt = soulMd
    ? `${basePrompt}\n\n--- Personality & Style ---\n${soulMd}`
    : basePrompt;
```

With:

```typescript
const personalityPrompt = await getCompiledPrompt();
const basePrompt = buildToolUseSystemPrompt(grounding);
const systemPrompt = personalityPrompt
    ? `${basePrompt}\n\n${personalityPrompt}`
    : basePrompt;
```

In `modifyWorkflow`, replace similarly:

```typescript
const personalityPrompt = await getCompiledPrompt();
const baseModifyPrompt = buildModifySystemPrompt(
    { nodes: currentNodes, edges: currentEdges },
    grounding,
);
const systemPrompt = personalityPrompt
    ? `${baseModifyPrompt}\n\n${personalityPrompt}`
    : baseModifyPrompt;
```

Remove the `whatsappConfig` import from schema (if it's only used by `loadSoulMd`).

- [ ] **Step 4: Add prompt sync to boot sequence**

In `src/lib/workflows/index.ts`, add import:

```typescript
import { syncPrompts } from './prompts/loader';
```

Add boot call after the existing `bootWhatsApp()` and `bootHomeAssistant()` calls:

```typescript
// Sync prompt files on boot
syncPrompts().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[prompts] Sync failed:', msg);
});
```

- [ ] **Step 5: Update tests**

In `tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts`:

Add mock for the prompt loader:

```typescript
vi.mock('$lib/workflows/prompts/loader', () => ({
    getCompiledPrompt: vi.fn().mockResolvedValue('You are a helpful assistant.'),
}));
```

Update the `OrchestratorBridge` constructor calls to remove the soulMd parameter:

```typescript
bridge = new OrchestratorBridge(sendFn);
```

- [ ] **Step 6: Run tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/ 2>&1 | tail -8
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/whatsapp/orchestrator-bridge.ts src/lib/workflows/orchestrator/index.ts src/lib/workflows/index.ts src/routes/api/workflows/whatsapp/connect/+server.ts tests/lib/workflows/whatsapp/orchestrator-bridge.test.ts
git commit -m "feat(prompts): wire compiled prompt into WhatsApp bridge and website orchestrator"
```

---

### Task 4: API Endpoints

**Files:**
- Create: `src/routes/api/workflows/prompts/+server.ts`
- Create: `src/routes/api/workflows/prompts/[filename]/+server.ts`

- [ ] **Step 1: Create prompts list + sync endpoint**

Create `src/routes/api/workflows/prompts/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPromptFiles, syncPrompts } from '$lib/workflows/prompts/loader';

export const GET: RequestHandler = async () => {
  const files = getPromptFiles();
  return json({ files });
};

export const POST: RequestHandler = async () => {
  await syncPrompts();
  const files = getPromptFiles();
  return json({ success: true, files });
};
```

- [ ] **Step 2: Create individual file endpoint**

Create `src/routes/api/workflows/prompts/[filename]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPromptFiles, savePromptFile, syncPrompts } from '$lib/workflows/prompts/loader';

export const GET: RequestHandler = async ({ params }) => {
  const { filename } = params;
  const files = getPromptFiles();
  const file = files.find((f) => f.name === filename);

  if (!file) {
    return json({ error: 'File not found' }, { status: 404 });
  }

  return json(file);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { filename } = params;
  const body = await request.json();
  const { content } = body;

  if (typeof content !== 'string') {
    return json({ error: 'content is required' }, { status: 400 });
  }

  savePromptFile(filename, content);
  await syncPrompts();

  return json({ success: true });
};
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/prompts/
git commit -m "feat(prompts): add API endpoints for listing and editing prompt files"
```

---

### Task 5: Push Schema to VPS, Deploy, and Test

- [ ] **Step 1: Push schema to VPS**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -c \"
CREATE TABLE IF NOT EXISTS prompt_cache (
  id TEXT PRIMARY KEY DEFAULT 'default',
  compiled_prompt TEXT NOT NULL DEFAULT '',
  file_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced TIMESTAMPTZ
);
\""
```

- [ ] **Step 2: Copy prompt files to VPS**

```bash
rsync -avz -e "ssh -i ~/.ssh/id_ed25519" data/prompts/ johnk@157.180.19.38:/opt/strange-rambling-svelte/data/prompts/
```

- [ ] **Step 3: Run all tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/
```

- [ ] **Step 4: Push and deploy**

```bash
cd ~/strange_rambling_svelte && git push origin master && bash scripts/deploy.sh
```

- [ ] **Step 5: Verify boot**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "sleep 3 && sudo journalctl -u strange-rambling-svelte --no-pager -n 15 | grep -E '\[prompts\]|\[ha\]|\[whatsapp\]'"
```

Expected: `[prompts] Synced 5 files (N chars)`, `[ha] Service booted`, `[whatsapp] Connected`.

- [ ] **Step 6: Test via WhatsApp**

Send a message and verify the response reflects the personality from soul.md and follows the rules from 05-rules.md.

- [ ] **Step 7: Test API**

```bash
curl -s http://localhost:4173/api/workflows/prompts | head -200
```

(Will return 401 from VPS without auth — test from the browser or locally.)
