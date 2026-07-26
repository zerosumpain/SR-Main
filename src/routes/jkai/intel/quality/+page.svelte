<script lang="ts">
  // Source-data quality — the page that fixes the graph rather than reading it.
  //
  // Three problems, in the order they matter:
  //   1. Duplicate entities. The graph splits one thing across two nodes, which
  //      corrupts every degree, path and centrality figure downstream.
  //   2. A fragmented taxonomy. Types with one or two members make type filters
  //      useless and act as magnets for anything the extractor was unsure about.
  //   3. Structural health — how much of the graph actually joins up.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import type { DuplicateRow } from '$lib/components/intel/types';
  import { onMount } from 'svelte';

  let duplicates = $state<DuplicateRow[]>([]);
  let total = $state(0);
  let autoMergeable = $state(0);
  let threshold = $state(0.85);
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let sweeping = $state(false);
  let message = $state<string | null>(null);
  let minConfidence = $state(0.5);
  /** Rows resolved this session, so they disappear without a full refetch. */
  let done = $state<Set<string>>(new Set());

  let types = $state<Array<{ id: string; name: string; icon: string; count: number }>>([]);
  let mergeFrom = $state('');
  let mergeInto = $state('');

  const key = (d: DuplicateRow) => `${d.keep.id}|${d.merge.id}`;
  const visible = $derived(duplicates.filter((d) => !done.has(key(d))));

  async function load() {
    loading = true;
    try {
      const [dupRes, netRes] = await Promise.all([
        fetch(`/api/jkai/intel/duplicates?min=${minConfidence}`),
        fetch('/api/jkai/intel/network?minDegree=0'),
      ]);
      if (dupRes.ok) {
        const body = await dupRes.json();
        duplicates = body.duplicates ?? [];
        total = body.total ?? 0;
        autoMergeable = body.autoMergeable ?? 0;
        threshold = body.threshold ?? 0.85;
      }
      if (netRes.ok) {
        const net = await netRes.json();
        const counts = new Map<string, number>();
        for (const n of net.nodes ?? []) counts.set(n.typeId, (counts.get(n.typeId) ?? 0) + 1);
        types = (net.types ?? [])
          .map((t: { id: string; name: string; icon: string }) => ({ ...t, count: counts.get(t.id) ?? 0 }))
          .sort((a: { count: number }, b: { count: number }) => a.count - b.count);
      }
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function notify(text: string) {
    message = text;
    setTimeout(() => (message = null), 4000);
  }

  async function merge(d: DuplicateRow, swap = false) {
    const k = key(d);
    if (busy) return;
    busy = k;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'merge',
          keepId: swap ? d.merge.id : d.keep.id,
          mergeId: swap ? d.keep.id : d.merge.id,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      done = new Set([...done, k]);
      notify(`Merged into "${swap ? d.merge.name : d.keep.name}"`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      busy = null;
    }
  }

  function dismiss(d: DuplicateRow) {
    done = new Set([...done, key(d)]);
  }

  async function sweep(dryRun: boolean) {
    if (sweeping) return;
    sweeping = true;
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'auto', threshold, dryRun }),
      });
      const body = await res.json();
      const r = body.result;
      notify(
        dryRun
          ? `Would merge ${r.merged} of ${r.candidates} candidates`
          : `Merged ${r.merged} entities (${r.skipped} skipped)`,
      );
      if (!dryRun) await load();
    } catch {
      notify('Sweep failed');
    } finally {
      sweeping = false;
    }
  }

  async function mergeTypes() {
    if (!mergeFrom || !mergeInto || mergeFrom === mergeInto) return;
    busy = 'types';
    try {
      const res = await fetch('/api/jkai/intel/duplicates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'merge-types', fromTypeId: mergeFrom, intoTypeId: mergeInto }),
      });
      const body = await res.json();
      notify(`Moved ${body.moved} entities`);
      mergeFrom = '';
      mergeInto = '';
      await load();
    } catch {
      notify('Type merge failed');
    } finally {
      busy = null;
    }
  }

  const tinyTypes = $derived(types.filter((t) => t.count <= 2));
</script>

<JkaiPageTitle title="INTEL / QUALITY" />

<div class="wrap">
  <p class="lede">
    Everything the graph tells you — importance, paths, clusters, surprising links — is only as good as
    whether one real thing is one node. These are the places it isn't.
  </p>

  <section class="panel">
    <header>
      <h2>Duplicate entities</h2>
      <div class="tools">
        <label>
          Min confidence
          <select bind:value={minConfidence} onchange={load}>
            <option value={0.35}>35%</option>
            <option value={0.5}>50%</option>
            <option value={0.7}>70%</option>
            <option value={0.85}>85%</option>
          </select>
        </label>
        <button type="button" onclick={() => sweep(true)} disabled={sweeping}>Preview auto-merge</button>
        <button type="button" class="primary" onclick={() => sweep(false)} disabled={sweeping || !autoMergeable}>
          {sweeping ? 'Working…' : `Merge ${autoMergeable} confident`}
        </button>
      </div>
    </header>

    {#if loading}
      <p class="muted">Comparing every entity against every other…</p>
    {:else if !visible.length}
      <p class="muted">No duplicates at this confidence. The graph is clean.</p>
    {:else}
      <p class="muted">
        {visible.length} shown of {total}. Above {Math.round(threshold * 100)}% confidence a merge is safe to
        apply without reading it; below that, judgement is needed.
      </p>

      <ul class="dups">
        {#each visible as d (key(d))}
          <li class="dup" class:auto={d.autoMergeable}>
            <div class="pair">
              <div class="side keep">
                <span class="tag">keep</span>
                <strong>{d.keep.name}</strong>
                <span class="meta">{d.keep.type} · {d.keep.degree} links · {d.keep.noteCount} sources</span>
              </div>
              <span class="fuse">←</span>
              <div class="side">
                <span class="tag drop">merge</span>
                <strong>{d.merge.name}</strong>
                <span class="meta">{d.merge.type} · {d.merge.degree} links · {d.merge.noteCount} sources</span>
              </div>
            </div>

            <p class="why">
              <span class="conf" class:high={d.autoMergeable}>{Math.round(d.confidence * 100)}%</span>
              {d.reason}
            </p>

            <div class="acts">
              <button type="button" class="primary" disabled={busy === key(d)} onclick={() => merge(d)}>
                {busy === key(d) ? 'Merging…' : 'Merge'}
              </button>
              <button type="button" disabled={busy === key(d)} onclick={() => merge(d, true)}>
                Merge the other way
              </button>
              <button type="button" class="ghost" onclick={() => dismiss(d)}>Not a duplicate</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="panel">
    <header><h2>Entity types</h2></header>
    <p class="muted">
      Types holding one or two entities fragment the taxonomy and make type filters useless. Fold them into a
      broader type.
    </p>

    {#if tinyTypes.length}
      <div class="chips">
        {#each tinyTypes as t (t.id)}
          <span class="chip">{t.icon} {t.name} <b>{t.count}</b></span>
        {/each}
      </div>
    {:else}
      <p class="muted">Every type is carrying its weight.</p>
    {/if}

    <div class="type-merge">
      <select bind:value={mergeFrom} aria-label="Type to retire">
        <option value="">Move everything from…</option>
        {#each types as t (t.id)}<option value={t.id}>{t.icon} {t.name} ({t.count})</option>{/each}
      </select>
      <span>→</span>
      <select bind:value={mergeInto} aria-label="Type to keep">
        <option value="">…into</option>
        {#each types as t (t.id)}<option value={t.id}>{t.icon} {t.name} ({t.count})</option>{/each}
      </select>
      <button
        type="button"
        class="primary"
        disabled={!mergeFrom || !mergeInto || mergeFrom === mergeInto || busy === 'types'}
        onclick={mergeTypes}
      >Merge types</button>
    </div>
  </section>
</div>

{#if message}
  <div class="toast">{message}</div>
{/if}

<style>
  .wrap {
    padding: 20px;
    max-width: 1100px;
    margin: 0 auto;
  }
  .lede {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 18px;
    max-width: 68ch;
  }

  .panel {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 16px;
    margin-bottom: 16px;
  }
  .panel > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--accent-ink);
    font-weight: 500;
  }
  .muted {
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 12px;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tools label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    color: var(--text-ghost);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  select {
    padding: 5px 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
  }
  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    color: #fff;
  }
  button.ghost {
    border-color: transparent;
    color: var(--text-ghost);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .dups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dup {
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 11px 13px;
  }
  .dup.auto {
    border-left-color: var(--accent);
  }

  .pair {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 180px;
    flex: 1;
  }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--success);
  }
  .tag.drop {
    color: var(--text-ghost);
  }
  .side strong {
    font-size: var(--fs-body-sm);
    font-weight: 600;
    word-break: break-word;
  }
  .side.keep strong {
    color: var(--text-primary);
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .fuse {
    color: var(--accent);
    font-size: 18px;
  }

  .why {
    margin: 9px 0 9px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .conf {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 1px 6px;
    border-radius: var(--radius-sharp);
    background: var(--divider);
    color: var(--text-muted);
    margin-right: 6px;
  }
  .conf.high {
    background: var(--accent-tint-14);
    color: var(--accent);
  }

  .acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 12px;
  }
  .chip {
    font-size: var(--fs-label-xs);
    padding: 3px 9px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
  }
  .chip b {
    color: var(--warn);
  }

  .type-merge {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid var(--divider);
  }
  .type-merge span {
    color: var(--text-ghost);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
  }
</style>
