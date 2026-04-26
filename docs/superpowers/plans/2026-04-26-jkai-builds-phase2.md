# JKAI Builds Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the deferred Phase-2 capabilities from the Apr-26 redesign — per-iteration approval gates, sandbox controls (snapshot/restore/reset), and an in-page Tinker file editor (CodeMirror, file save). The websocket terminal and pi RPC Drive mode remain deferred to **Phase 3** (separate plan, clearly scoped because they need infrastructure spikes).

**Architecture:** Additive endpoints + a per-iter pause point in the orchestrator + new `tinker-actions` Svelte components mounted in the existing `BuildDetailV2` chrome. CodeMirror is already a dep; no new packages needed.

**Tech Stack:** SvelteKit 2 / Svelte 5, CodeMirror 6, Vitest, existing sandbox helpers.

**Spec reference:** `docs/superpowers/specs/2026-04-26-jkai-builds-redesign-design.md` §10.

---

## Tasks

### Task 1: Per-iteration approval gate (orchestrator)

When `build.requireIterationApproval === true` AND the current iteration completed successfully (no failure, lint passed, tests passed): instead of scheduling the next iteration, transition build to a new status `awaiting_iter_approval` and stop. The user clicks **Approve** to resume or **Reject (with notes)** to feed feedback into the next iteration.

**Files:**
- Modify: `src/lib/jkai/orchestrator.ts` (insert pause after `snapshotIteration` + before `scheduleNext` at the success path)
- Create: `src/routes/api/jkai/builds/[id]/iter/+server.ts`

- [ ] **Step 1: Modify orchestrator success path**

In `runIteration`, after `snapshotIteration(buildId, iterationNumber)` and before `this.scheduleNext(buildId, 1000)` for the success case:

```typescript
if ((build as any).requireIterationApproval) {
  await db.update(jkaiBuilds)
    .set({ status: 'awaiting_iter_approval', updatedAt: new Date() })
    .where(eq(jkaiBuilds.id, buildId));
  await emitLog(buildId, 'system',
    `Iteration #${iterationNumber} complete — awaiting approval before iter #${iterationNumber + 1}.`,
    iteration.id);
  this.activeBuildId = null;
  return;
}
```

Add `approveIteration` and `rejectIteration(buildId, notes)` methods that:
- approve: status → 'running', schedule next.
- reject: status → 'running', append notes to `build.prompt` as a continuation note, schedule next.

- [ ] **Step 2: Endpoint `/api/jkai/builds/[id]/iter` POST**

```typescript
import { json, error } from '@sveltejs/kit';
import { orchestrator } from '$lib/jkai/orchestrator';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null) as { action?: string; notes?: string } | null;
  if (!body) throw error(400, 'invalid body');
  try {
    if (body.action === 'approve') await orchestrator.approveIteration(params.id!);
    else if (body.action === 'reject') await orchestrator.rejectIteration(params.id!, body.notes ?? '');
    else throw error(400, 'unknown action');
    return json({ ok: true });
  } catch (e: any) { if (e?.status) throw e; throw error(400, e.message); }
};
```

- [ ] **Step 3: Test**

`tests/lib/jkai/iter-approval.test.ts` — verify approveIteration sets status running. Skip end-to-end orchestrator loop; just unit-test the methods after stubbing `scheduleNext`. (Adjacent to existing planner tests for style.)

- [ ] **Step 4: Commit** `feat(jkai-builds): per-iteration approval gate`

---

### Task 2: Iteration approval UI

**Files:**
- Create: `src/lib/builds/IterApproval.svelte`
- Modify: `src/lib/builds/BuildDetailV2.svelte` (render the panel when `build.status === 'awaiting_iter_approval'`)

- [ ] **Step 1: `IterApproval.svelte`**

```svelte
<script lang="ts">
  let { buildId, onAfter }: { buildId: string; onAfter: () => void | Promise<void> } = $props();
  let notes = $state('');
  let saving = $state(false);
  async function call(action: string, body: Record<string, unknown> = {}) {
    saving = true;
    try {
      await fetch(`/api/jkai/builds/${buildId}/iter`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      await onAfter();
    } finally { saving = false; }
  }
</script>

<section class="nm-sec">
  <header class="nm-sec-hd"><span class="sr-label-tight">Iteration awaiting approval</span></header>
  <p class="dim">The latest iteration completed and is awaiting your sign-off before the build proceeds.</p>
  <textarea class="nm-text-input" rows="4" placeholder="(optional) reject notes — fed into next iteration as guidance" bind:value={notes}></textarea>
  <div class="actions">
    <button class="nm-save-btn" disabled={saving} onclick={() => call('approve')} type="button">Approve & Continue</button>
    <button class="nm-btn-ghost" disabled={saving} onclick={() => call('reject', { notes })} type="button">Reject with notes</button>
  </div>
</section>

<style>
  .actions { display: flex; gap: 0.6rem; margin-top: 0.6rem; }
  textarea { font-family: var(--font-mono); font-size: 12px; }
  .dim { color: var(--text-muted); margin: 0 0 0.5rem; font-size: 12px; }
</style>
```

- [ ] **Step 2: Hook in detail page**

```svelte
{#if build.status === 'awaiting_iter_approval'}
  <IterApproval buildId={build.id} onAfter={refresh} />
{/if}
```

- [ ] **Step 3: Commit** `feat(jkai-builds): iteration approval UI`

---

### Task 3: Sandbox controls (snapshot list + restore + reset)

**Files:**
- Create: `src/routes/api/jkai/builds/[id]/sandbox/+server.ts` (GET snapshots, POST {action: 'reset'|'snapshot'})
- Modify: `src/lib/jkai/sandbox.ts` (add `resetWorkspace`)
- Create: `src/lib/builds/SandboxControls.svelte`
- Modify: `src/lib/builds/BuildSidebar.svelte` (mount `SandboxControls`)

- [ ] **Step 1: Add `resetWorkspace` to sandbox.ts**

```typescript
export async function resetWorkspace(buildId: string): Promise<void> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  await execInSandbox(`rm -rf ${dir} && mkdir -p ${dir}`);
}

export async function snapshotNow(buildId: string): Promise<number> {
  const all = await listSnapshots(buildId);
  const next = (all[all.length - 1] ?? 0) + 1000; // out-of-band slot
  await snapshotIteration(buildId, next);
  return next;
}
```

- [ ] **Step 2: Endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { listSnapshots, activateSnapshot, snapshotNow, resetWorkspace } from '$lib/jkai/sandbox';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const snaps = await listSnapshots(params.id!);
  return json({ snapshots: snaps });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null) as { action?: string; iterationNumber?: number } | null;
  if (!body?.action) throw error(400, 'action required');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id!));
  if (!build) throw error(404, 'not found');
  if (build.status === 'running') throw error(409, 'pause the build before sandbox actions');

  if (body.action === 'reset') await resetWorkspace(params.id!);
  else if (body.action === 'snapshot') {
    const n = await snapshotNow(params.id!);
    return json({ ok: true, snapshot: n });
  } else if (body.action === 'restore' && typeof body.iterationNumber === 'number') {
    const serve = (build.serveConfig as any) ?? { startCommand: '', port: 0, healthCheck: '/' };
    await activateSnapshot(params.id!, body.iterationNumber, serve.startCommand, serve.port, serve.healthCheck);
  } else throw error(400, 'bad action');
  return json({ ok: true });
};
```

- [ ] **Step 3: `SandboxControls.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  let { buildId, status }: { buildId: string; status: string } = $props();
  let snapshots = $state<number[]>([]);
  let busy = $state<string | null>(null);

  async function loadSnaps() {
    const r = await fetch(`/api/jkai/builds/${buildId}/sandbox`);
    if (r.ok) snapshots = (await r.json()).snapshots ?? [];
  }
  async function call(action: string, extra: Record<string, unknown> = {}, label: string) {
    if (status === 'running') { alert('Pause the build first.'); return; }
    if (action === 'reset' && !confirm('Wipe the dev workspace? Cannot be undone (snapshot first if needed).')) return;
    busy = label;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/sandbox`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!r.ok) alert(`${label} failed: ${await r.text()}`);
      else if (action === 'snapshot') loadSnaps();
    } finally { busy = null; }
  }

  onMount(loadSnaps);
</script>

<section class="nm-sec">
  <header class="nm-sec-hd"><span class="sr-label-tight">Sandbox</span></header>
  <div class="row">
    <button class="nm-btn-ghost" disabled={busy !== null || status === 'running'} onclick={() => call('snapshot', {}, 'Snapshot')} type="button">
      {busy === 'Snapshot' ? '…' : 'Snapshot now'}
    </button>
    <button class="row-link danger" disabled={busy !== null || status === 'running'} onclick={() => call('reset', {}, 'Reset')} type="button">
      Reset workspace
    </button>
  </div>
  {#if snapshots.length > 0}
    <p class="lbl">Restore from snapshot</p>
    <ul>
      {#each snapshots as n (n)}
        <li>
          <button class="row-link" disabled={busy !== null || status === 'running'} onclick={() => call('restore', { iterationNumber: n }, `Restore ${n}`)} type="button">
            ↩ iter {n}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if status === 'running'}<p class="dim">Pause the build to use sandbox actions.</p>{/if}
</section>

<style>
  .row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  ul { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 2px; }
  .lbl { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); margin: 8px 0 4px; }
  .dim { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; margin: 6px 0 0; }
</style>
```

- [ ] **Step 4: Wire in `BuildSidebar.svelte`**

Insert below the Strategy section.

- [ ] **Step 5: Commit** `feat(jkai-builds): sandbox controls`

---

### Task 4: Tinker editor — file save endpoint

**Files:**
- Modify: `src/lib/jkai/sandbox.ts` (add `writeDevFile`)
- Modify: `src/routes/api/jkai/builds/[id]/files/[...path]/+server.ts` (add PUT)

- [ ] **Step 1: `writeDevFile`**

```typescript
export async function writeDevFile(buildId: string, relPath: string, content: string): Promise<void> {
  const safe = relPath.replace(/\.\./g, '').replace(/^\/+/, '');
  await writeFileInSandbox(`/home/jkai/workspace/${buildId}/dev/${safe}`, content);
}
```

- [ ] **Step 2: Add PUT handler**

```typescript
export const PUT: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id!));
  if (!build) throw error(404, 'not found');
  if (build.status === 'running') throw error(409, 'pause the build before editing files');
  const body = await request.json().catch(() => null) as { content?: string } | null;
  if (!body || typeof body.content !== 'string') throw error(400, 'content required');
  await writeDevFile(params.id!, params.path!, body.content);
  return json({ ok: true });
};
```

(Add the necessary imports at the top.)

- [ ] **Step 3: Commit** `feat(jkai-builds): tinker file save endpoint`

---

### Task 5: Tinker editor UI (CodeMirror)

**Files:**
- Create: `src/lib/builds/TinkerEditor.svelte`
- Modify: `src/lib/builds/WatchPane.svelte` (when `mode === 'tinker'`, render TinkerEditor instead of `<pre>` viewer)
- Modify: `src/lib/builds/BuildDetailV2.svelte` (pass `mode` to the pane and enable Tinker in `ModeSwitcher`)
- Modify: `src/lib/builds/ModeSwitcher.svelte` (Tinker → enabled = true)

- [ ] **Step 1: `TinkerEditor.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView, lineNumbers, keymap } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { bracketMatching, foldGutter } from '@codemirror/language';

  let { buildId, path, status, content, onSaved }: {
    buildId: string; path: string; status: string; content: string;
    onSaved: () => void | Promise<void>;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let saving = $state(false);
  let dirty = $state(false);
  let lastError = $state<string | null>(null);

  function init() {
    if (!host) return;
    view?.destroy();
    view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          foldGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => { if (u.docChanged) dirty = true; }),
          EditorView.editable.of(status !== 'running'),
        ],
      }),
      parent: host,
    });
  }

  $effect(() => {
    init();
    return () => view?.destroy();
  });

  async function save() {
    if (!view) return;
    saving = true;
    lastError = null;
    try {
      const body = view.state.doc.toString();
      const r = await fetch(`/api/jkai/builds/${buildId}/files/${encodeURI(path)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: body }),
      });
      if (!r.ok) {
        lastError = `${r.status}: ${(await r.text()).slice(0, 200)}`;
        return;
      }
      dirty = false;
      await onSaved();
    } finally { saving = false; }
  }
</script>

<div class="editor">
  <header>
    <span class="path">{path}</span>
    {#if status === 'running'}
      <span class="dim">Build running — pause to edit</span>
    {:else if dirty}
      <button class="nm-save-btn" disabled={saving} onclick={save} type="button">{saving ? 'Saving…' : 'Save'}</button>
    {:else}
      <span class="dim">Saved</span>
    {/if}
  </header>
  <div bind:this={host} class="cm-host"></div>
  {#if lastError}<p class="err">{lastError}</p>{/if}
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 4px; min-height: 320px; }
  header { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
  .path { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); flex: 1; }
  .dim { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
  .cm-host { border: 1px solid var(--card-border); background: var(--bg); min-height: 320px; max-height: 60vh; overflow: auto; }
  .cm-host :global(.cm-editor) { font-family: var(--font-mono); font-size: 12px; }
  .err { color: var(--status-error); font-family: var(--font-mono); font-size: 11px; margin: 4px 0 0; }
</style>
```

- [ ] **Step 2: Update `WatchPane.svelte` to optionally render the editor**

Add a `mode: 'watch' | 'tinker'` prop and a `status` prop. When `mode === 'tinker'` and a file is selected, render `<TinkerEditor>` instead of the `<pre>` read-only viewer.

- [ ] **Step 3: `BuildDetailV2.svelte`** — pass `mode` and `build.status` through to the pane:

```svelte
{#if mode === 'watch' || mode === 'tinker'}
  <Activity feed={feed} />
  <FilesTimeline changes={fileTimeline} />
  <WatchPane buildId={build.id} mode={mode} status={build.status} />
{:else}
  <section class="nm-sec"><p class="dim">{mode} mode coming in Phase 3 — pi RPC drive-mode.</p></section>
{/if}
```

Update `ModeSwitcher.svelte` so `tinker` is enabled (Drive remains disabled with "Phase 3").

- [ ] **Step 4: Commit** `feat(jkai-builds): tinker editor (CodeMirror)`

---

### Task 6: Verify

- [ ] `npx vitest run tests/lib/jkai tests/lib/builds`
- [ ] `NODE_OPTIONS=--max-old-space-size=6144 npm run check` — zero errors in changed files
- [ ] `NODE_OPTIONS=--max-old-space-size=6144 npm run build`

---

### Task 7: Push + deploy

- [ ] `git push origin master`
- [ ] `bash scripts/deploy.sh`
- [ ] Smoke check: `curl -sL -o /dev/null -w "%{http_code}" https://strangeramblings.com/jkai/builds`

---

## Phase 3 — still deferred (separate plan)

- **Tinker terminal** — needs websocket support in the SvelteKit/adapter-node server. Either custom `server.js` wrapping the SvelteKit handler with `ws`, or a small co-process exposing a websocket→`docker exec -it` bridge. Either way, several hours of careful work plus testing.
- **Drive mode** — pi RPC protocol exploration, then a state machine that pauses the orchestrator's iteration loop while user-driven RPC messages are routed through. Risk: stalled-pi-process recovery semantics.

These are intentionally **not** in this plan because rushing them risks breaking the (now stable) build path.
