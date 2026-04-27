<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { PUBLIC_PULSE_ENABLED } from '$env/static/public';

  interface Item {
    id: string; kind: string; severity: 'info' | 'warn' | 'error';
    summary: string; details: Record<string, unknown>; at: string;
  }

  const pulseEnabled = PUBLIC_PULSE_ENABLED === '1';
  let items = $state<Item[]>([]);
  let es: EventSource | null = null;

  onMount(async () => {
    if (!pulseEnabled) return;
    const initial = await fetch('/api/jkai/pulse?mode=list').then((r) => r.json()).catch(() => ({ events: [] }));
    items = initial.events;
    es = new EventSource('/api/jkai/pulse');
    es.onmessage = (ev) => {
      try {
        const obj = JSON.parse(ev.data) as Item;
        items = [obj, ...items.filter((i) => i.id !== obj.id)].slice(0, 50);
      } catch { /* ignore */ }
    };
  });
  onDestroy(() => { es?.close(); });

  function fmt(at: string): string {
    const d = new Date(at).getTime();
    const ms = Date.now() - d;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3600_000)}h ago`;
  }
</script>

{#if pulseEnabled}
  <aside class="pulse-feed nm-sec">
    <h3>Background activity</h3>
    {#if items.length === 0}
      <p class="empty">Nothing yet — the orchestrator will surface health checks, audit summaries, and memory suggestions here.</p>
    {/if}
    <ul>
      {#each items as item (item.id)}
        <li class="sev-{item.severity}">
          <header>
            <strong>{item.kind}</strong>
            <span class="rel">{fmt(item.at)}</span>
          </header>
          <p>{item.summary}</p>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  .pulse-feed { padding: 0.6rem 0.8rem; max-height: 50vh; overflow: auto; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  li { padding: 0.4rem 0.5rem; border-radius: 8px; background: rgba(255,255,255,0.04); }
  li header { display: flex; justify-content: space-between; font-size: 0.75rem; }
  li p { margin: 0.2rem 0 0; font-size: 0.82rem; }
  .sev-warn { border-left: 3px solid var(--warning, #d99a3a); }
  .sev-error { border-left: 3px solid var(--danger, #d24b4b); }
  .rel { opacity: 0.55; }
  .empty { opacity: 0.55; font-size: 0.78rem; }
</style>
