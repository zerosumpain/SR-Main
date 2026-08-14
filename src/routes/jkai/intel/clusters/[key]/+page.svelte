<script lang="ts">
  // One cluster, with the room the rail cannot give it.
  //
  // The rail card shows six members and the opening of the narrative. This is
  // where the whole membership, the whole narrative, the evidence over time and
  // the merge/split history live.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import { clusterColour } from '$lib/components/intel/graph-visual';
  import { Marked } from 'marked';
  import { sanitizePreviewHtml } from '$lib/security/sanitize-chat';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Derived from the prop, never copied into $state. Copying captures the value
  // at first render, so `invalidateAll()` would refresh the server data and this
  // page would keep showing the old — the state_referenced_locally warning is
  // pointing at a real bug, not a style preference.
  const cluster = $derived(data.cluster);
  let narrating = $state(false);
  let editing = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);

  const colour = $derived(clusterColour(cluster.colourIndex));
  const sourceTotal = $derived(
    cluster.composition.sources.reduce((sum, [, n]) => sum + n, 0),
  );

  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const fmt = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—');

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/jkai/intel/clusters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`the request came back ${res.status}`);
    return res.json();
  }

  async function rename(name: string | null) {
    editing = false;
    error = null;
    try {
      await post({ action: 'rename', key: cluster.key, name });
      // Reloaded rather than patched: renaming also resets the drift baseline,
      // and the server owns that.
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : 'the rename failed';
    }
  }

  async function narrate() {
    if (narrating) return;
    narrating = true;
    error = null;
    try {
      await post({ action: 'narrate', key: cluster.key, force: true });
      // The narrative is persisted server-side, so the load is the shortest path
      // to a consistent page — and it also clears `narrativeStale` honestly
      // rather than by assertion.
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : 'the narrative failed';
    } finally {
      narrating = false;
    }
  }

  const maxMonth = $derived(Math.max(1, ...data.histogram.map((h) => h.count)));

  // The narrative is markdown with headings — the same shape a brief is — so it
  // is rendered rather than printed. Sanitised through the shared helper for the
  // same reason chat is: the text is model output, and model output reaches this
  // page without a human in between.
  const marked = new Marked({ gfm: true, breaks: false });
  const narrativeHtml = $derived(
    cluster.narrative ? sanitizePreviewHtml(marked.parse(cluster.narrative) as string) : '',
  );
</script>

<JkaiPageTitle title="CLUSTER" titleHref="/jkai/intel/clusters" />

<div class="wrap">
  <header class="page-hdr" style="--cl: {colour}">
    <p class="kicker"><span class="dot" aria-hidden="true"></span>Cluster</p>
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-input"
        bind:value={draft}
        autofocus
        maxlength="120"
        aria-label="Cluster name"
        onkeydown={(e) => {
          if (e.key === 'Enter') rename(draft.trim() || null);
          if (e.key === 'Escape') editing = false;
        }}
        onblur={() => rename(draft.trim() || null)}
      />
    {:else}
      <h1>
        <button
          type="button"
          class="name"
          onclick={() => {
            draft = cluster.name ?? cluster.autoLabel;
            editing = true;
          }}>{cluster.label}</button
        >
      </h1>
    {/if}
    <p class="sub">
      {cluster.size} entities · {cluster.composition.noteTotal} note links · first seen
      {fmt(cluster.firstSeenAt)}
      {#if cluster.name}<br />Generated label: {cluster.autoLabel}{/if}
    </p>
    <div class="hdr-actions">
      <button type="button" class="nm-save-btn" disabled={narrating} onclick={narrate}>
        {narrating ? 'Writing…' : cluster.narrative ? 'Rewrite narrative' : 'Describe this cluster'}
      </button>
      {#if cluster.name}
        <button type="button" class="row-link" onclick={() => rename(null)}>reset name</button>
      {/if}
      <a class="back-link" href="/jkai/intel/clusters">← All clusters</a>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    {#if cluster.nameDrifted}
      <p class="drift">
        Only {Math.round((1 - (cluster.nameDrift ?? 0)) * 100)}% of what you named on
        {fmt(cluster.namedAt)} is still in this cluster. Clusters keep their identity through changes
        that are each reasonable, and a run of them adds up — worth checking the name still fits.
      </p>
    {/if}
  </header>

  {#if cluster.narrative}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <h2 class="sr-label-tight">What this holds</h2>
        {#if cluster.narrativeStale}
          <span class="stale">The cluster has changed since this was written</span>
        {:else if cluster.narrativeAt}
          <span class="when">written {fmt(cluster.narrativeAt)}</span>
        {/if}
      </div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="prose">{@html narrativeHtml}</div>
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd"><h2 class="sr-label-tight">Where the evidence comes from</h2></div>
    <div class="bar">
      {#each cluster.composition.sources as [name, n] (name)}
        <span data-src={name} style="width: {(n / sourceTotal) * 100}%" title="{name}: {n}"></span>
      {/each}
    </div>
    <p class="key">
      {#each cluster.composition.sources as [name, n] (name)}
        <span class="k"><i data-src={name}></i>{name} {n}</span>
      {/each}
      {#if cluster.composition.sourceless}
        <span class="k warn">{cluster.composition.sourceless} with no evidence at all</span>
      {/if}
    </p>
    <p class="note">
      Diversity {cluster.composition.diversity.toFixed(2)}.
      {#if cluster.composition.diversity < 0.1}
        Everything here arrived through one channel — this is a feed, not material gathered
        deliberately.
      {:else}
        Corroborated across {cluster.composition.sources.length} kinds of source, which is what
        separates material you engage with from a feed.
      {/if}
      {#if cluster.span}
        Observed {fmt(cluster.span.from)} – {fmt(cluster.span.to)}.
      {/if}
    </p>

    {#if data.histogram.length > 1}
      <div class="hist" role="img" aria-label="Evidence per month">
        {#each data.histogram as h (h.month)}
          <span class="col" title="{h.month}: {h.count}">
            <i style="height: {(h.count / maxMonth) * 100}%"></i>
          </span>
        {/each}
      </div>
      <p class="note small">
        {data.histogram[0].month} → {data.histogram[data.histogram.length - 1].month}, by when the
        evidence was observed rather than when it was ingested.
      </p>
    {/if}
  </section>

  {#if cluster.bridges.length || data.neighbours.length}
    <section class="nm-sec">
      <div class="nm-sec-hd"><h2 class="sr-label-tight">What holds it to the rest</h2></div>
      {#if cluster.bridges.length}
        <p class="note">
          {#each cluster.bridges as b, i (b.id)}<a href="/jkai/intel/entities/{b.id}"
              >{b.name}</a
            ><sup>{b.reaches.length}</sup>{#if i < cluster.bridges.length - 1}<span> · </span
            >{/if}{/each}
          — the superscript is how many other clusters each one reaches.
        </p>
      {/if}
      {#if data.neighbours.length}
        <div class="nbrs">
          {#each data.neighbours.slice(0, 12) as n (n.key)}
            <a class="nbr" href="/jkai/intel/clusters/{n.key}" style="--cl: {clusterColour(n.colourIndex)}">
              <span class="dot" aria-hidden="true"></span>{n.label}<span class="c">{n.count}</span>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if cluster.delta && (cluster.delta.joinedCount || cluster.delta.leftCount)}
    <section class="nm-sec">
      <div class="nm-sec-hd"><h2 class="sr-label-tight">What changed</h2></div>
      <p class="note">
        At the last recalculation
        {#if cluster.delta.joinedCount}<b>{cluster.delta.joinedCount}</b> joined{/if}{#if cluster.delta.joinedCount && cluster.delta.leftCount}
          and
        {/if}{#if cluster.delta.leftCount}<b>{cluster.delta.leftCount}</b> left{/if}.
      </p>
    </section>
  {/if}

  {#if cluster.mergedFrom.length || cluster.splitFrom}
    <section class="nm-sec">
      <div class="nm-sec-hd"><h2 class="sr-label-tight">History</h2></div>
      <p class="note">
        {#if cluster.splitFrom}This cluster broke away from
          <a href="/jkai/intel/clusters/{cluster.splitFrom}">another</a>.{/if}
        {#if cluster.mergedFrom.length}It has absorbed {cluster.mergedFrom.length} other cluster{cluster
            .mergedFrom.length === 1
            ? ''
            : 's'} — two areas that were separate became one.{/if}
      </p>
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <h2 class="sr-label-tight">Members</h2>
      <span class="when">{data.memberTotal} in total</span>
    </div>
    <div class="tbl-wrap">
      <table>
        <colgroup>
          <col style="width: 44%" /><col style="width: 18%" /><col style="width: 12%" /><col
            style="width: 12%"
          /><col style="width: 14%" />
        </colgroup>
        <thead>
          <tr><th>Entity</th><th>Type</th><th>Links</th><th>Notes</th><th>Relevance</th></tr>
        </thead>
        <tbody>
          {#each data.members as m (m.id)}
            <tr>
              <td><a href="/jkai/intel/entities/{m.id}">{m.name}</a></td>
              <td class="mono">{m.type}</td>
              <td class="mono">{m.degree}</td>
              <td class="mono">{m.noteCount}</td>
              <td class="mono">{m.relevance.toFixed(2)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if data.memberTotal > data.members.length}
      <p class="note small">
        Showing the {data.members.length} most connected of {data.memberTotal}.
      </p>
    {/if}
  </section>
</div>

<style>
  .wrap {
    max-width: 1000px;
    margin: 0 auto;
    padding: 24px 20px 64px;
  }

  .page-hdr {
    padding-bottom: 16px;
    border-bottom: 2px solid var(--text-primary);
    margin-bottom: 22px;
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-round);
    background: var(--cl);
  }
  h1 {
    margin: 0 0 8px;
  }
  .name {
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font-display);
    font-size: clamp(1.7rem, 4vw, 2.4rem);
    line-height: 1.05;
    text-align: left;
    color: var(--text-primary);
    cursor: text;
  }
  .name:hover {
    color: var(--accent);
  }
  .name-input {
    width: 100%;
    padding: 6px 9px;
    margin-bottom: 8px;
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 3vw, 2rem);
    background: var(--surface-elevated);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    color: var(--text-primary);
  }
  .sub {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .hdr-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-top: 12px;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--accent);
  }
  .err {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    color: var(--error);
  }
  .drift {
    margin: 12px 0 0;
    padding: 8px 10px;
    max-width: 72ch;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sharp);
  }

  .nm-sec {
    margin-bottom: 26px;
  }
  .nm-sec-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--divider);
  }
  .sr-label-tight {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .when,
  .stale {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .stale {
    color: var(--warn);
  }
  .row-link,
  .nm-save-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .row-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
  }
  .nm-save-btn {
    padding: 7px 16px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    color: var(--bg);
  }
  .nm-save-btn:disabled {
    background: none;
    color: var(--text-ghost);
    border-color: var(--card-border);
    cursor: default;
  }

  .prose {
    max-width: 78ch;
    font-size: var(--fs-body-sm);
    line-height: 1.65;
    color: var(--text-secondary);
  }
  .prose :global(h2) {
    margin: 20px 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .prose :global(h2:first-child) {
    margin-top: 0;
  }
  .prose :global(p) {
    margin: 0 0 12px;
  }
  .prose :global(ul) {
    margin: 0 0 12px;
    padding-left: 18px;
  }
  .prose :global(li) {
    margin-bottom: 5px;
  }
  .prose :global(strong) {
    color: var(--text-primary);
  }
  .prose :global(a) {
    color: var(--accent);
  }

  .bar {
    display: flex;
    height: 9px;
    overflow: hidden;
    border-radius: var(--radius-sharp);
    background: var(--divider);
  }
  .bar span {
    height: 100%;
  }
  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .k {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .k.warn {
    color: var(--warn);
  }
  .k i {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-round);
  }
  [data-src='email'] {
    background: var(--accent);
  }
  [data-src='chat'] {
    background: var(--accent-ink);
  }
  [data-src='file'] {
    background: var(--success);
  }
  [data-src='research'] {
    background: var(--warn);
  }
  [data-src='web'] {
    background: var(--text-muted);
  }
  [data-src='whatsapp'] {
    background: var(--accent-hover);
  }
  [data-src='workflow'] {
    background: var(--text-ghost);
  }

  .hist {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 58px;
    margin-top: 14px;
  }
  .col {
    flex: 1;
    display: flex;
    align-items: flex-end;
    height: 100%;
    min-width: 4px;
  }
  .col i {
    width: 100%;
    background: var(--accent-ink);
    border-radius: var(--radius-sharp) var(--radius-sharp) 0 0;
  }

  .note {
    margin: 8px 0 0;
    max-width: 76ch;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .note.small {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .note a {
    color: var(--accent);
  }
  .note sup {
    color: var(--accent);
    font-family: var(--font-mono);
  }
  .note b {
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .nbrs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .nbr {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    font-size: var(--fs-label-xs);
    text-decoration: none;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--cl);
    border-radius: var(--radius-sharp);
  }
  .nbr:hover {
    background: var(--accent-tint-08);
    color: var(--text-primary);
  }
  .nbr .c {
    font-family: var(--font-mono);
    color: var(--text-ghost);
  }

  .tbl-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 520px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: 6px 8px;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    border-bottom: 1px solid var(--divider);
  }
  td {
    padding: 6px 8px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    border-bottom: 1px solid var(--divider);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  td a {
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-35);
  }
  td a:hover {
    color: var(--accent);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
