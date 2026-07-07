<script lang="ts">
  import SubAgentBubble from './SubAgentBubble.svelte';
  import type { SubAgent } from './SubAgentBubble.svelte';

  let { agents, onToggleStep }: {
    agents: SubAgent[];
    onToggleStep: (agentId: string, toolCallId: string) => void;
  } = $props();

  // Minimised by default (the header carries a live summary); the user expands
  // to watch each worker's tool steps — John's "worker tab you can expand".
  let open = $state(false);

  const running = $derived(agents.filter((a) => a.status === 'running').length);
  const failed = $derived(agents.filter((a) => a.status === 'error').length);
  const allDone = $derived(running === 0 && agents.length > 0);

  // Live clock for the elapsed counter. `id` is a local const (never $state);
  // the effect writes `now` but does not read it, so there is no update loop.
  let now = $state(Date.now());
  $effect(() => {
    if (running === 0) return;
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  function fmt(startedAt: number | undefined): string {
    if (!startedAt) return '';
    const s = Math.max(0, Math.round((now - startedAt) / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  // A compact "what's happening now" line for the collapsed header: the most
  // recent tool label across the running workers.
  const latest = $derived.by(() => {
    for (const a of agents) {
      if (a.status !== 'running') continue;
      const last = a.toolSteps[a.toolSteps.length - 1];
      if (last?.summary) return last.summary;
    }
    return '';
  });
</script>

{#if agents.length > 0}
  <section class="worker-tray" data-state={allDone ? 'done' : 'running'} aria-label="Sub-agent workers">
    <button type="button" class="wt-hdr" onclick={() => { open = !open; }} aria-expanded={open}>
      <span class="wt-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <svg class="wt-icon" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
        <circle cx="10" cy="6.5" r="2.5"/><path d="M4.5 16c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>
      </svg>
      <span class="wt-title">
        {#if allDone}
          {agents.length} sub-agent{agents.length === 1 ? '' : 's'} done{failed > 0 ? ` · ${failed} failed` : ''}
        {:else}
          {running} of {agents.length} sub-agent{agents.length === 1 ? '' : 's'} working
        {/if}
      </span>
      {#if !open && latest}
        <span class="wt-latest">{latest}</span>
      {/if}
      {#if !allDone}
        <span class="wt-dot" aria-hidden="true"></span>
      {/if}
    </button>

    {#if open}
      <div class="wt-body">
        {#each agents as agent (agent.agentId)}
          <div class="wt-agent">
            <div class="wt-agent-meta">
              <span class="wt-agent-elapsed">{fmt(agent.startedAt)}</span>
            </div>
            <SubAgentBubble {agent} {onToggleStep} />
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .worker-tray {
    margin: 8px 0;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--bg-section);
  }
  .worker-tray[data-state='running'] { border-color: color-mix(in srgb, var(--accent-ink) 45%, var(--card-border)); }
  .wt-hdr {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 7px 10px;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    text-align: left;
  }
  .wt-hdr:hover { color: var(--text-primary); }
  .wt-chev { color: var(--text-ghost); width: 10px; flex-shrink: 0; }
  .wt-icon { color: var(--accent-ink); flex-shrink: 0; }
  .wt-title { flex-shrink: 0; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; }
  .wt-latest {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 10px;
  }
  .wt-dot {
    margin-left: auto;
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: wt-pulse 1.4s ease-in-out infinite;
  }
  @keyframes wt-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
  .wt-body {
    padding: 4px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--card-border);
  }
  .wt-agent-meta { display: flex; justify-content: flex-end; }
  .wt-agent-elapsed { font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
</style>
