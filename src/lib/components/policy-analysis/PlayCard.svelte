<script lang="ts">
  // One exploitation play, summarised.
  //
  // Ask 1: the headline story, but SUMMARISED — the opening and the four
  // factors show, and the rest drills down. The card used to carry everything:
  // statement, legality, four bars, payoff, cost, early warning, precedent and
  // counter-measure, so a playbook of twenty-six plays was a document nobody
  // reads to the end. What survives on the card is what a reader needs to decide
  // whether THIS is the play to open: who, how bad, why it ranks where it does,
  // and one line of what it would cost the policy.
  //
  // The four bars are the whole ranking, shown rather than asserted — the reader
  // can see that a play ranks high because it is easy and invisible rather than
  // because a model called it dangerous. Each bar's label explains itself on
  // hover, because "concealment" is a term of art and renaming it would make it
  // wrong.
  //
  // `counter` is the one narrative line kept, because a weakness with no answer
  // beside it reads as an accusation. Everything else is in the drill.
  import { BAND_FILL, BAND_LABEL, summarise, type Play } from '$lib/policy-analysis/view';
  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    play: Play;
    rank: number;
    /** Open the drill on an artefact. */
    onopen: (id: string) => void;
  }

  let { play, rank, onopen }: Props = $props();

  const data = $derived(play.artefact.data as Record<string, string>);
  const legality = $derived(String(data.legality ?? ''));
  const split = $derived(summarise(play.artefact.statement));
</script>

<article class="pc">
  <header class="pc-head">
    <span class="pc-rank">{rank}</span>
    <div class="pc-title">
      <h3>{play.artefact.label}</h3>
      {#if play.actor}
        <button type="button" class="pc-who" data-pa-peek={`actor:${play.actor.id}`} onclick={() => onopen(play.actor!.id)}>
          {play.actor.label}
        </button>
      {:else}
        <p class="pc-who pc-unresolved">Actor unresolved</p>
      {/if}
    </div>
    <span class="pc-band" style="background: {BAND_FILL[play.band]}" class:on-dark={play.band === 'severe'} data-pa-peek={`term:${play.band}`}>
      {BAND_LABEL[play.band]} · {Math.round(play.exposure * 100)}
    </span>
  </header>

  <p class="pc-statement">{split.lead}</p>

  {#if legality}
    <p class="pc-legality" class:compliant={legality === 'compliant'} data-pa-peek="term:legality">
      {legality === 'compliant'
        ? 'Stays within the rules as written'
        : legality === 'grey'
          ? 'Arguable either way'
          : 'Would be a breach'}
      {#if legality === 'compliant'}<span class="pc-muted"> — which is what makes it hard to answer.</span>{/if}
    </p>
  {/if}

  <dl class="pc-factors">
    {#each play.factors as factor (factor.key)}
      <div class="pc-factor">
        <dt><ExplainLabel term={factor.key} text={factor.key} /></dt>
        <dd>
          <span class="pc-track"><span class="pc-fill" style="width: {Math.round(factor.value * 100)}%"></span></span>
          <span class="pc-pct">{Math.round(factor.value * 100)}</span>
        </dd>
      </div>
    {/each}
  </dl>

  {#if data.counter}
    <p class="pc-counter"><strong>What would close it.</strong> {data.counter}</p>
  {/if}

  <button type="button" class="pc-open" data-pa-peek={`play:${play.artefact.id}`} onclick={() => onopen(play.artefact.id)}>
    What they gain, what it costs, the first sign of it{#if play.artefact.refs.length}, and its {play.artefact.refs.length} references{/if} →
  </button>

  <!-- On paper there is nothing to open, so the fields the card summarises away
       print in full underneath it. A printed playbook that carried only the
       opening line of every play would be hiding the half a meeting needs. -->
  <div class="pc-print">
    {#if split.rest}<p>{split.rest}</p>{/if}
    {#if data.motivation}<p><strong>Why they would.</strong> {data.motivation}</p>{/if}
    {#if data.payoff}<p><strong>What they get.</strong> {data.payoff}</p>{/if}
    {#if data.costToPolicy}<p><strong>What it costs the policy.</strong> {data.costToPolicy}</p>{/if}
    {#if data.earlyWarning}<p><strong>First sign of it.</strong> {data.earlyWarning}</p>{/if}
    {#if data.precedent}<p><strong>Precedent.</strong> {data.precedent}</p>{/if}
  </div>
</article>

<style>
  .pc {
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent);
    padding: 15px 17px 16px;
    background: var(--bg);
  }
  .pc-head {
    display: flex;
    gap: 13px;
    align-items: flex-start;
  }
  .pc-rank {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1;
    color: var(--text-ghost);
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .pc-title {
    flex: 1 1 auto;
    min-width: 0;
  }
  .pc-title h3 {
    font-size: var(--fs-body-lg);
    font-weight: 700;
    margin: 0;
    line-height: 1.3;
  }
  .pc-who {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    margin: 6px 0 0;
    cursor: pointer;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .pc-who:hover,
  .pc-who:focus-visible {
    color: var(--accent);
  }
  .pc-unresolved {
    color: var(--text-ghost);
    cursor: default;
    text-decoration: none;
  }
  .pc-band {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    padding: 5px 7px;
    flex: none;
    align-self: flex-start;
    border: 1px solid var(--line-strong);
  }
  .pc-band.on-dark {
    color: var(--bg);
  }

  .pc-statement {
    margin: 13px 0 0;
    line-height: 1.6;
    max-width: 70ch;
    text-wrap: pretty;
  }
  .pc-legality {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .pc-legality.compliant {
    color: var(--accent);
  }
  .pc-muted {
    color: var(--text-muted);
    font-weight: 400;
  }

  .pc-factors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 11px 20px;
    margin: 16px 0 0;
  }
  .pc-factor dd {
    margin: 6px 0 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pc-track {
    flex: 1 1 auto;
    height: 8px;
    background: var(--surface-sunken);
    border: 1px solid var(--line);
  }
  .pc-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
  }
  .pc-pct {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .pc-counter {
    margin: 15px 0 0;
    background: var(--surface-sunken);
    border-left: 2px solid var(--accent-ink);
    padding: 10px 13px;
    line-height: 1.55;
  }

  .pc-open {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 14px 0 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
  .pc-open:hover,
  .pc-open:focus-visible {
    color: var(--accent);
  }

  .pc-print {
    display: none;
  }

  @media print {
    .pc-open {
      display: none !important;
    }
    .pc-print {
      display: block;
      margin-top: 10pt;
    }
    .pc-print p {
      margin: 4pt 0 0;
      line-height: 1.5;
    }
    .pc-fill,
    .pc-band {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pc {
      break-inside: avoid;
    }
  }
</style>
