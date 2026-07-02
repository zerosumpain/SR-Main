<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { COMMITMENTS, DOCUMENTS_BY_ID, STATUS_META, THEME_META } from '../../lib/commitments';
  import { markdownToHtml } from '../../lib/author/serialize';

  const BY_ID = Object.fromEntries(COMMITMENTS.map((c) => [c.id, c]));
  const gaps = $derived(author.coverage.gaps.filter((g) => g.kind === 'commitment'));
  const statutory = $derived(author.coverage.statutoryGaps);
  const other = $derived(gaps.filter((g) => !statutory.some((s) => s.id === g.id)));
  let showAll = $state(false);
  let added = $state<string | null>(null);

  function addToDraft(id: string) {
    const c = BY_ID[id];
    if (!c) return;
    const target =
      author.doc.sections.find((s) => s.templateId === 'commitments-obligations') ?? author.doc.sections[0];
    author.appendHtml(
      target.id,
      markdownToHtml(`- **${c.title}** (${DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}${c.timeframe ? `, ${c.timeframe}` : ''}) — ${c.strategyImplication}`),
    );
    added = id;
    setTimeout(() => (added = null), 1400);
  }
</script>

{#snippet gapRow(g: { id: string })}
  {@const c = BY_ID[g.id]}
  {#if c}
    <li class="gap">
      <div class="g-head">
        <i class="dot" style="--c:{THEME_META[c.theme].color}"></i>
        <b>{c.title}</b>
        <span class="g-doc">{DOCUMENTS_BY_ID[c.docId]?.shortName ?? c.docId}</span>
        <span class="g-status" class:hard={c.status === 'statutory-duty' || c.status === 'legislated-not-commenced'}>{STATUS_META[c.status].short}</span>
      </div>
      <p class="g-imp">{c.strategyImplication}</p>
      <div class="g-ops">
        <button class="g-add" class:ok={added === c.id} onclick={() => addToDraft(c.id)}>
          {added === c.id ? '✓ added to draft' : '+ add to draft'}
        </button>
        <a class="g-link" href="/projects/dfe-data-strategy/commitments?c={c.id}">view in the ledger →</a>
      </div>
    </li>
  {/if}
{/snippet}

<div class="gl">
  {#if !COMMITMENTS.length}
    <p class="empty">The commitments ledger is loading its dataset — gaps will appear here.</p>
  {:else if author.totalWords === 0}
    <p class="empty">Write something in the Draft tab first — then the sweep shows what the text answers and what it misses.</p>
  {:else}
    {#if statutory.length}
      <h4 class="gl-h hard">Statutory obligations the draft never mentions ({statutory.length})</h4>
      <ul class="gaps">
        {#each statutory as g (g.id)}{@render gapRow(g)}{/each}
      </ul>
    {:else}
      <p class="allgood">✓ Every statutory obligation in the ledger is at least touched by the draft.</p>
    {/if}
    {#if other.length}
      <h4 class="gl-h">Other commitments not yet covered ({other.length})</h4>
      <ul class="gaps">
        {#each showAll ? other : other.slice(0, 6) as g (g.id)}{@render gapRow(g)}{/each}
      </ul>
      {#if other.length > 6}
        <button class="more" onclick={() => (showAll = !showAll)}>{showAll ? 'Show fewer' : `Show all ${other.length}`}</button>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .gl-h {
    margin: 14px 0 8px;
    font-family: 'Fraunces', serif;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .gl-h.hard {
    color: #b04a2f;
  }
  .gl-h:first-child {
    margin-top: 0;
  }
  .empty,
  .allgood {
    margin: 0;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.6);
  }
  .allgood {
    color: #2f6155;
    font-weight: 500;
  }
  .gaps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .gap {
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
    padding: 9px 12px;
  }
  .g-head {
    display: flex;
    align-items: baseline;
    gap: 7px;
    flex-wrap: wrap;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c);
    align-self: center;
  }
  .g-head b {
    font-size: 13px;
    color: var(--ink);
  }
  .g-doc {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.5);
  }
  .g-status {
    margin-left: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: var(--radius-round);
    border: 1px solid rgba(28, 22, 17, 0.25);
    color: rgba(28, 22, 17, 0.6);
  }
  .g-status.hard {
    border-color: #b04a2f;
    color: #b04a2f;
    font-weight: 600;
  }
  .g-imp {
    margin: 5px 0 7px;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.7);
  }
  .g-ops {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .g-add {
    font-family: 'DM Sans', sans-serif;
    font-size: 11.5px;
    font-weight: 500;
    padding: 4px 10px;
    background: var(--accent-ink-tint-06);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .g-add:hover {
    background: var(--accent-ink-tint-12);
  }
  .g-add.ok {
    border-color: #2f6155;
    color: #2f6155;
  }
  .g-link {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: rgba(28, 22, 17, 0.55);
    text-decoration: none;
  }
  .g-link:hover {
    color: var(--accent-ink);
  }
  .more {
    margin-top: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 5px 11px;
    background: transparent;
    border: 1px dashed rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-round);
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
  }
</style>
