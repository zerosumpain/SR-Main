<script lang="ts">
  // One relationship, over the chat.
  //
  // Clicking a name under "Connected to" on an entity hover card used to
  // `goto('/jkai/intel/network?focus=…')` — a route that does not exist, so it
  // 404'd and threw the conversation away with it. A relationship is a small,
  // self-contained thing to read, so it belongs in an overlay you dismiss, not a
  // navigation you have to come back from.
  //
  // Shell (portal + backdrop + opaque panel) mirrors KnowledgeGraphModal
  // deliberately, so the two overlays on this surface read as the same object.

  import { fetchEntityCard, type EntityCardData } from '$lib/jkai/intel/entity-card-store';
  import {
    ageInDays,
    bestGrade,
    computeConfidence,
    credibilityFromCorroboration,
    explainConfidence,
  } from '$lib/jkai/intel/trust';

  let {
    fromEntityId,
    toEntityId,
    onClose,
    onOpenEntity,
  }: {
    fromEntityId: string;
    toEntityId: string;
    onClose: () => void;
    /** Follow the chain — swaps the modal onto the next relationship. */
    onOpenEntity?: (id: string) => void;
  } = $props();

  let from = $state<EntityCardData | null>(null);
  let to = $state<EntityCardData | null>(null);
  let failed = $state(false);

  $effect(() => {
    const a = fromEntityId;
    const b = toEntityId;
    let cancelled = false;
    from = null;
    to = null;
    failed = false;

    Promise.all([fetchEntityCard(a), fetchEntityCard(b)])
      .then(([left, right]) => {
        if (cancelled) return;
        from = left;
        to = right;
      })
      .catch(() => {
        if (!cancelled) failed = true;
      });

    return () => {
      cancelled = true;
    };
  });

  /** The verb, taken from the source entity's own neighbour list — the same
   *  string the card showed, so the modal can't contradict what was clicked. */
  const verb = $derived(
    from?.neighbours.find((n) => n.id === toEntityId)?.relationship ?? 'connected to',
  );
  const crossCommunity = $derived(
    from?.neighbours.find((n) => n.id === toEntityId)?.crossCommunity ?? false,
  );

  function confidenceOf(card: EntityCardData | null) {
    if (!card) return null;
    const corroboration = card.metrics.noteCount;
    return computeConfidence({
      corroboration,
      sourceGrade: bestGrade(card.notes.map((n) => n.source)),
      credibility: credibilityFromCorroboration(corroboration),
      ageDays: ageInDays(card.notes[0]?.createdAt ?? card.entity.updatedAt),
      confirmed: card.entity.confirmed,
    });
  }

  const toConfidence = $derived(confidenceOf(to));
  const toExplanation = $derived(toConfidence ? explainConfidence(toConfidence) : []);

  /** Notes that assert BOTH ends — the evidence the relationship actually rests
   *  on, as opposed to everything either entity has ever appeared in. */
  const sharedSources = $derived.by(() => {
    if (!from || !to) return [];
    const rightIds = new Set(to.notes.map((n) => n.id));
    return from.notes.filter((n) => rightIds.has(n.id));
  });

  // Local portal action. NOT $lib/canvas/portal — that one re-appends the node
  // on destroy and leaves a dead overlay behind.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="rm-backdrop" use:portal onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="rm-panel"
    role="dialog"
    tabindex="-1"
    aria-label="Relationship"
    onclick={(e) => e.stopPropagation()}
  >
    <header class="rm-hd">
      <span class="rm-title">Relationship</span>
      <div class="rm-hd-right">
        {#if to}
          <a class="rm-chip" href="/jkai/intel/entities/{to.entity.id}">open in intel ↗</a>
        {/if}
        <button type="button" class="rm-chip" onclick={onClose} aria-label="Close">✕</button>
      </div>
    </header>

    <div class="rm-body">
      {#if failed}
        <p class="rm-note">Could not load this relationship.</p>
      {:else if !from || !to}
        <p class="rm-note">Loading…</p>
      {:else}
        <div class="rm-triple">
          <div class="rm-end">
            <span class="rm-icon" style="color: {from.entity.type.color};">{from.entity.type.icon}</span>
            <span class="rm-end-name">{from.entity.name}</span>
            <span class="rm-end-type">{from.entity.type.name}</span>
          </div>
          <div class="rm-verb-wrap">
            <span class="rm-arrow" aria-hidden="true">→</span>
            <span class="rm-verb">{verb}</span>
            {#if crossCommunity}
              <span class="rm-cross" title="Links two otherwise separate clusters">bridges clusters</span>
            {/if}
          </div>
          <div class="rm-end">
            <span class="rm-icon" style="color: {to.entity.type.color};">{to.entity.type.icon}</span>
            <span class="rm-end-name">{to.entity.name}</span>
            <span class="rm-end-type">{to.entity.type.name}</span>
          </div>
        </div>

        {#if to.entity.summary}
          <p class="rm-summary">{to.entity.summary}</p>
        {/if}

        <div class="rm-cols">
          <section class="rm-sec">
            <h4>Evidence</h4>
            {#if sharedSources.length > 0}
              <ul class="rm-sources">
                {#each sharedSources.slice(0, 6) as n (n.id)}
                  <li><a href={n.href}>{n.title}</a> <span class="rm-src">{n.source}</span></li>
                {/each}
              </ul>
            {:else}
              <p class="rm-note">
                No single source asserts both ends. The link comes from them appearing
                in the same material rather than from one document stating it.
              </p>
            {/if}
          </section>

          <section class="rm-sec">
            <h4>Confidence in {to.entity.name}</h4>
            {#if toConfidence}
              <div class="rm-score">
                <span class="rm-grade {toConfidence.label}">{toConfidence.label}</span>
                <span>{Math.round(toConfidence.score * 100)}%</span>
              </div>
              <ul class="rm-why">
                {#each toExplanation as sentence, i (i)}
                  <li>{sentence}</li>
                {/each}
              </ul>
            {/if}
          </section>
        </div>

        {#if to.neighbours.length > 0}
          <section class="rm-sec">
            <h4>{to.entity.name} also connects to</h4>
            <div class="rm-chain">
              {#each to.neighbours.slice(0, 8) as n (n.id)}
                <button
                  type="button"
                  class="rm-next"
                  onclick={() => onOpenEntity?.(n.id)}
                  title="{n.relationship} — {n.degree} links"
                >
                  <span class="rm-dot" style="background: {n.color};"></span>
                  <span class="rm-next-name">{n.name}</span>
                  <span class="rm-next-rel">{n.relationship}</span>
                </button>
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .rm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(26, 16, 8, 0.45);
  }
  .rm-panel {
    display: flex;
    flex-direction: column;
    width: min(760px, 100%);
    max-height: 100%;
    /* Opaque — --card-bg is a 7% tint and the chat would show through it. */
    background: var(--surface-elevated);
    border: 2px solid rgba(26, 16, 8, 0.22);
    border-radius: 0;
  }

  .rm-hd {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 11px 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .rm-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-ghost);
  }
  .rm-hd-right {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .rm-chip {
    padding: 3px 8px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    text-decoration: none;
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .rm-chip:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }

  .rm-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
  }

  .rm-triple {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
  }
  .rm-end {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .rm-icon {
    font-size: var(--fs-body);
    line-height: 1.2;
  }
  .rm-end-name {
    font-family: var(--font-brand);
    font-size: var(--fs-body-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .rm-end-type {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .rm-verb-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    text-align: center;
  }
  .rm-arrow {
    color: var(--accent);
    font-size: var(--fs-body);
    line-height: 1;
  }
  .rm-verb {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    max-width: 150px;
  }
  .rm-cross {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }

  .rm-summary {
    margin: 12px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
  }

  .rm-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 14px;
  }
  @media (max-width: 639px) {
    .rm-triple,
    .rm-cols {
      grid-template-columns: 1fr;
    }
  }

  .rm-sec {
    margin-top: 14px;
  }
  .rm-cols .rm-sec {
    margin-top: 0;
  }
  .rm-sec h4 {
    margin: 0 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .rm-note {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .rm-sources {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rm-sources li {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.4;
  }
  .rm-sources a {
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-20);
  }
  .rm-sources a:hover {
    color: var(--accent);
  }
  .rm-src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }

  .rm-score {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .rm-grade {
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .rm-grade.high {
    color: var(--success);
    border-color: var(--success);
  }
  .rm-grade.moderate {
    color: var(--warn);
    border-color: var(--warn);
  }
  .rm-grade.low,
  .rm-grade.unverified {
    color: var(--error);
    border-color: var(--error);
  }
  .rm-why {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rm-why li {
    padding-left: 9px;
    border-left: 2px solid var(--accent-tint-20);
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
  }

  .rm-chain {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .rm-next {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: var(--bg);
    cursor: pointer;
    transition: border-color 0.2s ease-out;
  }
  .rm-next:hover {
    border-color: var(--accent-tint-35);
  }
  .rm-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-round);
    flex: none;
  }
  .rm-next-name {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .rm-next-rel {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
</style>
