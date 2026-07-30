<script lang="ts">
  import { untrack } from 'svelte';
  import type { AgentDef } from '$lib/agents/types';
  import { invalidateAll } from '$app/navigation';
  import SubAgentBubble from '$lib/components/jkai/SubAgentBubble.svelte';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';

  type LiveStep = { toolCallId: string; tool: string; args: Record<string, unknown>; result?: unknown; status: 'running' | 'done' | 'error'; summary?: string; expanded?: boolean };
  type LiveAgent = { agentId: string; task: string; status: 'running' | 'done' | 'error'; summary?: string; liveTokens: string; toolSteps: LiveStep[]; startedAt?: number };

  import type { TeamMemoryEntry } from '$lib/agents/store';

  let { data }: { data: { agents: AgentDef[]; teamMemory: TeamMemoryEntry[] } } = $props();
  const agents = $derived(data.agents ?? []);
  const teamMemory = $derived(data.teamMemory ?? []);

  async function forgetMemory(id: string) {
    await fetch(`/api/jkai/agents/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await invalidateAll();
  }

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
  let liveAgent = $state<LiveAgent | null>(null);
  // Abort the SSE reader on navigation/unmount — otherwise the read loop
  // outlives the component and keeps writing unmounted $state.
  let delAbort: AbortController | null = null; // plain — never rendered
  $effect(() => () => delAbort?.abort());

  // Keep the delegate <select> valid when the team changes (delete/rename via
  // invalidateAll). Tracks agents; writes are untracked (no self-dependency).
  $effect(() => {
    const names = agents.map((a) => a.name);
    untrack(() => {
      if (!names.includes(delAgent)) delAgent = names[0] ?? '';
    });
  });

  function toggleStep(_agentId: string, toolCallId: string) {
    if (!liveAgent) return;
    liveAgent = { ...liveAgent, toolSteps: liveAgent.toolSteps.map((s) => (s.toolCallId === toolCallId ? { ...s, expanded: !s.expanded } : s)) };
  }

  function handleFrame(msg: { type: string; event?: Record<string, unknown>; result?: { agent: string; role: string; response: string }; message?: string }) {
    if (!liveAgent) return;
    if (msg.type === 'event' && msg.event) {
      const e = msg.event as { type: string; tool?: string; args?: Record<string, unknown>; toolCallId?: string; summary?: string; result?: unknown; status?: 'done' | 'error'; delta?: string };
      if (e.type === 'tool_start') {
        const id = e.toolCallId ?? `s${liveAgent.toolSteps.length}`;
        liveAgent = { ...liveAgent, toolSteps: [...liveAgent.toolSteps, { toolCallId: id, tool: e.tool ?? 'tool', args: e.args ?? {}, status: 'running', summary: e.summary }] };
      } else if (e.type === 'tool_result') {
        liveAgent = { ...liveAgent, toolSteps: liveAgent.toolSteps.map((s) => (s.toolCallId === e.toolCallId ? { ...s, result: e.result, status: e.status ?? 'done', summary: e.summary ?? s.summary } : s)) };
      } else if (e.type === 'token') {
        liveAgent = { ...liveAgent, liveTokens: (liveAgent.liveTokens + (e.delta ?? '')).slice(-2000) };
      }
    } else if (msg.type === 'done' && msg.result) {
      delResult = msg.result;
      liveAgent = { ...liveAgent, status: 'done', summary: msg.result.response.split('\n').find((l) => l.trim()) };
    } else if (msg.type === 'error') {
      delErr = msg.message ?? 'Delegation failed';
      liveAgent = { ...liveAgent, status: 'error' };
    }
  }

  async function delegate() {
    if (!delAgent || !delTask.trim() || delRunning) return;
    delRunning = true; delErr = null; delResult = null;
    liveAgent = { agentId: delAgent, task: delTask.trim(), status: 'running', liveTokens: '', toolSteps: [], startedAt: Date.now() };
    delAbort = new AbortController();
    try {
      const res = await fetch('/api/jkai/agents/delegate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: delAgent, task: delTask.trim() }),
        signal: delAbort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data: '));
          if (line) { try { handleFrame(JSON.parse(line.slice(6))); } catch { /* skip bad frame */ } }
        }
      }
    } catch (e) {
      delErr = e instanceof Error ? e.message : 'Delegation failed';
      if (liveAgent) liveAgent = { ...liveAgent, status: 'error' };
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
    {#if liveAgent}
      <div class="ag-live"><SubAgentBubble agent={liveAgent} onToggleStep={toggleStep} /></div>
    {/if}
    {#if delResult}
      <div class="ag-result">
        <div class="ag-result-hd"><span class="sr-label-tight">{delResult.role} responded</span></div>
        <div class="ag-result-body"><ChatMarkdown content={delResult.response} /></div>
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
            {#if a.allowedTools?.length}{#each a.allowedTools as t, ti (t + ':' + ti)}<span class="ag-tool">{t}</span>{/each}{:else}<span class="ag-tool ag-tool-all">full toolset</span>{/if}
            {#if a.model}<span class="ag-model">{a.model}</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <!-- Shared team memory -->
  <section class="ag-sec">
    <div class="ag-sec-hd"><span class="sr-label-tight">Team memory ({teamMemory.length})</span></div>
    {#if teamMemory.length === 0}
      <p class="ag-mem-empty">No shared findings yet — agents write durable results here as they work.</p>
    {:else}
      <ul class="ag-mem-list">
        {#each teamMemory as m (m.id)}
          <li class="ag-mem-row">
            <div class="ag-mem-hd">
              <span class="ag-mem-key">{m.key ?? m.id.slice(0, 8)}</span>
              <span class="ag-mem-meta">{m.updatedBy ?? '—'} · {new Date(m.updatedAt).toLocaleString()}</span>
              <button class="ag-link ag-danger" onclick={() => forgetMemory(m.id)} title="Delete this shared record">forget</button>
            </div>
            <pre class="ag-mem-prev">{m.preview}</pre>
          </li>
        {/each}
      </ul>
    {/if}
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
  .ag-kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .ag-hdr h1 { font-family: var(--font-display, var(--font-sans)); font-size: 2.125rem; margin: 4px 0 2px; }
  .ag-sub { margin: 0; color: var(--text-muted); font-size: var(--fs-nav); }
  .ag-back { display: inline-block; margin-top: 10px; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); text-decoration: none; }
  .ag-back:hover { color: var(--text-primary); }

  .ag-sec { margin-bottom: 24px; }
  .ag-sec-hd { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed var(--card-border); padding-bottom: 6px; margin-bottom: 12px; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .ag-del-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .ag-select, .ag-in { background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: var(--fs-body); padding: 8px 10px; outline: none; box-sizing: border-box; width: 100%; }
  .ag-select { flex: 1; font-family: var(--font-mono); font-size: var(--fs-label); }
  .ag-select:focus, .ag-in:focus, .ag-task:focus { border-color: var(--text-muted); }
  .ag-go, .ag-save { padding: 0 18px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; }
  .ag-go:disabled, .ag-save:disabled { opacity: 0.5; cursor: default; }
  .ag-save { padding: 8px 18px; }
  .ag-task { width: 100%; background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: var(--fs-body); padding: 8px 10px; outline: none; box-sizing: border-box; resize: vertical; }

  .ag-err { color: var(--status-error, #c0392b); font-size: var(--fs-label); margin: 6px 0 0; }

  /* Team memory */
  .ag-mem-empty { color: var(--text-muted); font-size: var(--fs-nav); }
  .ag-mem-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .ag-mem-row { border: 1px solid var(--card-border); padding: 8px 10px; background: var(--bg); }
  .ag-mem-hd { display: flex; align-items: baseline; gap: 10px; }
  .ag-mem-key { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .ag-mem-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); flex: 1; }
  .ag-mem-prev {
    margin: 6px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 90px;
    overflow: hidden;
  }
  .ag-live { margin-top: 12px; }
  .ag-result { margin-top: 12px; border: 1px solid var(--card-border); padding: 12px; }
  .ag-result-hd { margin-bottom: 6px; }
  .ag-result-body { font-size: var(--fs-nav); line-height: 1.55; white-space: pre-wrap; word-break: break-word; color: var(--text-muted); }

  .ag-new { font-family: var(--font-mono); font-size: var(--fs-label); background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer; padding: 3px 10px; }
  .ag-new:hover { border-color: var(--text-muted); color: var(--text-primary); }

  .ag-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .ag-card { border: 1px solid var(--card-border); padding: 12px; }
  .ag-card-hd { display: flex; align-items: baseline; gap: 8px; }
  .ag-role { font-size: var(--fs-body-sm); color: var(--text-primary); font-weight: 600; }
  .ag-name { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); flex: 1; }
  .ag-actions { display: flex; gap: 10px; }
  .ag-link { background: transparent; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; padding: 0; }
  .ag-link:hover { color: var(--text-primary); }
  .ag-danger:hover { color: var(--status-error, #c0392b); }
  .ag-persona { margin: 8px 0; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); }
  .ag-tools { display: flex; flex-wrap: wrap; gap: 4px; }
  .ag-tool { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); background: color-mix(in srgb, var(--card-border) 18%, transparent); padding: 1px 6px; }
  .ag-tool-all { color: var(--text-ghost); }
  .ag-model { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink, var(--accent)); padding: 1px 6px; border: 1px solid currentColor; }

  .ag-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 80; padding: 20px; }
  .ag-modal { background: var(--surface-elevated, var(--bg)); border: 1px solid var(--card-border); padding: 18px; width: 520px; max-width: 100%; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .ag-field { display: flex; flex-direction: column; gap: 4px; }
  .ag-field span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); }
  .ag-modal-foot { display: flex; justify-content: flex-end; gap: 12px; align-items: center; margin-top: 6px; }
</style>
