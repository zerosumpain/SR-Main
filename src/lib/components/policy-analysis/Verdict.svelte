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
    /** The structural checks that did not come back covered, worst first. */
    thin?: Artefact[];
    /** The assumption the most of the assessment rests on, and how much. */
    lever?: { artefact: Artefact; dependants: number } | null;
    /** Redesign options — opinions, and labelled as such. */
    options?: Artefact[];
    /** Open the drill on an artefact. */
    onopen: (id: string) => void;
    onband?: (band: Band) => void;
    /** Switch workspace — the short version's four columns each lead somewhere. */
    ontab?: (id: string) => void;
  }

  let { headline, tiles, bands, plays, status, thin = [], lever = null, options = [], onopen, onband, ontab }: Props =
    $props();

  /**
   * THE SHORT VERSION.
   *
   * The verdict page carried a headline, four factor bars, four counts and a
   * band strip — and named not one single thing. A reader who had ninety seconds
   * left knowing the paper had "11 ways to beat it" and no idea what any of them
   * were, so the only way to act on this page was to leave it. These four
   * columns name them: the worst plays, the thinnest parts of the paper, the one
   * assumption most of the assessment rests on, and what the assessment suggests
   * doing. Every item opens its own drill, and each column also leads to the
   * workspace that holds the rest.
   */
  const worst = $derived(plays.slice(0, 3));

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
      <div class="vd-tile">
        <p class="vd-figure">{tile.figure}</p>
        <!-- Same reason as DashHead: an explainer on the tile itself could only
             be opened with a pointer. -->
        {#if TILE_TERM[tile.key]}
          <p class="vd-tile-label"><ExplainLabel term={TILE_TERM[tile.key]} text={tile.label} /></p>
        {:else}
          <p class="vd-tile-label">{tile.label}</p>
        {/if}
        <p class="vd-note">{tile.sub}</p>
      </div>
    {/each}
  </div>

  <!-- ————————————————————————— THE SHORT VERSION ————— -->
  {#if worst.length || thin.length || lever || options.length}
    <div class="vd-short">
      <p class="vd-label">The short version — every line here opens</p>
      <div class="vd-short-grid">
        {#if worst.length}
          <section>
            <h3>The worst ways in</h3>
            <ul>
              {#each worst as play (play.artefact.id)}
                <li>
                  <span
                    class="vd-chip"
                    style="background: {BAND_FILL[play.band]}"
                    class:on-dark={play.band === 'severe'}
                  >{Math.round(play.exposure * 100)}</span>
                  <button type="button" data-pa-peek={`play:${play.artefact.id}`} onclick={() => onopen(play.artefact.id)}>
                    {play.artefact.label}
                  </button>
                  <span class="vd-who">{play.actor?.label ?? 'body unresolved'}</span>
                </li>
              {/each}
            </ul>
            {#if plays.length > worst.length}
              <button type="button" class="vd-all" onclick={() => ontab?.('playbook')}>
                All {plays.length} ranked →
              </button>
            {/if}
          </section>
        {/if}

        {#if thin.length}
          <section>
            <h3>Where the paper is thin</h3>
            <ul>
              {#each thin.slice(0, 3) as check (check.id)}
                <li>
                  <button type="button" data-pa-peek={`check:${check.id}`} onclick={() => onopen(check.id)}>
                    {check.label}
                  </button>
                  <span class="vd-who">{String(check.data.result).replaceAll('_', ' ')}</span>
                </li>
              {/each}
            </ul>
            <button type="button" class="vd-all" onclick={() => ontab?.('checks')}>All twelve checks →</button>
          </section>
        {/if}

        {#if lever}
          <section>
            <h3>What most of it rests on</h3>
            <ul>
              <li>
                <button type="button" data-pa-peek={`assumption:${lever.artefact.id}`} onclick={() => onopen(lever.artefact.id)}>
                  {lever.artefact.label}
                </button>
                <span class="vd-who">
                  {lever.dependants}
                  {lever.dependants === 1 ? 'part of the assessment rests' : 'parts of the assessment rest'} on it
                </span>
              </li>
            </ul>
            <button type="button" class="vd-all" onclick={() => ontab?.('stress')}>Switch it off and see →</button>
          </section>
        {/if}

        {#if options.length}
          <section>
            <h3>What the assessment suggests</h3>
            <ul>
              {#each options.slice(0, 3) as option (option.id)}
                <li>
                  <button type="button" data-pa-peek={`artefact:${option.id}`} onclick={() => onopen(option.id)}>
                    {option.label}
                  </button>
                </li>
              {/each}
            </ul>
            <!-- Said here as well as in the report, because this is the column a
                 reader in a hurry acts on and it is the only one that is an
                 opinion rather than a reading. -->
            <p class="vd-opinion">These are normative judgements, not findings.</p>
          </section>
        {/if}
      </div>
    </div>
  {/if}

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
            <strong><ExplainLabel term={b.band} text={BAND_LABEL[b.band]} as="inline" /></strong>
            <span class="vd-note">{b.count} · {b.note}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .vd-short {
    margin-top: clamp(22px, 3vw, 34px);
    border-top: 2px solid var(--text-primary);
    padding-top: clamp(14px, 1.8vw, 20px);
  }
  .vd-short-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
  }
  .vd-short-grid section {
    background: var(--bg);
    padding: 12px 14px 14px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .vd-short-grid h3 {
    margin: 0 0 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .vd-short-grid ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 9px;
  }
  .vd-short-grid li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 7px;
    align-items: baseline;
  }
  .vd-short-grid li > button {
    font: inherit;
    grid-column: 2;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    font-weight: 600;
    font-size: var(--fs-body-sm);
    line-height: 1.3;
    color: var(--text-primary);
    cursor: pointer;
  }
  .vd-short-grid li > button:only-child,
  .vd-short-grid li > button:first-child {
    grid-column: 1 / -1;
  }
  .vd-short-grid li > button:hover {
    color: var(--accent);
  }
  .vd-chip {
    grid-row: 1;
    grid-column: 1;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 2px 5px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .vd-chip.on-dark {
    color: var(--bg);
  }
  .vd-who {
    grid-column: 1 / -1;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    line-height: 1.3;
  }
  .vd-all {
    font: inherit;
    margin-top: auto;
    padding-top: 11px;
    align-self: start;
    background: none;
    border: 0;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .vd-all:hover {
    color: var(--accent);
  }
  .vd-opinion {
    margin: 11px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }

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
    .vd-all {
      display: none !important;
    }
    .vd-chip {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .vd-actions {
      display: none !important;
    }
    /* A figure split from its label across a page break is a figure with no
       label. */
    .vd-tiles,
    .vd-factors,
    .vd-bands {
      break-inside: avoid;
    }
    /* Cream is the site's ground, not the paper's — a tile grid that paints it
       prints as a block of toner carrying nothing. The hairlines still separate
       the cells. */
    .vd-tile,
    .vd-tiles {
      background: #fff;
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
