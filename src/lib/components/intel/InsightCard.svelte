<script lang="ts">
  // One automated finding, with the action it suggests attached.
  //
  // The whole point of the dashboard is that a finding is never a dead end, so
  // the action button is part of the card, not a separate step.

  import type { InsightData } from './types';

  let {
    insight,
    busy = false,
    onCommission,
    onFocus,
  }: {
    insight: InsightData;
    busy?: boolean;
    onCommission?: (insight: InsightData) => void;
    onFocus?: (id: string) => void;
  } = $props();

  /** Readable label per detector, so the chip explains what kind of finding this is. */
  const KIND_LABEL: Record<string, string> = {
    broker: 'broker',
    unlikely_relation: 'unexpected link',
    missing_link: 'likely link',
    orphan: 'unconnected',
    isolated_cluster: 'isolated',
    emerging_hub: 'emerging',
    stale_hub: 'going stale',
    thin_evidence: 'thin evidence',
    type_outlier: 'taxonomy',
    dominant_cluster: 'structure',
  };

  /** Findings about data quality read differently from findings about the world. */
  const QUALITY_KINDS = new Set(['orphan', 'thin_evidence', 'type_outlier', 'dominant_cluster']);

  const label = $derived(KIND_LABEL[insight.kind] ?? insight.kind.replace(/_/g, ' '));
  const isQuality = $derived(QUALITY_KINDS.has(insight.kind));
</script>

<article class="insight" class:quality={isQuality} style="--weight: {insight.score};">
  <header>
    <span class="kind">{label}</span>
    <span class="score" title="Confidence {Math.round(insight.score * 100)}%">
      <span class="bar" style="width: {Math.round(insight.score * 100)}%"></span>
    </span>
  </header>

  <h3>{insight.title}</h3>
  <p>{insight.detail}</p>

  {#if insight.entities.length}
    <div class="entities">
      {#each insight.entities.slice(0, 6) as e (e.id)}
        <button type="button" class="ent" onclick={() => onFocus?.(e.id)} title="Focus {e.name}">
          <span class="dot" style="background: {e.color};"></span>{e.name}
        </button>
      {/each}
      {#if insight.entities.length > 6}
        <span class="more">+{insight.entities.length - 6}</span>
      {/if}
    </div>
  {/if}

  {#if onCommission}
    <button class="action" type="button" disabled={busy} onclick={() => onCommission(insight)}>
      {busy ? 'Working…' : insight.actionLabel}
    </button>
  {/if}
</article>

<style>
  .insight {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    /* The stronger the finding, the more it is allowed to assert itself. */
    border-left: 3px solid color-mix(in srgb, var(--accent) calc(var(--weight) * 100%), var(--card-border));
    border-radius: var(--radius-round);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .insight.quality {
    border-left-color: color-mix(in srgb, var(--accent-ink) calc(var(--weight) * 100%), var(--card-border));
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-ghost);
  }
  .score {
    width: 46px;
    height: 3px;
    background: var(--divider);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .quality .bar {
    background: var(--accent-ink);
  }

  h3 {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.3;
  }
  p {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .entities {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .ent {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--bg-section);
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    padding: 2px 7px;
    font: inherit;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ent:hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    flex-shrink: 0;
  }
  .more {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    align-self: center;
  }

  .action {
    align-self: flex-start;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 5px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--t-fast) var(--ease-out);
  }
  .action:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
