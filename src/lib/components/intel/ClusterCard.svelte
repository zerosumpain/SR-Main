<script lang="ts">
  // One cluster, described.
  //
  // A cluster used to be three fields — an index, a size and the name of its most
  // central member — which is enough to colour a dot and nothing else. It could
  // not say what it held, where the material came from, when it was active, what
  // joined it this week, or what holds it to the rest of the graph. This is where
  // that lives.
  //
  // Fully controlled: it owns only whether the rename box is open and what has
  // been typed into it. Everything else is a prop or a callback, matching
  // SourcePicker and ClusterPicker.

  import { clusterColour, clusterSlotOf } from './graph-visual';
  import type { ClusterView } from './cluster-types';

  let {
    cluster,
    busy = false,
    onRename,
    onNarrate,
    onOpen,
  }: {
    cluster: ClusterView;
    /** A narrative is being generated for this cluster. */
    busy?: boolean;
    onRename: (key: string, name: string | null) => void;
    onNarrate: (key: string) => void;
    onOpen?: (key: string) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state('');

  const colour = $derived(
    clusterColour(clusterSlotOf({ clusterColourIndex: cluster.colourIndex })),
  );

  function startEdit() {
    draft = cluster.name ?? cluster.autoLabel;
    editing = true;
  }

  function commit() {
    const trimmed = draft.trim();
    editing = false;
    // An empty box clears back to the generated label rather than setting an
    // empty name — "no name" and "a name that is blank" would look identical
    // and only one of them is recoverable.
    onRename(cluster.key, trimmed.length ? trimmed : null);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editing = false;
    }
  }

  /** Source mix as bar segments. Ordered as the composition ordered them. */
  const mix = $derived(
    (() => {
      const total = cluster.composition.sources.reduce((sum, [, n]) => sum + n, 0);
      if (!total) return [];
      return cluster.composition.sources.map(([name, n]) => ({
        name,
        n,
        pct: (n / total) * 100,
      }));
    })(),
  );

  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  const shortDate = (iso: string) => dateFmt.format(new Date(iso));
</script>

<div class="card" style="--cl: {colour}">
  <div class="name-row">
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-input"
        bind:value={draft}
        onkeydown={onKey}
        onblur={commit}
        autofocus
        maxlength="120"
        aria-label="Cluster name"
      />
    {:else}
      <button type="button" class="name" onclick={startEdit} title="Rename this cluster">
        {cluster.label}
      </button>
      {#if cluster.name}
        <button
          type="button"
          class="act"
          title="Clear the name and go back to the generated one"
          onclick={() => onRename(cluster.key, null)}>reset name</button
        >
      {/if}
    {/if}
  </div>

  {#if cluster.name && cluster.autoLabel !== cluster.name}
    <p class="auto">Generated label: {cluster.autoLabel}</p>
  {/if}

  {#if cluster.nameDrifted}
    <!-- Chained matching keeps a cluster's key through changes that are each
         reasonable and cumulatively are not. Saying so is the alternative to
         silently letting a name describe something it no longer describes. -->
    <p class="drift">
      This has changed a lot since you named it — only
      {Math.round((1 - (cluster.nameDrift ?? 0)) * 100)}% of what you named is still here.
    </p>
  {/if}

  <dl class="facts">
    <div>
      <dt>Entities</dt>
      <dd>{cluster.size}</dd>
    </div>
    <div>
      <dt>Evidence</dt>
      <dd>{cluster.composition.noteTotal} notes</dd>
    </div>
    <div>
      <dt>Diversity</dt>
      <dd title="How evenly the evidence is spread across kinds of source">
        {cluster.composition.diversity.toFixed(2)}
      </dd>
    </div>
    {#if cluster.span}
      <div>
        <dt>Span</dt>
        <dd>{shortDate(cluster.span.from)} – {shortDate(cluster.span.to)}</dd>
      </div>
    {/if}
  </dl>

  {#if mix.length}
    <div class="mix" role="img" aria-label={`Sources: ${mix.map((m) => `${m.name} ${m.n}`).join(', ')}`}>
      {#each mix as m (m.name)}
        <span class="seg" data-src={m.name} style="width: {m.pct}%" title="{m.name}: {m.n}"></span>
      {/each}
    </div>
    <p class="mix-key">
      {#each mix as m (m.name)}
        <span class="k"><i data-src={m.name}></i>{m.name} {m.n}</span>
      {/each}
      {#if cluster.composition.sourceless}
        <span class="k warn">{cluster.composition.sourceless} with no evidence</span>
      {/if}
    </p>
  {/if}

  {#if cluster.delta && (cluster.delta.joinedCount || cluster.delta.leftCount)}
    <p class="delta">
      {#if cluster.delta.joinedCount}<b>+{cluster.delta.joinedCount}</b> joined{/if}{#if cluster.delta.joinedCount && cluster.delta.leftCount},
      {/if}{#if cluster.delta.leftCount}<b>−{cluster.delta.leftCount}</b> left{/if}
      at the last recalculation.
    </p>
  {/if}

  {#if cluster.members.length}
    <p class="members">
      {#each cluster.members as m, i (m.id)}<a href="/jkai/intel/entities/{m.id}" class="m"
          >{m.name}</a
        >{#if i < cluster.members.length - 1}<span class="sep"> · </span>{/if}{/each}
    </p>
  {/if}

  {#if cluster.bridges.length}
    <p class="bridges">
      <span class="lbl">Holds to</span>
      {#each cluster.bridges as b, i (b.id)}<span class="b"
          >{b.name}<sup>{b.reaches.length}</sup></span
        >{#if i < cluster.bridges.length - 1}<span class="sep"> · </span>{/if}{/each}
    </p>
  {/if}

  <div class="narrative">
    {#if cluster.narrative}
      <div class="prose">{cluster.narrative}</div>
      <div class="n-actions">
        {#if cluster.narrativeStale}
          <span class="stale">The cluster has changed since this was written.</span>
        {/if}
        <button type="button" class="act" disabled={busy} onclick={() => onNarrate(cluster.key)}>
          {busy ? 'writing…' : 'rewrite'}
        </button>
        {#if onOpen}
          <button type="button" class="act" onclick={() => onOpen?.(cluster.key)}>open</button>
        {/if}
      </div>
    {:else}
      <div class="n-actions">
        <button type="button" class="act primary" disabled={busy} onclick={() => onNarrate(cluster.key)}>
          {busy ? 'writing…' : 'describe this cluster'}
        </button>
        {#if onOpen}
          <button type="button" class="act" onclick={() => onOpen?.(cluster.key)}>open</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px 9px 10px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--cl);
    border-radius: var(--radius-sharp);
    background: var(--accent-tint-08);
  }

  .name-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .name {
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 600;
    text-align: left;
    color: var(--text-primary);
    cursor: text;
  }
  .name:hover {
    color: var(--accent);
  }
  .name-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    background: var(--surface-elevated);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    color: var(--text-primary);
  }

  .auto {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .drift {
    margin: 0;
    padding: 5px 7px;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sharp);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 0;
  }
  .facts div {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .facts dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .facts dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }

  /* The source mix, as one bar. Which channels a cluster rests on is the
     difference between a subject and a feed, and a bar says it at a glance
     where four counts do not. */
  .mix {
    display: flex;
    height: 6px;
    overflow: hidden;
    border-radius: var(--radius-sharp);
    background: var(--line);
  }
  .seg {
    height: 100%;
  }
  .mix-key {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 10px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .k {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .k.warn {
    color: var(--warn);
  }
  .k i {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-round);
  }

  /* One colour per source kind, from the token palette — never new hex. */
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

  .delta {
    margin: 0;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .delta b {
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .members,
  .bridges {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .m {
    color: var(--text-secondary);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-35);
  }
  .m:hover {
    color: var(--accent);
  }
  .sep {
    color: var(--text-ghost);
  }
  .bridges .lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin-right: 5px;
  }
  .b sup {
    margin-left: 1px;
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .narrative {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .prose {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
    white-space: pre-wrap;
    /* The rail is narrow and a narrative is several hundred words. The card
       shows the opening and `open` gives it the room it needs. */
    max-height: 12.5em;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 70%, transparent);
  }
  .n-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .stale {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-label-xs);
    color: var(--warn);
  }

  .act {
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    cursor: pointer;
  }
  .act:disabled {
    color: var(--text-ghost);
    cursor: default;
  }
  .act.primary {
    padding: 4px 9px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
  }
  .act.primary:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
</style>
