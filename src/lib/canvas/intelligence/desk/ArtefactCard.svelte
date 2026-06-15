<!-- src/lib/canvas/intelligence/desk/ArtefactCard.svelte -->
<script lang="ts">
  import type { DeskCard } from './store.svelte';
  import { confidenceColor, confidenceLabel, credibilityBadge } from '$lib/deepdive/display';

  let { card, selected = false, onselect } = $props<{
    card: DeskCard;
    selected?: boolean;
    onselect: (id: string) => void;
  }>();

  const f = $derived(card.fields as Record<string, any>);
  const isChallenge = $derived(card.kind === 'fact' && !!f.isCounterfactual);
  const isEntity = $derived(card.kind === 'entity');
  const unfiled = $derived(card.deskState === 'unfiled' && !card.pinned);

  const variant = $derived(
    isEntity ? 'entity' : isChallenge ? 'challenge' : card.kind, // 'source' | 'fact'
  );

  // confidence 0..1 → percentage for the accent bar + colour/label canon
  const confidencePct = $derived(
    typeof f.confidence === 'number' ? Math.round(Math.max(0, Math.min(1, f.confidence)) * 100) : null,
  );
  const confColor = $derived(
    typeof f.confidence === 'number' ? confidenceColor(f.confidence) : null,
  );
  const confLabel = $derived(
    typeof f.confidence === 'number' ? confidenceLabel(f.confidence) : null,
  );

  // Source credibility → tested badge canon (label + literal colour).
  const credBadge = $derived(
    card.kind === 'source' ? credibilityBadge(f.credibilityType as string | null | undefined) : null,
  );
</script>

<button
  type="button"
  class="ac"
  class:unfiled
  class:selected
  data-variant={variant}
  onclick={(e) => {
    e.stopPropagation();
    onselect(card.id);
  }}
>
  {#if variant === 'entity'}
    <span class="ac-entity-type">{f.type ?? 'entity'}</span>
    <span class="ac-entity-name">{f.name ?? '—'}</span>
    {#if f.description}<span class="ac-entity-desc">{f.description}</span>{/if}
  {:else if variant === 'source'}
    <span class="ac-label">SOURCE</span>
    <span class="ac-title">{f.title ?? f.url ?? '—'}</span>
    <span class="ac-meta">
      <span class="ac-domain">{f.domain ?? ''}</span>
      {#if credBadge}<span class="ac-cred" style:color={credBadge.color} style:border-color={credBadge.color}>{credBadge.label}</span>{/if}
    </span>
  {:else if variant === 'challenge'}
    <span class="ac-tab">CHALLENGE</span>
    <span class="ac-content">{f.content ?? '—'}</span>
    {#if confidencePct !== null}
      <span class="ac-conf"><i style:width="{confidencePct}%" style:background={confColor}></i></span>
      <span class="ac-conf-label" style:color={confColor}>{confLabel} · {confidencePct}%</span>
    {/if}
  {:else}
    <!-- fact -->
    <span class="ac-label">FACT</span>
    <span class="ac-content">{f.content ?? '—'}</span>
    {#if confidencePct !== null}
      <span class="ac-conf"><i style:width="{confidencePct}%" style:background={confColor}></i></span>
      <span class="ac-conf-label" style:color={confColor}>{confLabel} · {confidencePct}%</span>
    {/if}
  {/if}

  {#if unfiled}
    <span class="ac-unfiled-tag">● UNFILED</span>
  {/if}
</button>

<style>
  .ac {
    --card-surface: #faf6ee;
    --hairline: rgba(26, 16, 8, 0.18);
    --brutal: 3px 4px 0 rgba(26, 16, 8, 0.1);

    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 240px;
    box-sizing: border-box;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    font-family: var(--font-body);
    color: var(--text-primary);
    background: var(--card-surface);
    border: 1px solid var(--hairline);
    box-shadow: var(--brutal);
    transition:
      box-shadow 0.18s ease,
      border-color 0.18s ease,
      transform 0.18s ease;
  }
  .ac:hover { transform: translate(-1px, -1px); }
  .ac.selected { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* UNFILED: dashed burnt-orange border, NO shadow. */
  .ac.unfiled {
    border: 1.5px dashed var(--accent);
    box-shadow: none;
  }

  /* labels */
  .ac-label,
  .ac-entity-type {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ac-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ac-content {
    font-size: 12px;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
  }
  .ac-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
  .ac-domain { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-cred {
    flex-shrink: 0;
    font-size: 8px;
    letter-spacing: 0.1em;
    padding: 1px 5px;
    border: 1px solid currentColor;
    border-radius: 2px;
  }

  /* confidence bar */
  .ac-conf {
    height: 3px;
    width: 100%;
    background: rgba(26, 16, 8, 0.1);
    display: block;
  }
  .ac-conf i { display: block; height: 100%; }
  .ac-conf-label {
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.1em;
    align-self: flex-start;
  }

  /* challenge variant — red tab + tint */
  .ac[data-variant='challenge'] {
    border-color: #b3261e;
  }
  .ac.unfiled[data-variant='challenge'] {
    border: 1.5px dashed #b3261e;
  }
  .ac-tab {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    padding: 1px 6px;
    background: #b3261e;
    color: #faf6ee;
  }

  /* entity variant — black chip, Archivo Black name */
  .ac[data-variant='entity'] {
    width: auto;
    min-width: 120px;
    max-width: 220px;
    background: var(--text-primary);
    color: var(--bg);
    box-shadow: var(--brutal);
  }
  .ac[data-variant='entity'] .ac-entity-type { color: rgba(237, 228, 212, 0.6); }
  .ac-entity-name {
    font-family: var(--font-display);
    font-size: 15px;
    line-height: 1.1;
    text-transform: uppercase;
  }
  .ac-entity-desc {
    font-size: 11px;
    color: rgba(237, 228, 212, 0.7);
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ac.unfiled[data-variant='entity'] {
    border: 1.5px dashed var(--accent);
    box-shadow: none;
  }

  .ac-unfiled-tag {
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.12em;
    color: var(--accent);
  }
  .ac[data-variant='entity'] .ac-unfiled-tag { color: var(--accent); }
</style>
