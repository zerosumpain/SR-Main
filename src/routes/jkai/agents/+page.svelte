<script lang="ts">
  import type { AgentDef } from '$lib/agents/types';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: { agents: AgentDef[] } } = $props();
  const agents = $derived(data.agents ?? []);

  // ── Edit / create form ──
  let editing = $state<string | null>(null); // agent name being edited, or '' for new, or null=closed
  let fName = $state('');
  let fRole = $state('');
  let fPersona = $state('');
  let fTools = $state('');
  let fModel = $state('');
  let saving = $state(false);
  let formErr = $state<string | null>(null);

  function openNew() {
    editing = '';
    fName = ''; fRole = ''; fPersona = ''; fTools = ''; fModel = '';
    formErr = null;
  }
  function openEdit(a: AgentDef) {
    editing = a.name;
    fName = a.name; fRole = a.role; fPersona = a.persona;
    fTools = (a.allowedTools ?? []).join(', '); fModel = a.model ?? '';
    formErr = null;
  }
  function closeForm() { editing = null; }

  async function save() {
    if (!fName.trim()) { formErr = 'Name is required'; return; }
    saving = true; formErr = null;
    try {
      const res = await fetch('/api/jkai/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fName.trim(),
          role: fRole.trim(),
          persona: fPersona.trim(),
          allowedTools: fTools.split(',').map((s) => s.trim()).filter(Boolean),
          model: fModel.trim() || undefined,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
      editing = null;
      await invalidateAll();
    } catch (e) {
      formErr = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function remove(a: AgentDef) {
    if (!confirm(`Delete agent "${a.name}"?`)) return;
    await fetch(`/api/jkai/agents?name=${encodeURIComponent(a.name)}`, { method: 'DELETE' });
    await invalidateAll();
  }

  // ── Delegate / test ──
  let delAgent = $state(data.agents?.[0]?.name ?? '');
  let delTask = $state('');
  let delRunning = $state(false);
  let delResult = $state<{ agent: string; role: string; response: string } | null>(null);
  let delErr = $state<string | null>(null);

  async function delegate() {
    if (!delAgent || !delTask.trim() || delRunning) return;
    delRunning = true; delErr = null; delResult = null;
    try {
      const res = await fetch('/api/jkai/agents/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: delAgent, task: delTask.trim() }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      delResult = b.result;
    } catch (e) {
      delErr = e instanceof Error ? e.message : 'Delegation failed';
    } finally {
      delRunning = false;
    }
  }
</script>

<svelte:head><title>Agent Team · JKAI</title></svelte:head>

<main class="ag">
  <header class="ag-hdr">
    <div class="ag-kicker">JKAI · Team</div>
    <h1>Agent Team</h1>
    <p class="ag-sub">Named specialists JKai delegates to — each with its own persona, allowed tools, and shared team memory.</p>
    <a class="ag-back" href="/jkai">← back to jkai</a>
  </header>

  <!-- Delegate / test -->
  <section class="ag-sec">
    <div class="ag-sec-hd"><span class="sr-label-tight">Delegate a task</span></div>
    <div class="ag-del-row">
      <select class="ag-select" bind:value={delAgent}>
        {#each agents as a (a.name)}<option value={a.name}>{a.role} ({a.name})</option>{/each}
      </select>
      <button class="ag-go" onclick={delegate} disabled={delRunning || !delTask.trim()}>{delRunning ? 'Working…' : 'Delegate'}</button>
    </div>
    <textarea class="ag-task" rows="2" placeholder="what should this specialist do?" bind:value={delTask}></textarea>
    {#if delErr}<p class="ag-err">⚠ {delErr}</p>{/if}
    {#if delResult}
      <div class="ag-result">
        <div class="ag-result-hd"><span class="sr-label-tight">{delResult.role} responded</span></div>
        <div class="ag-result-body">{delResult.response}</div>
      </div>
    {/if}
  </section>

  <!-- Team -->
  <section class="ag-sec">
    <div class="ag-sec-hd">
      <span class="sr-label-tight">The team ({agents.length})</span>
      <button class="ag-new" onclick={openNew}>+ new agent</button>
    </div>
    <ul class="ag-list">
      {#each agents as a (a.name)}
        <li class="ag-card">
          <div class="ag-card-hd">
            <span class="ag-role">{a.role}</span>
            <span class="ag-name">{a.name}</span>
            <span class="ag-actions">
              <button class="ag-link" onclick={() => openEdit(a)}>edit</button>
              <button class="ag-link ag-danger" onclick={() => remove(a)}>delete</button>
            </span>
          </div>
          <p class="ag-persona">{a.persona}</p>
          <div class="ag-tools">
            {#if a.allowedTools?.length}{#each a.allowedTools as t (t)}<span class="ag-tool">{t}</span>{/each}{:else}<span class="ag-tool ag-tool-all">full toolset</span>{/if}
            {#if a.model}<span class="ag-model">{a.model}</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>
</main>

{#if editing !== null}
  <div class="ag-modal-bg" role="button" tabindex="-1" onclick={closeForm} onkeydown={(e) => { if (e.key === 'Escape') closeForm(); }}>
    <div class="ag-modal" role="dialog" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="ag-sec-hd"><span class="sr-label-tight">{editing ? 'Edit agent' : 'New agent'}</span></div>
      <label class="ag-field"><span>Name</span><input class="ag-in" bind:value={fName} disabled={!!editing} placeholder="researcher" /></label>
      <label class="ag-field"><span>Role</span><input class="ag-in" bind:value={fRole} placeholder="Researcher" /></label>
      <label class="ag-field"><span>Persona (system prompt)</span><textarea class="ag-in" rows="4" bind:value={fPersona}></textarea></label>
      <label class="ag-field"><span>Allowed tools (comma-separated; blank = all)</span><input class="ag-in" bind:value={fTools} placeholder="knowledge_search, api_call" /></label>
      <label class="ag-field"><span>Model override (optional)</span><input class="ag-in" bind:value={fModel} placeholder="leave blank for default" /></label>
      {#if formErr}<p class="ag-err">⚠ {formErr}</p>{/if}
      <div class="ag-modal-foot">
        <button class="ag-link" onclick={closeForm}>cancel</button>
        <button class="ag-save" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ag { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; color: var(--text-primary); }
  .ag-hdr { border-bottom: 2px solid var(--card-border); padding-bottom: 16px; margin-bottom: 20px; }
  .ag-kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .ag-hdr h1 { font-family: var(--font-display, var(--font-sans)); font-size: 34px; margin: 4px 0 2px; }
  .ag-sub { margin: 0; color: var(--text-muted); font-size: 13px; }
  .ag-back { display: inline-block; margin-top: 10px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); text-decoration: none; }
  .ag-back:hover { color: var(--text-primary); }

  .ag-sec { margin-bottom: 24px; }
  .ag-sec-hd { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed var(--card-border); padding-bottom: 6px; margin-bottom: 12px; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .ag-del-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .ag-select, .ag-in { background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: 13px; padding: 8px 10px; outline: none; box-sizing: border-box; width: 100%; }
  .ag-select { flex: 1; font-family: var(--font-mono); font-size: 12px; }
  .ag-select:focus, .ag-in:focus, .ag-task:focus { border-color: var(--text-muted); }
  .ag-go, .ag-save { padding: 0 18px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; font-family: var(--font-mono); font-size: 12px; cursor: pointer; }
  .ag-go:disabled, .ag-save:disabled { opacity: 0.5; cursor: default; }
  .ag-save { padding: 8px 18px; }
  .ag-task { width: 100%; background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: 13px; padding: 8px 10px; outline: none; box-sizing: border-box; resize: vertical; }

  .ag-err { color: var(--status-error, #c0392b); font-size: 12px; margin: 6px 0 0; }
  .ag-result { margin-top: 12px; border: 1px solid var(--card-border); padding: 12px; }
  .ag-result-hd { margin-bottom: 6px; }
  .ag-result-body { font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--text-muted); }

  .ag-new { font-family: var(--font-mono); font-size: 11px; background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer; padding: 3px 10px; }
  .ag-new:hover { border-color: var(--text-muted); color: var(--text-primary); }

  .ag-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .ag-card { border: 1px solid var(--card-border); padding: 12px; }
  .ag-card-hd { display: flex; align-items: baseline; gap: 8px; }
  .ag-role { font-size: 14px; color: var(--text-primary); font-weight: 600; }
  .ag-name { font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); flex: 1; }
  .ag-actions { display: flex; gap: 10px; }
  .ag-link { background: transparent; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; cursor: pointer; padding: 0; }
  .ag-link:hover { color: var(--text-primary); }
  .ag-danger:hover { color: var(--status-error, #c0392b); }
  .ag-persona { margin: 8px 0; font-size: 12px; line-height: 1.5; color: var(--text-muted); }
  .ag-tools { display: flex; flex-wrap: wrap; gap: 4px; }
  .ag-tool { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); background: color-mix(in srgb, var(--card-border) 18%, transparent); padding: 1px 6px; }
  .ag-tool-all { color: var(--text-ghost); }
  .ag-model { font-family: var(--font-mono); font-size: 10px; color: var(--accent-ink, var(--accent)); padding: 1px 6px; border: 1px solid currentColor; }

  .ag-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 80; padding: 20px; }
  .ag-modal { background: var(--surface-elevated, var(--bg)); border: 1px solid var(--card-border); padding: 18px; width: 520px; max-width: 100%; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .ag-field { display: flex; flex-direction: column; gap: 4px; }
  .ag-field span { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); }
  .ag-modal-foot { display: flex; justify-content: flex-end; gap: 12px; align-items: center; margin-top: 6px; }
</style>
