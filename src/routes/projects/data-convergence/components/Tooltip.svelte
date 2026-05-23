<script lang="ts">
  import type { ResolvedModel, ID, ResolvedStrand, ResolvedOutput } from '../lib/types';
  import { cadenceLabel } from '../lib/strands';

  interface Props {
    model: ResolvedModel;
    hoverId: ID | 'spine' | null;
    hoverOutputId: ID | null;
    x: number;
    y: number;
  }
  let { model, hoverId, hoverOutputId, x, y }: Props = $props();

  let strand = $derived.by(() => {
    if (!hoverId || hoverId === 'spine') return null;
    return model.strands.find((s) => s.id === hoverId) ?? null;
  });
  let output = $derived.by(() => {
    if (!hoverOutputId) return null;
    return model.outputs.find((o) => o.id === hoverOutputId) ?? null;
  });

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  }

  function mergeTargetName(s: ResolvedStrand): string {
    if (s.mergeInto === 'spine') return 'the spine';
    return model.strands.find((x) => x.id === s.mergeInto)?.name ?? s.mergeInto;
  }

  function outputsFor(s: ResolvedStrand): ResolvedOutput[] {
    return model.outputs.filter((o) => o.sourceIds.includes(s.id));
  }
  function sourcesFor(o: ResolvedOutput): ResolvedStrand[] {
    return model.strands.filter((s) => o.sourceIds.includes(s.id));
  }
</script>

{#if output}
  <div class="tt" style="left:{x + 14}px; top:{y + 14}px">
    <div class="row">
      <span class="ring" style="border-color:{output.colour}"></span>
      <span class="name">{output.name}</span>
    </div>
    <dl>
      <dt>Anchor</dt><dd>{new Date(output.anchorMs).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</dd>
      <dt>Side</dt><dd>{output.resolvedSide}</dd>
      <dt>Fed by</dt>
      <dd>
        {#each sourcesFor(output) as s, i}
          {i > 0 ? ', ' : ''}<span style="color:{s.colour}">●</span> {s.name}
        {/each}
      </dd>
    </dl>
  </div>
{:else if hoverId === 'spine'}
  <div class="tt" style="left:{x + 14}px; top:{y + 14}px">
    <div class="row">
      <span class="dot spine"></span>
      <span class="name">The spine</span>
    </div>
    <div class="meta">Consolidated source of truth. Thickness = total contributing volume.</div>
  </div>
{:else if strand}
  <div class="tt" style="left:{x + 14}px; top:{y + 14}px">
    <div class="row">
      <span class="dot" class:dotted={strand.isReference} style={strand.isReference ? `border-color:${strand.colour}` : `background:${strand.colour}`}></span>
      <span class="name">{strand.name}</span>
    </div>
    {#if strand.isReference}
      <div class="ref-flag">Reference data — continuous feed</div>
    {/if}
    <dl>
      <dt>Volume</dt><dd>{strand.users.toLocaleString()}</dd>
      <dt>Cadence</dt><dd>{cadenceLabel(strand.cadence)}</dd>
      <dt>Started</dt><dd>{fmtDate(strand.startDate)}</dd>
      <dt>{strand.isReference ? 'Until' : 'Merges'}</dt><dd>{fmtDate(strand.mergeDate)}</dd>
      {#if !strand.isReference}
        <dt>Into</dt><dd>{mergeTargetName(strand)}</dd>
      {/if}
      {#if outputsFor(strand).length > 0}
        <dt>Feeds</dt>
        <dd>
          {#each outputsFor(strand) as o, i}
            {i > 0 ? ', ' : ''}<span class="ring-inline" style="border-color:{o.colour}"></span> {o.name}
          {/each}
        </dd>
      {/if}
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
    min-width: 200px;
    max-width: 320px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08);
  }
  .dot.dotted {
    background: transparent;
    border: 1.5px dashed currentColor;
    box-shadow: none;
  }
  .dot.spine {
    background: var(--paper);
  }
  .ring {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid;
    background: transparent;
  }
  .ring-inline {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid;
    vertical-align: middle;
  }
  .name {
    font-family: 'Fraunces', serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .ref-flag {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    color: rgba(241, 234, 214, 0.7);
    margin-bottom: 6px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .meta {
    color: rgba(241, 234, 214, 0.72);
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
