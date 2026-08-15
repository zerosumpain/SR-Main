<script lang="ts">
  import { app } from '../lib/appState.svelte';

  const target = $derived(app.suggestTarget);
  let items = $state<{ title: string; statement: string }[]>([]);
  let loading = $state(false);
  let err = $state('');
  let added = $state<Set<string>>(new Set());
  let loadedKey = ''; // plain guard (non-reactive) so the effect doesn't loop

  $effect(() => {
    const t = app.suggestTarget;
    const key = t ? `${t.kind}:${t.id}` : '';
    if (t && key !== loadedKey) {
      loadedKey = key;
      void load(t);
    }
    if (!t) loadedKey = '';
  });

  async function load(t: { kind: string; id: string; label: string }) {
    loading = true; err = ''; items = []; added = new Set();
    try {
      const res = await fetch('/projects/dfe-data-strategy/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let result: any = null;
      let errMsg: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const o = JSON.parse(line.slice(6));
            if (o.type === 'result') result = o.data;
            else if (o.type === 'error') errMsg = o.message;
          } catch { /* heartbeat */ }
        }
      }
      if (result?.policies?.length) items = result.policies;
      else err = errMsg ?? 'No suggestions came back — try again.';
    } catch (e: any) {
      err = e?.message ?? 'request failed';
    } finally {
      loading = false;
    }
  }

  function add(p: { title: string; statement: string }) {
    app.addPolicyDraft(p.title, p.statement);
    added = new Set(added).add(p.statement);
  }
</script>

{#if target}
  <button class="scrim" aria-label="Close" onclick={() => app.closeSuggest()}></button>
  <aside class="panel" role="dialog" aria-label="Draft policies">
    <header class="ph">
      <div>
        <span class="ph-kick">Draft policies for</span>
        <h3 class="ph-title">{target.label}</h3>
      </div>
      <button class="ph-x" onclick={() => app.closeSuggest()} aria-label="Close">✕</button>
    </header>

    <div class="pb-body">
      {#if loading}
        <p class="status">Drafting candidate policies grounded in the strategy material…</p>
      {:else if err}
        <p class="err">⚠ {err}</p>
        <button class="retry" onclick={() => target && load(target)}>Try again</button>
      {:else if items.length}
        <p class="hint">Candidate policies you could include. Add the ones worth testing — the Policy Builder will appraise each.</p>
        {#each items as p}
          {@const isAdded = added.has(p.statement)}
          <div class="item" class:added={isAdded}>
            <div class="i-text">
              <span class="i-title">{p.title}</span>
              <span class="i-stmt">{p.statement}</span>
            </div>
            <button class="i-add" disabled={isAdded} onclick={() => add(p)}>{isAdded ? '✓ Added' : '＋ Add'}</button>
          </div>
        {/each}
      {/if}
    </div>

    <footer class="pf">
      <span class="pf-count">{app.policies.length} polic{app.policies.length === 1 ? 'y' : 'ies'} queued</span>
      <a class="pf-go" href="/projects/dfe-data-strategy/policy-builder" onclick={() => app.closeSuggest()}>Open Policy Builder →</a>
    </footer>
  </aside>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 80; background: rgba(28,22,17,0.32); border: none; cursor: pointer; }
  .panel { position: fixed; z-index: 81; top: 0; right: 0; height: 100vh; width: min(440px, 94vw); background: var(--paper);
    border-left: 1px solid rgba(28,22,17,0.18); display: flex; flex-direction: column; }
  .ph { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 16px 12px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .ph-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .ph-title { margin: 3px 0 0; font-family: var(--fs-serif); font-size: 17px; font-weight: 600; color: var(--ink); line-height: 1.2; }
  .ph-x { background: none; border: none; font-size: var(--fs-body-sm); color: rgba(28,22,17,0.5); cursor: pointer; }
  .pb-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; }
  .status, .hint { margin: 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.62); }
  .err { margin: 0; font-size: var(--fs-label); color: var(--error); }
  .retry { align-self: flex-start; font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 10px; border: 1px solid rgba(28,22,17,0.25); background: rgba(255,255,255,0.6); border-radius: var(--radius-sharp); cursor: pointer; }
  .item { display: flex; align-items: flex-start; gap: 10px; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.5); padding: 10px 12px; }
  .item.added { border-color: var(--success-border); background: var(--success-bg); }
  .i-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .i-title { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); }
  .i-stmt { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.72); }
  .i-add { flex-shrink: 0; align-self: center; font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 6px 10px; border-radius: var(--radius-sharp); cursor: pointer; border: 1px solid var(--accent-ink); background: var(--accent-ink); color: #fff; }
  .i-add:disabled { background: transparent; color: var(--success); border-color: var(--success-border); cursor: default; }
  .pf { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-top: 1px solid rgba(28,22,17,0.12); background: rgba(241,234,214,0.7); }
  .pf-count { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); }
  .pf-go { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--paper); background: var(--ink); padding: 8px 14px; border-radius: var(--radius-sharp); text-decoration: none; }
</style>
