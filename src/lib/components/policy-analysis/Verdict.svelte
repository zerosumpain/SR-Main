<script lang="ts">
  // THE VERDICT — what a reader with ninety seconds takes away.
  //
  // Ask 1: the verdict is the headline story, but SUMMARISED — the opening
  // paragraph and the four factors show, and the rest drills down. Synthesis
  // writes several paragraphs of executive assessment and the page used to print
  // all of them at display size, so the "headline" was a page of prose and the
  // reader had to find the sentence that mattered.
  //
  // The four factors sit beside it because they say WHY the paper is exposed,
  // which no single count does. Twelve plays averaging high incentive and low
  // concealment is a different policy problem from twelve averaging high ease —
  // the first needs a design change, the second needs a control — and both would
  // otherwise print as "12 ways to beat it".
  //
  // The band bar stays: exposure is a MAGNITUDE, so one hue stepped light to
  // dark, CVD-safe by construction, and every segment carries its band in words.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { BAND_FILL, BAND_LABEL, summarise, type Band, type Play } from '$lib/policy-analysis/view';
  import { factorProfile } from '$lib/policy-analysis/view';
  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    headline: Artefact | null;
    tiles: { key: string; figure: number; sub: string; label: string }[];
    bands: { band: Band; note: string; count: number }[];
    plays: Play[];
    status: string;
    /** Open the drill on an artefact. */
    onopen: (id: string) => void;
    onband?: (band: Band) => void;
  }

  let { headline, tiles, bands, plays, status, onopen, onband }: Props = $props();

  const total = $derived(bands.reduce((sum, b) => sum + b.count, 0));
  const split = $derived(headline ? summarise(headline.statement) : { lead: '', rest: '' });
  const factors = $derived(factorProfile(plays));

  /** The factor the playbook scores highest on — the one-line "why". */
  const dominant = $derived(factors.length ? factors.reduce((best, f) => (f.mean > best.mean ? f : best)) : null);

  const TILE_TERM: Record<string, string> = {
    plays: 'exposure',
    checks: 'indeterminate',
    evidence: 'insufficient',
  };
</script>

<section class="vd" aria-label="Verdict">
  <div class="vd-top">
    <div class="vd-lede">
      <p class="vd-kicker">The verdict</p>
      {#if headline}
        <h2 class="vd-headline">{split.lead}</h2>
        <div class="vd-actions">
          {#if split.rest}
            <button type="button" class="vd-more" onclick={() => onopen(headline.id)}>
              Read the rest of the verdict →
            </button>
          {/if}
          <button type="button" class="vd-trace" onclick={() => onopen(headline.id)}>
            Trace it to its evidence
          </button>
        </div>
        {#if split.rest}
          <p class="vd-more-note">
            {split.rest.length.toLocaleString()} further characters of assessment, with every result and
            hypothesis it cites, open in the panel.
          </p>
        {/if}
      {:else}
        <h2 class="vd-headline vd-pending">The assessment has not reached its conclusion yet.</h2>
        <p class="vd-note">
          Stages are saved as they finish, so what is below is what has been established so far — read it as
          partial rather than as a verdict. Status: {status.replaceAll('_', ' ')}.
        </p>
      {/if}
    </div>

    {#if plays.length}
      <!--
        WHY the paper is exposed, in four bars. Means across the playbook,
        unweighted: weighting by exposure would fold the ranking back into its
        own inputs and make every policy look the same shape.
      -->
      <div class="vd-factors">
        <p class="vd-label">Across all {plays.length} plays</p>
        {#each factors as factor (factor.key)}
          <div class="vd-factor">
            <span class="vd-factor-key"><ExplainLabel term={factor.key} text={factor.label} /></span>
            <span class="vd-track"><span class="vd-fill" style="width: {Math.round(factor.mean * 100)}%"></span></span>
            <span class="vd-factor-val">{Math.round(factor.mean * 100)}</span>
          </div>
        {/each}
        {#if dominant}
          <p class="vd-factor-note">
            The playbook scores highest on <strong>{dominant.label.toLowerCase()}</strong>.
            {#if dominant.key === 'concealment'}
              That is about the paper’s own instrumentation, not about anyone’s honesty: the policy has few
              ways of noticing.
            {:else if dominant.key === 'incentive'}
              These are weaknesses goodwill will not close — somebody is actively better off.
            {:else if dominant.key === 'ease'}
              Within reach of an ordinary body on an ordinary day, so the cast matters less than the design.
            {:else}
              The plays here defeat the stated objective rather than merely bending it.
            {/if}
          </p>
        {/if}
      </div>
    {/if}
  </div>

  <div class="vd-tiles">
    {#each tiles as tile (tile.key)}
      <div class="vd-tile" data-pa-peek={TILE_TERM[tile.key] ? `term:${TILE_TERM[tile.key]}` : undefined}>
        <p class="vd-figure">{tile.figure}</p>
        <p class="vd-tile-label">{tile.label}</p>
        <p class="vd-note">{tile.sub}</p>
      </div>
    {/each}
  </div>

  {#if total}
    <div class="vd-bands">
      <p class="vd-label">How the {total} plays rank</p>
      <div
        class="vd-band-bar"
        role="img"
        aria-label={bands.filter((b) => b.count).map((b) => `${b.count} ${BAND_LABEL[b.band]}`).join(', ')}
      >
        {#each bands.filter((b) => b.count) as b (b.band)}
          <button
            type="button"
            class="vd-band-seg"
            style="flex-grow: {b.count}; background: {BAND_FILL[b.band]}"
            title={b.note}
            onclick={() => onband?.(b.band)}
          ><span class="vd-band-count" class:on-dark={b.band === 'severe'}>{b.count}</span></button>
        {/each}
      </div>
      <ul class="vd-band-key">
        {#each bands as b (b.band)}
          <li class:none={!b.count}>
            <span class="vd-swatch" style="background: {BAND_FILL[b.band]}"></span>
            <strong data-pa-peek={`term:${b.band}`}>{BAND_LABEL[b.band]}</strong>
            <span class="vd-note">{b.count} · {b.note}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .vd-top {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(15rem, 0.65fr);
    gap: clamp(24px, 4vw, 52px);
    align-items: start;
  }
  .vd-lede {
    min-width: 0;
  }

  .vd-kicker,
  .vd-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .vd-label {
    color: var(--text-muted);
    letter-spacing: var(--tracking-label);
  }

  .vd-headline {
    font-family: var(--font-display);
    font-size: clamp(1.35rem, 2.6vw, 2rem);
    line-height: 1.2;
    letter-spacing: -0.01em;
    margin: 0;
    max-width: 34ch;
    text-wrap: pretty;
  }
  .vd-pending {
    color: var(--text-secondary);
  }

  .vd-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
  }
  .vd-more,
  .vd-trace {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    border-radius: 0;
    cursor: pointer;
  }
  .vd-more {
    background: var(--accent);
    border: 1px solid var(--accent);
    padding: 8px 13px;
    color: var(--bg);
  }
  .vd-more:hover,
  .vd-more:focus-visible {
    background: var(--accent-hover, var(--accent));
  }
  .vd-trace {
    background: none;
    border: 1px solid var(--line-strong);
    padding: 8px 13px;
    color: var(--text-primary);
  }
  .vd-trace:hover,
  .vd-trace:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .vd-more-note,
  .vd-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 10px 0 0;
    max-width: 60ch;
  }

  .vd-factors {
    min-width: 0;
    border: 1px solid var(--line-strong);
    padding: 14px 16px 16px;
  }
  .vd-factor {
    display: grid;
    grid-template-columns: minmax(0, 7rem) minmax(0, 1fr) 1.9rem;
    align-items: center;
    gap: 9px;
    margin-top: 8px;
  }
  .vd-factor-key {
    min-width: 0;
  }
  .vd-track {
    height: 9px;
    background: var(--surface-sunken);
    border: 1px solid var(--line);
  }
  .vd-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
  }
  .vd-factor-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-align: right;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .vd-factor-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 14px 0 0;
    padding-top: 11px;
    border-top: 1px solid var(--divider);
    text-wrap: pretty;
  }

  .vd-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin: clamp(24px, 3vw, 38px) 0 0;
  }
  .vd-tile {
    background: var(--bg);
    padding: 14px 15px;
    min-width: 0;
  }
  .vd-figure {
    font-family: var(--font-display);
    font-size: clamp(1.9rem, 4vw, 2.7rem);
    line-height: 1;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .vd-tile-label {
    font-weight: 700;
    margin: 7px 0 3px;
  }

  .vd-bands {
    margin-top: clamp(24px, 3vw, 34px);
  }
  .vd-band-bar {
    display: flex;
    /* 2px surface gap between segments, per the mark spec. */
    gap: 2px;
    height: 2.4rem;
  }
  .vd-band-seg {
    border: 0;
    border-radius: 0;
    padding: 0;
    cursor: pointer;
    min-width: 2.2rem;
    display: grid;
    place-items: center;
  }
  .vd-band-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .vd-band-count.on-dark {
    color: var(--bg);
  }
  .vd-band-key {
    list-style: none;
    padding: 0;
    margin: 12px 0 0;
    display: grid;
    gap: 6px;
  }
  .vd-band-key li {
    display: flex;
    gap: 9px;
    align-items: baseline;
    flex-wrap: wrap;
    font-size: var(--fs-label);
  }
  .vd-band-key li.none {
    opacity: 0.45;
  }
  .vd-band-key .vd-note {
    margin: 0;
  }
  .vd-swatch {
    width: 0.8rem;
    height: 0.8rem;
    border: 1px solid var(--line-strong);
    flex: none;
    align-self: center;
  }

  @media (max-width: 900px) {
    .vd-top {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media print {
    .vd-actions {
      display: none !important;
    }
    .vd-top {
      grid-template-columns: minmax(0, 1fr);
    }
    .vd-band-seg,
    .vd-swatch,
    .vd-fill {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
