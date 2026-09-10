<script lang="ts">
  // THE NETWORK — what the policy graph actually says, and what it leaves out.
  //
  // Ask 6: better insight from entity recognition and clearer relationship
  // types. The old view was the raw edge list with a dropdown — "A →
  // has_authority_over → B", four hundred times — which is the data rather than
  // a reading of it.
  //
  // Two changes. Twenty-six relation types fold into seven FAMILIES, because a
  // reader arrives asking six or seven questions of a policy graph and not
  // twenty-six. And the six structural INSIGHTS lead, because they are the only
  // thing here a reader cannot get by scrolling: every one is a missing
  // counterpart — authority nobody answers for, cost with no benefit, a body
  // measured on data it supplies itself — computed from edges the paper itself
  // asserted.
  //
  // A family is a SMALL MULTIPLE, not a colour. The site has exactly four
  // validated categorical hues, and seven families would mean generating three,
  // which the chart rules forbid outright. Identity comes from the panel
  // heading; magnitude from the one accent ramp inside it.
  import type { Network } from '$lib/policy-analysis/network';
  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    net: Network;
    onopen: (id: string) => void;
  }

  let { net, onopen }: Props = $props();

  /** Narrow the edge list to one family, or to none. */
  let family = $state<string | null>(null);
  /** Narrow to one body — the "show me everything touching X" question. */
  let focus = $state('');

  const shown = $derived(
    net.edges.filter(
      (e) => (!family || e.family === family) && (!focus || e.fromId === focus || e.toId === focus),
    ),
  );
  /** A long edge list is a scroll, not a reading. The rest are reachable by filtering. */
  const EDGES = 60;
  const label = (id: string) => net.nodes.find((n) => n.id === id)?.label ?? id;
  const peekFor = (id: string) => (net.nodes.find((n) => n.id === id)?.kind === 'actor' ? `actor:${id}` : `artefact:${id}`);
</script>

<div class="net">
  {#if net.insights.length}
    <section class="net-insights">
      <p class="net-label">What the shape of it says</p>
      <div class="net-cards">
        {#each net.insights as insight (insight.key)}
          <article class="net-card">
            <h3>{insight.headline}</h3>
            <p class="net-reading">{insight.reading}</p>
            <ul>
              {#each insight.subjects as subject (subject.id)}
                <li>
                  <button type="button" class="net-subject" data-pa-peek={peekFor(subject.id)} onclick={() => onopen(subject.id)}>
                    {subject.label}
                  </button>
                  <span class="net-subject-note">{subject.note}</span>
                </li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
      <p class="net-caveat">
        Each of these is a counterpart the <em>paper</em> does not state. That is a gap in the document, not
        proof that no such arrangement exists — which is exactly the kind of thing worth confirming before
        the paper goes out rather than after.
      </p>
    </section>
  {/if}

  {#if net.families.length}
    <section class="net-families">
      <p class="net-label">The relationships, by what they do</p>
      <div class="net-family-grid">
        {#each net.families as panel (panel.key)}
          {@const peak = Math.max(...panel.top.map((t) => t.count), 1)}
          <article class="net-family" class:on={family === panel.key}>
            <header>
              <h3><ExplainLabel term={panel.key} text={panel.label} as="inline" /></h3>
              <p class="net-count">{panel.count}</p>
            </header>
            <p class="net-what">{panel.what}</p>
            <!-- One sequential hue inside the panel; identity is the heading. -->
            <div class="net-bars">
              {#each panel.top as end (end.id)}
                <div class="net-bar-row">
                  <button type="button" class="net-end" data-pa-peek={peekFor(end.id)} onclick={() => onopen(end.id)}>{end.label}</button>
                  <span class="net-bar" style="width: {Math.max(4, (end.count / peak) * 100)}%"></span>
                  <span class="net-bar-value">{end.count}</span>
                </div>
              {/each}
            </div>
            <p class="net-relations">
              {panel.relations.map((r) => `${r.relation.replaceAll('_', ' ')} ${r.count}`).join(' · ')}
            </p>
            <button
              type="button"
              class="net-filter-btn"
              onclick={() => (family = family === panel.key ? null : panel.key)}
            >{family === panel.key ? 'Showing only this family' : 'Show only this family →'}</button>
          </article>
        {/each}
      </div>
      {#if net.unfamilied}
        <p class="net-caveat">
          {net.unfamilied} {net.unfamilied === 1 ? 'relationship uses a type' : 'relationships use types'} no family
          claims. They are in the list below and nowhere else — worth a look, because it means the vocabulary
          grew and this grouping did not.
        </p>
      {/if}
    </section>
  {/if}

  <section class="net-list">
    <div class="net-list-head">
      <p class="net-label">Every stated relationship — {shown.length} of {net.edges.length}</p>
      <div class="net-list-controls">
        <label class="net-control">
          <span>Body</span>
          <select bind:value={focus}>
            <option value="">Everything</option>
            {#each net.nodes.slice(0, 120) as node (node.id)}
              <option value={node.id}>{node.label} ({node.degree})</option>
            {/each}
          </select>
        </label>
        {#if family || focus}
          <button type="button" class="net-reset" onclick={() => { family = null; focus = ''; }}>Clear filters</button>
        {/if}
      </div>
    </div>

    {#if shown.length}
      <ul class="net-edges">
        {#each shown.slice(0, EDGES) as edge (edge.artefact.id)}
          <li>
            <button type="button" class="net-end" data-pa-peek={peekFor(edge.fromId)} onclick={() => onopen(edge.fromId)}>{label(edge.fromId)}</button>
            <span class="net-verb">{edge.relation.replaceAll('_', ' ')}</span>
            <button type="button" class="net-end" data-pa-peek={peekFor(edge.toId)} onclick={() => onopen(edge.toId)}>{label(edge.toId)}</button>
            <span class="net-meta">
              {edge.temporal ?? 'unstated'}{#if edge.family}{' · '}{edge.family}{/if}
            </span>
            <button type="button" class="net-open" onclick={() => onopen(edge.artefact.id)}>Open →</button>
          </li>
        {/each}
      </ul>
      {#if shown.length > EDGES}
        <p class="net-caveat">
          Listing the first {EDGES}. Narrow by family or by body to reach the rest — every relationship is
          here, none is dropped.
        </p>
      {/if}
    {:else}
      <p class="net-caveat">Nothing matches those filters.</p>
    {/if}
  </section>
</div>

<style>
  .net-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 14px;
  }
  .net-insights,
  .net-families,
  .net-list {
    margin-top: 26px;
  }

  .net-cards,
  .net-family-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
  }
  .net-card,
  .net-family {
    background: var(--bg);
    padding: 14px 16px 16px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .net-family.on {
    background: var(--accent-tint-04);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .net-card h3,
  .net-family h3 {
    font-size: var(--fs-body);
    font-weight: 700;
    margin: 0;
    line-height: 1.3;
  }
  .net-family header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .net-count {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1;
    margin: 0;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .net-reading,
  .net-what {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
    text-wrap: pretty;
  }
  .net-card ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 5px;
  }
  .net-card li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 7px;
    font-size: var(--fs-label);
    border-top: 1px solid var(--divider);
    padding-top: 5px;
  }
  .net-subject-note {
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
  }

  .net-bars {
    display: grid;
    gap: 3px;
  }
  .net-bar-row {
    display: grid;
    grid-template-columns: minmax(0, 9rem) minmax(0, 1fr) 1.6rem;
    align-items: center;
    gap: 7px;
  }
  .net-bar {
    display: block;
    height: 8px;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
    min-width: 3px;
  }
  .net-bar-value {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .net-relations {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--text-ghost);
    margin: 0;
    line-height: 1.6;
  }

  .net-end,
  .net-subject,
  .net-open,
  .net-filter-btn,
  .net-reset {
    font: inherit;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
    color: var(--accent-ink);
    overflow-wrap: anywhere;
  }
  .net-end,
  .net-subject {
    font-size: var(--fs-label);
    text-decoration: underline;
    text-underline-offset: 2px;
    min-width: 0;
  }
  .net-end:hover,
  .net-subject:hover,
  .net-open:hover,
  .net-filter-btn:hover,
  .net-reset:hover {
    color: var(--accent);
  }
  .net-filter-btn,
  .net-open,
  .net-reset {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    margin-top: auto;
    white-space: nowrap;
  }

  .net-caveat {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 14px 0 0;
    max-width: 76ch;
  }

  .net-list-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .net-list-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .net-control {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .net-control select {
    font-family: var(--font-body);
    font-size: var(--fs-body);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 5px 8px;
    max-width: 20rem;
  }

  .net-edges {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--line-strong);
  }
  .net-edges li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 9px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .net-verb {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    flex: 0 0 auto;
  }
  .net-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-left: auto;
  }

  @media print {
    .net-list-controls,
    .net-filter-btn,
    .net-open {
      display: none !important;
    }
    .net-bar {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .net-cards,
    .net-family-grid {
      break-inside: avoid;
    }
  }
</style>
