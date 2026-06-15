<!-- src/lib/canvas/intelligence/desk/ArtefactCard.svelte -->
<script lang="ts">
  import type { DeskCard } from './store.svelte';
  import { confidenceColor, confidenceLabel, credibilityBadge } from '$lib/deepdive/display';

  let {
    card,
    selected = false,
    onselect,
    onsummarize,
    analysing = false,
  } = $props<{
    card: DeskCard;
    selected?: boolean;
    onselect: (id: string) => void;
    /** Called on double-click of a source card. Single-click onselect still fires. */
    onsummarize?: (id: string) => void;
    /** True for the one SOURCE card whose facts are being produced right now
     *  (Feature 2). Drives a subtle "analysing…" badge + shimmer on THIS inner
     *  element (box-shadow/colour only — no transform, so it never conflicts
     *  with the hover micro-transform or the host's position/morph transform). */
    analysing?: boolean;
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

  // ---------------------------------------------------------------------------
  // Source preview image — lazy-fetched, graceful, no layout jump.
  // AbortController is plain `let` (NOT $state) to avoid Svelte 5 proxy churn.
  // ---------------------------------------------------------------------------
  let previewImage: string | null = $state(null);
  let previewType: 'og' | 'favicon' | null = $state(null);
  let previewLoading = $state(false);
  let previewFailed = $state(false);

  // Plain let — must NOT be $state (see CLAUDE.md Svelte 5 footguns).
  let previewAc: AbortController | null = null;

  $effect(() => {
    // Only fetch for source cards with a URL.
    const sourceUrl: string | undefined = card.kind === 'source' ? (f.url as string) : undefined;
    if (!sourceUrl) return;

    // Abort any in-flight request for a previous URL.
    previewAc?.abort();
    previewAc = new AbortController();
    const signal = previewAc.signal;

    previewLoading = true;
    previewFailed = false;
    previewImage = null;
    previewType = null;

    const endpoint = `/api/deepdive/source-image?url=${encodeURIComponent(sourceUrl)}`;

    fetch(endpoint, { signal })
      .then((r) => r.json())
      .then((data: { image?: string; type?: 'og' | 'favicon' }) => {
        if (signal.aborted) return;
        if (data.image) {
          previewImage = data.image;
          previewType = data.type ?? null;
        }
        previewLoading = false;
      })
      .catch(() => {
        if (!signal.aborted) {
          previewFailed = true;
          previewLoading = false;
        }
      });

    return () => {
      previewAc?.abort();
      previewAc = null;
    };
  });
</script>

<button
  type="button"
  class="ac"
  class:unfiled
  class:selected
  class:ac-analysing={analysing}
  data-variant={variant}
  onclick={(e) => {
    e.stopPropagation();
    onselect(card.id);
  }}
  ondblclick={(e) => {
    if (card.kind !== 'source') return;
    e.stopPropagation();
    onsummarize?.(card.id);
  }}
>
  {#if variant === 'entity'}
    <span class="ac-entity-type">{f.type ?? 'entity'}</span>
    <span class="ac-entity-name">{f.name ?? '—'}</span>
    {#if f.description}<span class="ac-entity-desc">{f.description}</span>{/if}
  {:else if variant === 'source'}
    <!-- Preview thumbnail (og or favicon) at the top -->
    {#if previewLoading && !previewFailed}
      <div class="ac-thumb-skeleton" aria-hidden="true"></div>
    {:else if previewImage && !previewFailed}
      <div class="ac-thumb" class:ac-thumb--favicon={previewType === 'favicon'}>
        <img
          src={previewImage}
          alt=""
          loading="lazy"
          decoding="async"
          onerror={() => { previewFailed = true; }}
        />
      </div>
    {/if}

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

  {#if analysing}
    <span class="ac-analysing-tag" aria-hidden="true">
      <i class="ac-analysing-dot"></i>analysing&hellip;
    </span>
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

  /* ---------------------------------------------------------------------------
   * Active-source "analysing…" (Feature 2)
   * The SOURCE card whose facts are being produced right now gets a subtle warm
   * accent ring (box-shadow, NOT transform) + a mono badge. Pure colour/shadow,
   * so it never conflicts with the hover micro-transform or the host transform.
   * --------------------------------------------------------------------------- */
  .ac.ac-analysing {
    border-color: var(--accent);
    animation: ac-analysing-ring 1.4s ease-in-out infinite;
  }
  @keyframes ac-analysing-ring {
    0%,
    100% { box-shadow: var(--brutal), 0 0 0 0 rgba(196, 87, 10, 0); }
    50%  { box-shadow: var(--brutal), 0 0 0 3px rgba(196, 87, 10, 0.22); }
  }
  .ac-analysing-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .ac-analysing-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: ac-analysing-blink 1s steps(2, jump-none) infinite;
  }
  @keyframes ac-analysing-blink {
    0%,
    100% { opacity: 1; }
    50%  { opacity: 0.25; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ac.ac-analysing { animation: none; box-shadow: var(--brutal), 0 0 0 2px rgba(196, 87, 10, 0.22); }
    .ac-analysing-dot { animation: none; }
  }

  /* ---------------------------------------------------------------------------
   * Source preview thumbnail
   * --------------------------------------------------------------------------- */

  /* Skeleton placeholder — fixed height prevents layout jump while loading. */
  .ac-thumb-skeleton {
    width: 100%;
    height: 80px;
    background: linear-gradient(
      90deg,
      rgba(26, 16, 8, 0.06) 25%,
      rgba(26, 16, 8, 0.12) 50%,
      rgba(26, 16, 8, 0.06) 75%
    );
    background-size: 200% 100%;
    animation: ac-shimmer 1.4s ease infinite;
    border-radius: 2px;
    margin-bottom: 2px;
  }

  @keyframes ac-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* OG image — full width, fixed height, object-fit cover. */
  .ac-thumb {
    width: 100%;
    height: 80px;
    overflow: hidden;
    border-radius: 2px;
    margin-bottom: 2px;
    background: rgba(26, 16, 8, 0.05);
  }

  .ac-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* Favicon variant — small centred icon on a tinted block, not stretched. */
  .ac-thumb--favicon {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(26, 16, 8, 0.07);
    height: 40px;
  }

  .ac-thumb--favicon img {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }
</style>
