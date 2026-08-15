<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { STATUS_META } from '../../lib/commitments';
  import { CAPABILITY_AREAS } from '../../lib/capabilities';
  import CommitList from './CommitList.svelte';
  import type { Commitment } from '../../lib/types';

  // what the ledger demands of the strategy: commitments per capability area,
  // stacked by how hard they bind (sequential single-hue ramp, dark = binding)
  const BANDS = [
    { id: 'binding', label: 'Statutory / legislated', color: '#1c1611', match: (c: Commitment) => c.status === 'statutory-duty' || c.status === 'legislated-not-commenced' },
    { id: 'delivering', label: 'In delivery', color: '#6a5f52', match: (c: Commitment) => c.status === 'in-delivery' },
    { id: 'softer', label: 'Announced / proposed / consulting', color: '#b3a68e', match: (c: Commitment) => ['announced', 'proposed', 'consulting'].includes(c.status) },
  ];
  const rows = $derived(
    CAPABILITY_AREAS.map((cap) => {
      const all = ledger.filtered.filter((c) => c.capabilityIds.includes(cap.id));
      return { cap, total: all.length, bands: BANDS.map((b) => ({ ...b, n: all.filter(b.match).length })), all };
    }).sort((a, b) => b.total - a.total),
  );
  const maxTotal = $derived(Math.max(1, ...rows.map((r) => r.total)));
  let openCap = $state<string | null>(null);
  const openRows = $derived(openCap ? (rows.find((r) => r.cap.id === openCap)?.all ?? []) : []);

  const mustAnswer = $derived(
    ledger.filtered
      .filter((c) => ['statutory-duty', 'legislated-not-commenced', 'in-delivery'].includes(c.status))
      .sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank),
  );
</script>

<div class="cd">
  <div class="legend">
    {#each BANDS as b}<span class="lg"><i style="--c:{b.color}"></i>{b.label}</span>{/each}
    <span class="lg-note">click a bar to see the commitments behind it</span>
  </div>

  <div class="bars">
    {#each rows as r (r.cap.id)}
      <button class="brow" class:on={openCap === r.cap.id} onclick={() => (openCap = openCap === r.cap.id ? null : r.cap.id)} title="{r.cap.name}: {r.total} commitments">
        <span class="b-lab">{r.cap.short}</span>
        <span class="b-track">
          {#each r.bands.filter((b) => b.n > 0) as b (b.id)}
            <i style="--c:{b.color}; width:{(b.n / maxTotal) * 100}%" title="{b.label}: {b.n}"></i>
          {/each}
        </span>
        <span class="b-n">{r.total}</span>
      </button>
    {/each}
  </div>
  {#if openCap}
    <div class="cap-open">
      <h4>{rows.find((r) => r.cap.id === openCap)?.cap.name} — the commitments demanding it</h4>
      <CommitList items={openRows} dense />
    </div>
  {/if}

  <h3 class="ma-h" id="must-answer">The must-answer list <span class="ma-n">({mustAnswer.length})</span></h3>
  <p class="ma-note">Every statutory, legislated or in-delivery commitment in view — the obligations a credible strategy has to name, own and date. The softer announcements can wait; these cannot.</p>
  <CommitList items={mustAnswer} />
</div>

<style>
  .legend {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.65);
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .lg i {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    background: var(--c);
  }
  .lg-note {
    margin-left: auto;
    color: rgba(28, 22, 17, 0.45);
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 8px;
  }
  .brow {
    display: grid;
    grid-template-columns: 92px 1fr 36px;
    align-items: center;
    gap: 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    padding: 4px 8px;
    cursor: pointer;
  }
  .brow:hover {
    background: rgba(255, 255, 255, 0.55);
    border-color: rgba(28, 22, 17, 0.15);
  }
  .brow.on {
    background: rgba(255, 255, 255, 0.7);
    border-color: var(--accent-ink);
  }
  .b-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    color: rgba(28, 22, 17, 0.7);
    text-align: right;
  }
  .b-track {
    display: flex;
    gap: 2px;
    height: 16px;
  }
  .b-track i {
    display: block;
    height: 100%;
    background: var(--c);
    border-radius: 3px;
    min-width: 4px;
  }
  .b-n {
    font-family: var(--fs-serif);
    font-size: var(--fs-nav);
    font-weight: 600;
    color: var(--ink);
  }
  .cap-open {
    margin: 4px 0 14px;
    padding: 11px 14px;
    border-left: 3px solid var(--accent-ink);
    background: rgba(255, 255, 255, 0.45);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
  }
  .cap-open h4 {
    margin: 0 0 8px;
    font-family: var(--fs-serif);
    font-size: var(--fs-nav);
    font-weight: 600;
    color: var(--ink);
  }
  .ma-h {
    margin: 20px 0 4px;
    font-family: var(--fs-serif);
    font-size: 18px;
    font-weight: 600;
    color: var(--ink);
  }
  .ma-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .ma-note {
    margin: 0 0 12px;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.65);
    max-width: 86ch;
  }
</style>
