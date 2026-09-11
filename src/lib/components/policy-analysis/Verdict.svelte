<script lang="ts">
  // THE VERDICT — what a reader with ninety seconds takes away.
  //
  // Ask 1: the verdict is the headline story, but SUMMARISED — the opening
  // paragraph and the four factors show, and the rest drills down. Synthesis
  // writes several paragraphs of executive assessment and the page used to print
  // all of them at display size, so the "headline" was a page of prose and the
  // reader had to find the sentence that mattered.
  //
  // THE CONCLUSION RUNS THE MEASURE (2026-09-11). The factors used to sit in a
  // right-hand column, which wrapped the one sentence the whole assessment
  // exists to deliver at 34 characters and — the factors always being the taller
  // column — left a screenful of empty cream beside it. They are below it now,
  // paired with the band ranking that used to close the page: both say WHY the
  // paper is exposed, which no single count does, and reading one three screens
  // after the other gave a reader two impressions of the same eleven plays.
  // Twelve plays averaging high incentive and low concealment is a different
  // policy problem from twelve averaging high ease — the first needs a design
  // change, the second a control — and both would otherwise print as "12 ways
  // to beat it".
  //
  // The band bar stays: exposure is a MAGNITUDE, so one hue stepped light to
  // dark, CVD-safe by construction, and every segment carries its band in words.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { BAND_FILL, BAND_LABEL, summarise, type ActorView, type Band, type Play } from '$lib/policy-analysis/view';
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
    /**
     * The bodies, worst play first — the verdict's lead into step 03.
     *
     * Nothing on this page pointed at the cast before, so "who is involved" was
     * a rail cell a reader had to decide to press rather than somewhere the
     * argument sent them.
     */
    actors?: ActorView[];
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

  let { headline, tiles, bands, plays, status, thin = [], actors = [], lever = null, options = [], onopen, onband, ontab }: Props =
    $props();

  /**
   * THE SHORT VERSION.
   *
   * The verdict page carried a headline, four factor bars, four counts and a
   * band strip — and named not one single thing. A reader who had ninety seconds
   * left knowing the paper had "11 ways to beat it" and no idea what any of them
   * were, so the only way to act on this page was to leave it. These columns
   * name them: the worst plays, the bodies that would run them, the thinnest
   * parts of the paper, and the one assumption most of the assessment rests on.
   * Every item opens its own drill, and each column leads to the workspace that
   * holds the rest — the first two being steps 02 and 03 of the journey.
   */
  const worst = $derived(plays.slice(0, 3));

  /**
   * A tile by key.
   *
   * The four counts are still `view.tiles()` — one shaping, tested once, shared
   * with nothing else that could drift from it. What changed is where they are
   * drawn: on the columns they count rather than in a row above them that
   * repeated two of the ink ledger's four cells.
   */
  const tile = (key: string) => tiles.find((t) => t.key === key) ?? null;

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

<!--
  THE VERDICT, FULL WIDTH.

  It used to sit in the left 65% of a two-column grid with the factor bars
  beside it, so the one sentence the whole assessment exists to deliver wrapped
  at 34 characters and left a screen of empty cream underneath it — the factors
  column was always the taller of the two. The conclusion now runs the measure
  and everything that qualifies it sits below, in reading order: what it
  concludes, why it is exposed and how badly, then the specific things to open.
-->
<section class="vd" aria-label="Verdict">
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
        {#if split.rest}
          <span class="vd-more-note">
            {split.rest.length.toLocaleString()} further characters of assessment, with every result and
            hypothesis it cites.
          </span>
        {/if}
      </div>
    {:else}
      <h2 class="vd-headline vd-pending">The assessment has not reached its conclusion yet.</h2>
      <p class="vd-note">
        Stages are saved as they finish, so what is below is what has been established so far — read it as
        partial rather than as a verdict. Status: {status.replaceAll('_', ' ')}.
      </p>
    {/if}
  </div>

  <!--
    WHY, AND HOW BADLY — ONE BAND.

    These were two: four factor bars beside the headline, and the band ranking
    at the foot of the page under its own rule. Both answer the same question —
    what shape is this policy's exposure — and reading one three screens after
    the other is how a reader ends up with two impressions of it. Side by side,
    the means and the distribution are one reading.
  -->
  {#if plays.length}
    <div class="vd-why">
      <!--
        WHY the paper is exposed, in four bars. Means across the playbook,
        unweighted: weighting by exposure would fold the ranking back into its
        own inputs and make every policy look the same shape.
      -->
      <div class="vd-factors">
        <p class="vd-label">Why it is exposed — averaged over all {plays.length} plays</p>
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

      {#if total}
        <div class="vd-bands">
          <p class="vd-label">How the {total} plays rank — press a band to see only those</p>
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
    </div>
  {/if}

  <!-- ————————————————————————— THE SHORT VERSION ————— -->
  <!--
    ONE FIGURE SYSTEM, NOT TWO.

    A row of four big counts sat above this grid and repeated it: two of those
    four — the plays and the bodies — are the same figures the ink ledger prints
    six hundred pixels higher, and the other two were counts OF the very lists
    below them. So the counts moved onto the columns they count, and each column
    leads somewhere: the first two into the next two steps of the journey, the
    other two into the grounding.
  -->
  {#snippet colhead(figure: number, label: string, sub: string, term?: string)}
    <div class="vd-colhead">
      <p class="vd-figure">{figure}</p>
      <h3>{#if term}<ExplainLabel {term} text={label} as="inline" />{:else}{label}{/if}</h3>
      <p class="vd-colsub">{sub}</p>
    </div>
  {/snippet}

  {#if worst.length || actors.length || thin.length || lever}
    <div class="vd-short">
      <p class="vd-label">The short version — every line here opens</p>
      <div class="vd-short-grid">
        {#if worst.length}
          {@const t = tile('plays')}
          <section>
            {@render colhead(t?.figure ?? plays.length, t?.label ?? 'Ways to beat it', t?.sub ?? '', 'exposure')}
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

        <!--
          THE LEAD INTO STEP 03. The verdict had none: not one line on it went
          to the cast, so "who is involved" was a rail cell the reader had to
          decide to press rather than somewhere the argument sent them.
        -->
        {#if actors.length}
          {@const t = tile('actors')}
          <section>
            {@render colhead(t?.figure ?? actors.length, t?.label ?? 'Actors profiled', t?.sub ?? '')}
            <ul>
              {#each actors.slice(0, 3) as row (row.actor.id)}
                <li>
                  <button type="button" data-pa-peek={`actor:${row.actor.id}`} onclick={() => onopen(row.actor.id)}>
                    {row.actor.label}
                  </button>
                  <span class="vd-who">
                    {row.plays.length
                      ? `${row.plays.length} play${row.plays.length === 1 ? '' : 's'}, worst ${Math.round(row.worst * 100)}`
                      : 'no play of its own'}
                  </span>
                </li>
              {/each}
            </ul>
            <button type="button" class="vd-all" onclick={() => ontab?.('actors')}>
              Every body, and what moves it →
            </button>
          </section>
        {/if}

        {#if thin.length}
          {@const t = tile('checks')}
          {@const ev = tile('evidence')}
          <section>
            <!-- The fourth figure of the retired tile row rides the sub-line
                 here: an unsupported claim IS the paper being thin, measured a
                 second way, and as a clause inside the column's link it wrapped
                 to three lines. -->
            {@render colhead(
              t?.figure ?? thin.length,
              t?.label ?? 'Checks that fell short',
              [t?.sub, ev ? `${ev.figure} unsupported ${ev.sub}` : null].filter(Boolean).join(' · '),
              'indeterminate',
            )}
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
            <!-- The fourth figure of the retired tile row. It belongs here: an
                 unsupported claim is the paper being thin, measured a second
                 way. -->
            <button type="button" class="vd-all" onclick={() => ontab?.('checks')}>All twelve checks →</button>
          </section>
        {/if}

        {#if lever}
          <section>
            {@render colhead(
              lever.dependants,
              'Rest on one assumption',
              'the most load-bearing thing here',
            )}
            <ul>
              <li>
                <button type="button" data-pa-peek={`assumption:${lever.artefact.id}`} onclick={() => onopen(lever.artefact.id)}>
                  {lever.artefact.label}
                </button>
              </li>
            </ul>
            <button type="button" class="vd-all" onclick={() => ontab?.('stress')}>Switch it off and see →</button>
          </section>
        {/if}
      </div>
    </div>
  {/if}

  <!--
    WHAT TO DO, on its own line at the foot.

    It was a fifth column of the grid, which put an OPINION at the same weight
    as four readings — and the note saying so had to be repeated inside it. A
    strip says it once.
  -->
  {#if options.length}
    <div class="vd-options">
      <p class="vd-label">What the assessment suggests — normative judgements, not findings</p>
      <ul>
        {#each options.slice(0, 4) as option (option.id)}
          <li>
            <button type="button" data-pa-peek={`artefact:${option.id}`} onclick={() => onopen(option.id)}>
              {option.label}
            </button>
          </li>
        {/each}
        {#if options.length > 4}
          <li><button type="button" class="vd-all" onclick={() => ontab?.('report')}>All {options.length} →</button></li>
        {/if}
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
    margin: 6px 0 0;
    font-size: var(--fs-body-sm);
    font-weight: 700;
    line-height: 1.25;
    color: var(--text-primary);
    text-wrap: pretty;
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
  /*
   * WHAT TO DO — a strip, not a fifth column. As a column it carried the same
   * weight as four readings while being the only OPINION on the page, and had
   * to repeat the caveat inside itself to say so. The caveat is in the label.
   */
  .vd-options {
    margin-top: clamp(20px, 2.5vw, 28px);
    border-top: 2px solid var(--text-primary);
    padding-top: 13px;
  }
  .vd-options ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
  }
  .vd-options li {
    flex: 1 1 14rem;
    min-width: 0;
    background: var(--bg);
  }
  .vd-options li > button {
    font: inherit;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 11px 13px;
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    cursor: pointer;
  }
  .vd-options li > button:hover {
    background: var(--surface-sunken);
    color: var(--accent);
  }
  .vd-options .vd-all {
    margin: 0;
    padding: 11px 13px;
  }

  /*
   * THE VERDICT RUNS THE MEASURE.
   *
   * `.vd-top` was a 1.35fr / 0.65fr grid with the factor bars in the right-hand
   * column, so the conclusion wrapped at 34 characters and the factors — always
   * the taller column — left a screenful of empty cream beside it. There is no
   * second column here now; what qualifies the verdict sits under it.
   */
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
    /* `.policy-page p { max-width: 75ch }` is 75 characters of BODY copy; in
       12px mono that is ~600px, so a one-line label wrapped mid-clause at any
       width above it. */
    max-width: none;
  }

  .vd-headline {
    font-family: var(--font-display);
    /* Bigger, because it has the width to be: this is the one sentence the
       whole assessment exists to deliver. `max-width` is deliberately absent —
       a measure on the element is what made it a column. */
    font-size: clamp(1.5rem, 3.2vw, 2.6rem);
    line-height: 1.14;
    letter-spacing: -0.018em;
    margin: 0;
    text-wrap: balance;
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
  .vd-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 10px 0 0;
    max-width: 60ch;
  }
  /* Inline with the two buttons it describes rather than a paragraph under
     them: at full width that paragraph was one short line in a lot of cream. */
  .vd-more-note {
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-muted);
    max-width: 46ch;
  }

  /*
   * WHY IT IS EXPOSED, AND HOW BADLY — one band, two readings. They were a
   * right-hand column and a footer respectively, three screens apart, both
   * answering the same question about the same eleven plays.
   */
  .vd-why {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin-top: clamp(22px, 3vw, 32px);
  }
  .vd-why > * {
    background: var(--bg);
    min-width: 0;
    padding: 14px 16px 16px;
  }
  .vd-factors {
    min-width: 0;
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

  /*
   * THE COLUMN HEAD — what the retired tile row became. The figure keeps its
   * display size, because a count a reader acts on should not shrink just
   * because it moved onto the thing it counts.
   */
  .vd-colhead {
    /* A FLOOR, so the four heads share a baseline and the lists under them
       start on one line. Each column is its own flow, so a two-line sub-label
       in one otherwise drops that column's list 30px below its neighbours'. */
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    min-height: 6.6rem;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line-strong);
  }
  .vd-colhead .vd-colsub {
    margin-top: auto;
    padding-top: 3px;
  }
  .vd-figure {
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 3.4vw, 2.5rem);
    line-height: 1;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .vd-colsub {
    margin: 3px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .vd-bands {
    min-width: 0;
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
  /* A GRID, not a wrapping flex row. In half the width the band's note wrapped
     to its own line and left "Significant" stranded above it, reading as a
     heading over the next entry. */
  .vd-band-key li {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    gap: 4px 9px;
    align-items: baseline;
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
       label — measured on the retired tile row, which broke between the two. */
    .vd-colhead,
    .vd-factors,
    .vd-bands,
    .vd-short-grid section {
      break-inside: avoid;
    }
    /* Cream is the site's ground, not the paper's — a grid that paints it
       prints as a block of toner carrying nothing. The hairlines still separate
       the cells. */
    .vd-why > *,
    .vd-why,
    .vd-options li,
    .vd-options ul {
      background: #fff;
    }
    /* One column on paper: the band grids tile to the page width and a
       two-up reading of the same eleven plays wastes half a sheet. */
    .vd-why {
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
