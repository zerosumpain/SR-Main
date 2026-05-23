<script lang="ts">
  import type { ResolvedModel, ID, ResolvedStrand } from '../lib/types';

  interface Props {
    model: ResolvedModel;
    hoverId: ID | 'spine' | null;
    x: number;
    y: number;
  }
  let { model, hoverId, x, y }: Props = $props();

  let strand = $derived.by(() => {
    if (!hoverId || hoverId === 'spine') return null;
    return model.strands.find((s) => s.id === hoverId) ?? null;
  });

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  function freqLabel(s: ResolvedStrand): string {
    return `${s.frequency} / ${s.frequencyPeriod}`;
  }

  function mergeTargetName(s: ResolvedStrand): string {
    if (s.mergeInto === 'spine') return 'the spine';
    return model.strands.find((x) => x.id === s.mergeInto)?.name ?? s.mergeInto;
  }
</script>

{#if hoverId === 'spine'}
  <div class="tt" style="left:{x + 14}px; top:{y + 14}px">
    <div class="row">
      <span class="dot spine"></span>
      <span class="name">The spine</span>
    </div>
    <div class="meta">Single source of truth. Every strand eventually winds into it.</div>
  </div>
{:else if strand}
  <div class="tt" style="left:{x + 14}px; top:{y + 14}px">
    <div class="row">
      <span class="dot" style="background:{strand.colour}"></span>
      <span class="name">{strand.name}</span>
    </div>
    <dl>
      <dt>Users</dt><dd>{strand.users.toLocaleString()}</dd>
      <dt>Collected</dt><dd>{freqLabel(strand)}</dd>
      <dt>Started</dt><dd>{fmtDate(strand.startDate)}</dd>
      <dt>Merges</dt><dd>{fmtDate(strand.mergeDate)}</dd>
      <dt>Into</dt><dd>{mergeTargetName(strand)}</dd>
    </dl>
  </div>
{/if}

<style>
  .tt {
    position: fixed;
    z-index: 40;
    pointer-events: none;
    background: var(--ink, #1c1611);
    color: var(--paper, #f1ead6);
    border: 1px solid rgba(241, 234, 214, 0.15);
    border-radius: 6px;
    padding: 10px 12px;
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.25);
    min-width: 180px;
    max-width: 260px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.08);
  }
  .dot.spine {
    background: var(--paper);
    box-shadow: 0 0 0 2px rgba(241, 234, 214, 0.25);
  }
  .name {
    font-family: 'Fraunces', serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .meta {
    color: rgba(241, 234, 214, 0.7);
    font-style: italic;
    font-size: 11.5px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 12px;
    row-gap: 3px;
    margin: 4px 0 0;
  }
  dt {
    color: rgba(241, 234, 214, 0.55);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  dd {
    margin: 0;
    color: var(--paper);
  }
</style>
