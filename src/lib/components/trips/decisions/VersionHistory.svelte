<script lang="ts">
  // Earlier versions of the plan, newest first, each with what changed, and
  // Restore on any the server can bring back (it keeps a snapshot of the
  // trip's facts with every version from v8 on; older ones cannot be
  // restored and say so). Restoring never rewrites history: it makes a new
  // version that matches the old one, and What changed shows the difference.
  import { untrack } from 'svelte';
  import { api } from '$lib/trips/decisions-client';
  import { versionRows, VERSION_SOURCE, type VersionRow } from '$lib/trips/decisions-view';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';

  let {
    versions,
    current,
    desk,
  }: {
    /** The page's own list (no restorable flag), shown until the server's arrives. */
    versions: Array<{ version: number; source: string; createdAt: string; changes: string[] }>;
    current: number | null;
    desk: DecisionDesk;
  } = $props();

  // The server's list, for the version it was fetched at (a restore makes a new one: fetch again).
  let fetched = $state<{ at: number | null; rows: VersionRow[] } | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let open = $state(false);
  const rows = $derived(fetched && fetched.at === current ? fetched.rows : versionRows(versions));
  const earlier = $derived(rows.filter((r) => r.version !== current));

  async function load() {
    if ((fetched && fetched.at === current) || loading) return;
    const at = current;
    loading = true;
    failed = false;
    const r = await api('GET', `${desk.base}/versions`);
    loading = false;
    if (r.ok) fetched = { at, rows: versionRows(r.body) };
    else failed = true;
  }
  $effect(() => {
    // Fetch on open, and again after a restore while open. Tracked: open and
    // the current version only — load() reads and writes its own state untracked.
    const o = open;
    void current;
    if (o) untrack(() => void load());
  });
  const timeOf = (iso: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
</script>

{#if earlier.length}
  <details class="vh-list" ontoggle={(e) => (open = e.currentTarget.open)}>
    <summary>Earlier versions ({earlier.length})</summary>
    {#if loading}<p class="dx-note" role="status">Checking which can be restored…</p>{/if}
    {#if failed}<p class="dx-note">Could not check which versions can be restored just now.</p>{/if}
    <ol class="vh-rows" role="list">
      {#each earlier as v (v.version)}
        <li class="vh-row">
          <details class="vh-one">
            <summary>
              <span class="vh-v">v{v.version}</span>
              <span class="vh-meta">{VERSION_SOURCE[v.source] ?? v.source}{v.createdAt ? ` · ${timeOf(v.createdAt)}` : ''} · {v.lines.length} change{v.lines.length === 1 ? '' : 's'}</span>
            </summary>
            {#if v.lines.length}<ul class="vh-lines">{#each v.lines as l, li (li)}<li>{l}</li>{/each}</ul>{/if}
          </details>
          {#if v.restorable === true}
            <button class="dx-link" type="button" disabled={!!desk.busy} onclick={() => desk.undo(v.version, `Restored version ${v.version}`)}>Restore</button>
          {:else if v.restorable === false}
            <span class="vh-no">cannot be restored</span>
          {/if}
        </li>
      {/each}
    </ol>
    {#if desk.problem?.where === 'undo'}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
  </details>
{/if}

<style>
  .vh-list {
    margin-top: 12px;
  }
  .vh-list > summary,
  .vh-one > summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .vh-rows {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .vh-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    padding: 4px 0 4px 14px;
    border-top: 1px dashed var(--line-strong);
  }
  .vh-one {
    min-width: 0;
  }
  .vh-v {
    font-weight: 600;
    color: var(--np-ink);
  }
  .vh-meta {
    color: var(--np-ink-soft);
  }
  .vh-lines {
    margin: 4px 0;
    padding-left: 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .vh-lines li::marker {
    color: var(--accent);
  }
  .vh-no {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
