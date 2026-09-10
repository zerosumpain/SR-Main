<script lang="ts">
  // THE DRILL — one artefact, opened out, over the page rather than under it.
  //
  // This replaces the sticky inspector, and the replacement IS ask 10. The old
  // panel lived at the bottom of the viewport, so `inspect()` had to scroll the
  // page to bring it into view and then move focus into it. Every clickthrough
  // on the dashboard was therefore a scroll to somewhere else in the same
  // document — the exact thing the brief rules out. A drawer opens ON the page:
  // nothing moves underneath, and closing puts the reader back where they were,
  // with focus back on the thing they clicked.
  //
  // The shell is `MetricDrill`'s — backdrop, panel, Escape, click-out — because
  // that is this site's established way of opening a layer and a second,
  // differently-behaved drawer would be a worse answer than a shared one.
  //
  // It is one component reached from everywhere, not one per section. A reader
  // following a play to its actor to that actor's profile to the passage it was
  // extracted from should never lose the thread, so `refs` and the citation
  // trail navigate WITHIN the drawer and a back stack remembers the route.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { explain } from '$lib/policy-analysis/glossary';
  import { BAND_FILL, BAND_LABEL, type Band, type Play } from '$lib/policy-analysis/view';
  import ArtefactValue from './ArtefactValue.svelte';
  import ExplainLabel from './ExplainLabel.svelte';
  import { peekHandlers } from '$lib/policy-analysis/peek.svelte';

  interface Props {
    /** The artefact to open, or null for closed. */
    id: string | null;
    artefacts: Artefact[];
    plays: Play[];
    /** Stage and timestamps, where the caller has them. A shared copy does not. */
    provenance?: { id: string; stage: number; updatedAt: string | Date }[];
    onclose: () => void;
    /** Follow a reference without leaving the drawer. */
    onopen: (id: string) => void;
    /** Steps back through the trail. Absent hides the affordance. */
    onback?: () => void;
    /** How deep the trail is, for the back label. */
    depth?: number;
  }

  let { id, artefacts, plays, provenance = [], onclose, onopen, onback, depth = 0 }: Props = $props();

  const artefact = $derived(id ? (artefacts.find((a) => a.id === id) ?? null) : null);
  const play = $derived(id ? (plays.find((p) => p.artefact.id === id) ?? null) : null);
  const meta = $derived(id ? (provenance.find((p) => p.id === id) ?? null) : null);
  const origin = $derived(artefact ? explain(artefact.origin) : null);

  /** What cites THIS — the direction `refs` cannot answer, and the one a reader asks. */
  const citedBy = $derived(
    id ? artefacts.filter((a) => a.refs.includes(id)).slice(0, 12) : [],
  );

  const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'not scored' : `${Math.round(v * 100)}%`);
  const fmt = (v: Date | string | null | undefined) => (v ? new Date(v).toLocaleString() : 'not recorded');
  const named = (ref: string) => artefacts.find((a) => a.id === ref)?.label ?? ref;
  const kindOf = (ref: string) => artefacts.find((a) => a.id === ref)?.kind ?? null;

  /** A reference opens as the kind it is, so its peek card is the right one. */
  const peekFor = (ref: string) => {
    const kind = kindOf(ref);
    if (kind === 'actor') return `actor:${ref}`;
    if (kind === 'exploit') return `play:${ref}`;
    if (kind === 'assumption') return `assumption:${ref}`;
    return `artefact:${ref}`;
  };

  function onkeydown(e: KeyboardEvent) {
    if (id && e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  let panel: HTMLDivElement | null = $state(null);
  $effect(() => {
    // Focus the panel when the SUBJECT changes, so following a reference
    // re-announces the new artefact rather than leaving a screen reader on the
    // old heading. Reading `id` is the whole dependency; the panel node is not
    // reactive state that this writes.
    void id;
    panel?.focus({ preventScroll: true });
  });
</script>

<svelte:window {onkeydown} />

{#if id && artefact}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dr-backdrop" onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      bind:this={panel}
      class="dr-panel"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label="{artefact.label} — detail"
      onclick={(e) => e.stopPropagation()}
      {...peekHandlers()}
    >
      <div class="dr-head">
        <div class="dr-head-left">
          <p class="dr-kicker">{artefact.kind.replaceAll('_', ' ')}</p>
          <h2 class="dr-title">{artefact.label}</h2>
        </div>
        <div class="dr-head-right">
          {#if onback && depth > 0}
            <button type="button" class="dr-btn" onclick={onback}>← Back</button>
          {/if}
          <button type="button" class="dr-btn" onclick={onclose}>Close ✕</button>
        </div>
      </div>

      <p class="dr-statement">{artefact.statement}</p>

      {#if play}
        <div class="dr-band-row">
          <span class="dr-band" style="background: {BAND_FILL[play.band as Band]}" class:on-dark={play.band === 'severe'}>
            {BAND_LABEL[play.band as Band]} · {Math.round(play.exposure * 100)}
          </span>
          <ExplainLabel term="exposure" text="Exposure" />
        </div>
        <dl class="dr-factors">
          {#each play.factors as factor (factor.key)}
            <div class="dr-factor">
              <dt><ExplainLabel term={factor.key} text={factor.key} /></dt>
              <dd>
                <span class="dr-track"><span class="dr-fill" style="width: {Math.round(factor.value * 100)}%"></span></span>
                <span class="dr-pct">{Math.round(factor.value * 100)}</span>
              </dd>
            </div>
          {/each}
        </dl>

        <!--
          The play's own narrative fields. These are what the CARD summarises
          away: ask 1 says the card shows the opening and the four factors, and
          the rest drills. This is the rest.
        -->
        <div class="dr-lines">
          {#if play.artefact.data.motivation}<p><strong>Why they would.</strong> {play.artefact.data.motivation}</p>{/if}
          {#if play.artefact.data.play}<p><strong>How it runs.</strong> {play.artefact.data.play}</p>{/if}
          {#if play.artefact.data.payoff}<p><strong>What they get.</strong> {play.artefact.data.payoff}</p>{/if}
          {#if play.artefact.data.costToPolicy}<p><strong>What it costs the policy.</strong> {play.artefact.data.costToPolicy}</p>{/if}
          {#if play.artefact.data.earlyWarning}<p><strong>First sign of it.</strong> {play.artefact.data.earlyWarning}</p>{/if}
          {#if play.artefact.data.precedent}<p class="dr-muted"><strong>Precedent.</strong> {play.artefact.data.precedent}</p>{/if}
          {#if play.artefact.data.counter}<p class="dr-counter"><strong>What would close it.</strong> {play.artefact.data.counter}</p>{/if}
        </div>
      {/if}

      <div class="dr-facts">
        <div class="dr-fact">
          <p class="dr-label"><ExplainLabel term={artefact.origin} text="Where it came from" /></p>
          <p class="dr-fact-value">{artefact.origin.replaceAll('_', ' ')}</p>
          {#if origin}<p class="dr-muted">{origin.read}</p>{/if}
        </div>
        <div class="dr-fact">
          <p class="dr-label"><ExplainLabel term="confidence" text="Confidence" /></p>
          <p class="dr-fact-value">{pct(artefact.confidence)}</p>
          <p class="dr-muted">A judgement, not a calibrated probability.</p>
        </div>
        {#if meta}
          <div class="dr-fact">
            <p class="dr-label">Produced</p>
            <p class="dr-fact-value">Stage {meta.stage + 1}</p>
            <p class="dr-muted">{fmt(meta.updatedAt)}</p>
          </div>
        {/if}
        {#if artefact.page || artefact.section}
          <div class="dr-fact">
            <p class="dr-label">In the paper</p>
            <p class="dr-fact-value">{artefact.page ? `Page ${artefact.page}` : artefact.section}</p>
            {#if artefact.page && artefact.section}<p class="dr-muted">{artefact.section}</p>{/if}
          </div>
        {/if}
      </div>

      {#if artefact.sourceQuote}
        <blockquote class="dr-quote">{artefact.sourceQuote}</blockquote>
        <p class="dr-muted">
          The paper's own wording, located by normalising line breaks and hyphenation — so the quote reads as
          the document has it, not as it was typed back.
        </p>
      {/if}

      {#if artefact.url}
        <p><a class="dr-link" href={artefact.url} target="_blank" rel="noopener noreferrer">Open the external source ↗</a></p>
      {/if}

      {#if artefact.refs.length}
        <section class="dr-refs">
          <p class="dr-label">Rests on — {artefact.refs.length}</p>
          <div class="dr-chips">
            {#each artefact.refs as ref (ref)}
              <button type="button" class="dr-chip" data-pa-peek={peekFor(ref)} onclick={() => onopen(ref)}>
                {named(ref)}{#if kindOf(ref)}<span class="dr-chip-kind">{kindOf(ref)?.replaceAll('_', ' ')}</span>{/if}
              </button>
            {/each}
          </div>
        </section>
      {/if}

      {#if citedBy.length}
        <section class="dr-refs">
          <p class="dr-label">What cites it — {citedBy.length}</p>
          <div class="dr-chips">
            {#each citedBy as cite (cite.id)}
              <button type="button" class="dr-chip" data-pa-peek={peekFor(cite.id)} onclick={() => onopen(cite.id)}>
                {cite.label}<span class="dr-chip-kind">{cite.kind.replaceAll('_', ' ')}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <details class="dr-raw">
        <summary>Every structured field</summary>
        <ArtefactValue value={artefact.data} all={artefacts} inspect={onopen} />
      </details>

      <p class="dr-id">{artefact.id}</p>
    </div>
  </div>
{/if}

<style>
  .dr-backdrop {
    position: fixed;
    inset: 0;
    z-index: 240;
    background: rgba(26, 16, 8, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 5vh 20px;
    animation: dr-fade 140ms ease;
  }
  @keyframes dr-fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dr-backdrop {
      animation: none;
    }
  }

  .dr-panel {
    width: 100%;
    max-width: 760px;
    max-height: 88vh;
    overflow: auto;
    /* OPAQUE. `--card-bg` is a 7% tint and would let the page read through a
       modal — the recurring trap in this design system. */
    background: var(--bg);
    color: var(--text-primary);
    border: 2px solid var(--line-strong);
    padding: 20px 24px 26px;
    box-sizing: border-box;
    overflow-wrap: anywhere;
  }
  .dr-panel:focus {
    outline: none;
  }

  .dr-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 1px solid var(--line-strong);
    padding-bottom: 12px;
  }
  .dr-head-left {
    min-width: 0;
  }
  .dr-head-right {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
  }
  .dr-kicker,
  .dr-label,
  .dr-id {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  .dr-title {
    font-family: var(--font-display);
    font-size: var(--fs-display-sm);
    line-height: 1.02;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 5px 0 0;
  }
  .dr-btn {
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 6px 11px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
  }
  .dr-btn:hover,
  .dr-btn:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }

  .dr-statement {
    font-size: var(--fs-body);
    line-height: 1.6;
    margin: 15px 0 0;
    max-width: 66ch;
    text-wrap: pretty;
  }

  .dr-band-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .dr-band {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 4px 8px;
    border: 1px solid var(--line-strong);
  }
  .dr-band.on-dark {
    color: var(--bg);
  }

  .dr-factors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 10px 20px;
    margin: 12px 0 0;
  }
  .dr-factor dd {
    margin: 5px 0 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dr-track {
    flex: 1 1 auto;
    height: 7px;
    background: var(--surface-sunken);
    border: 1px solid var(--line);
  }
  .dr-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .dr-pct {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  .dr-lines {
    display: grid;
    gap: 8px;
    margin-top: 18px;
  }
  .dr-lines p {
    margin: 0;
    line-height: 1.6;
    max-width: 66ch;
  }
  .dr-counter {
    background: var(--surface-sunken);
    border-left: 2px solid var(--accent-ink);
    padding: 10px 13px;
  }
  .dr-muted {
    color: var(--text-muted);
    font-size: var(--fs-label);
    line-height: 1.5;
    margin: 4px 0 0;
  }

  .dr-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin: 20px 0 0;
  }
  .dr-fact {
    background: var(--bg);
    padding: 11px 13px;
    min-width: 0;
  }
  .dr-fact-value {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    margin: 6px 0 0;
    text-transform: capitalize;
  }

  .dr-quote {
    border-left: 2px solid var(--accent);
    padding-left: 15px;
    white-space: pre-wrap;
    margin: 20px 0 0;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .dr-refs {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--divider);
  }
  .dr-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 9px;
  }
  .dr-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 5px 9px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    max-width: 100%;
  }
  .dr-chip:hover,
  .dr-chip:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .dr-chip-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    flex: 0 0 auto;
  }

  .dr-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent-ink);
  }

  .dr-raw {
    margin-top: 20px;
  }
  .dr-raw summary {
    cursor: pointer;
    padding: 9px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dr-raw summary:hover {
    color: var(--accent);
  }

  .dr-id {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
    color: var(--text-ghost);
    text-transform: none;
    letter-spacing: 0.04em;
  }

  /* The drill is a layer over the page; on paper there is no page to be over,
     and the artefact it holds is already printed in its own section. */
  @media print {
    .dr-backdrop {
      display: none !important;
    }
  }
</style>
