<script lang="ts">
  // THE STRESS TEST — the one thing on this page you can run rather than read.
  //
  // The arithmetic has never been the problem and is untouched: `stress.ts`
  // walks citations the assessment already made, so the same switches always
  // give the same answer and no model runs. Everything here is about the
  // reading.
  //
  // 2026-09-11, John: *"fix that 'what if we are wrong' page. the layout is not
  // clean; needs a dashboard page, ideally close to single page view."*
  //
  // MEASURED BEFORE TOUCHING IT, at 1440 on the nine-body seed: 785px at rest
  // and 1,468px with three levers pulled — two and a half screens for a panel
  // whose whole point is that you pull a lever and SEE the answer. Three causes,
  // and none of them was the layout being two columns:
  //
  //  * EVERY ROW WAS THREE LINES. `.sl-why` carried `width: 100%` inside a
  //    wrapping flex row, so the tag, the name and the reason each took a line.
  //    Twenty-two results is sixty-six lines.
  //  * THE REASON WAS THE SAME REASON, EIGHT TIMES. Fail one assumption and
  //    every conclusion that falls says `rests on "<that assumption>"`. It is
  //    the group's caption, not the row's.
  //  * THE LEVER RAIL WAS THE TALLEST THING ON THE PAGE. Fourteen levers each
  //    repeating "38% on how much turns on it, how arguable it is and what it
  //    would cost" ran to ~810px, which set the height of the whole workspace
  //    before a single result was drawn.
  //
  // So: one line per lever with its weight as a figure, one line per result,
  // the shared cause said once, and a cap on what is drawn before the drill
  // takes over. Same numbers, same module, one view.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { leverage, stress, type StressRow } from '$lib/policy-analysis/stress';
  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    artefacts: Artefact[];
    onopen: (id: string) => void;
  }

  let { artefacts, onopen }: Props = $props();

  let failed = $state<string[]>([]);
  /** Levers drawn before the rail asks to be opened, and after. */
  const RAIL = 9;
  const ALL_LEVERS = 24;
  /**
   * Results drawn per group before the count takes over.
   *
   * The conclusions are what a reader actually reads; a model or scenario
   * losing its footing is a consequence of the same failure and is worth its
   * COUNT rather than its eighteen names, which is what made this column twice
   * the height of the one beside it. The drill holds all of them either way.
   */
  const SHOWN = 5;
  let allLevers = $state(false);

  const levers = $derived(leverage(artefacts));
  const railLevers = $derived(levers.slice(0, allLevers ? ALL_LEVERS : RAIL));
  const result = $derived(stress(artefacts, failed));

  /**
   * WHAT THE RESTING PANEL SAYS.
   *
   * With nothing switched off the right-hand half used to be three paragraphs
   * explaining what would happen if you did, beside four zeroes — half a
   * workspace spent telling the reader they had not used it yet. It PREVIEWS
   * instead: the same computation, run against the single most load-bearing
   * assumption, so the panel arrives already showing what is at stake and the
   * reader can commit to it with one button. Costs nothing — the whole module
   * is a walk over citations that already exist.
   */
  const top = $derived(levers[0] ?? null);
  const preview = $derived(top ? stress(artefacts, [top.artefact.id]) : null);
  const hurt = (rows: StressRow[]) => rows.filter((r) => r.standing !== 'holds');

  const lostFindings = $derived(hurt(result.findings));
  const lostRecommendations = $derived(hurt(result.recommendations));
  const lostReasoning = $derived([...hurt(result.models), ...hurt(result.scenarios)]);
  const disarmed = $derived(hurt(result.plays));

  /** Denominators, so a count reads as a share of something rather than alone. */
  const totals = $derived({
    findings: result.findings.length,
    recommendations: result.recommendations.length,
    reasoning: result.models.length + result.scenarios.length,
    plays: result.plays.length,
  });

  const byId = $derived(new Map(artefacts.map((a) => [a.id, a])));
  const chosen = $derived(failed.map((id) => byId.get(id)).filter((a): a is Artefact => Boolean(a)));

  /**
   * The one cause every row in a group shares, or null if they differ.
   *
   * Fail a single assumption and all fifteen conclusions fall for the same
   * stated reason, so printing it per row is fourteen wasted lines that also
   * push the name of each conclusion onto a line of its own. Said once as the
   * group's caption, the rows become one line each and the reason is more
   * prominent rather than less.
   */
  const sharedCause = (rows: StressRow[]): string | null => {
    const first = rows[0]?.because[0];
    if (!first) return null;
    return rows.every((r) => r.because[0] === first) ? first : null;
  };

  function toggle(id: string) {
    failed = failed.includes(id) ? failed.filter((f) => f !== id) : [...failed, id];
  }
</script>

<!--
  ONE RESULT ROW, drawn the same way in both columns.

  The tag, the name and the reason on ONE line: the name is the only part that
  may grow, so it takes the free space and clips, and the reason is dropped
  entirely when the group's caption already carries it. `title` keeps the full
  wording reachable without arming a popover on every row — the drill is one
  click away and holds all of it.
-->
{#snippet resultRow(row: StressRow, kind: 'play' | 'artefact', tag: string, showWhy: boolean)}
  <li>
    <span class="sl-tag" class:gone={row.standing === 'unsupported'} class:sl-off={kind === 'play'}>{tag}</span>
    <button
      type="button"
      class="sl-link"
      data-pa-peek={`${kind}:${row.artefact.id}`}
      onclick={() => onopen(row.artefact.id)}
      title={row.artefact.label}
    >{row.artefact.label}</button>
    {#if showWhy && row.because[0]}<span class="sl-why" title={row.because[0]}>{row.because[0]}</span>{/if}
  </li>
{/snippet}

{#if levers.length}
  <div class="sl">
    <!--
      THE CONSEQUENCE STRIP. Four figures, always present, so a lever pulled at
      the bottom of the rail changes something in the reader's eyeline. Zeroes
      are shown rather than hidden: "nothing moves" is an answer, and an empty
      strip would read as a page that had not finished loading.
    -->
    <div class="sl-strip" aria-live="polite">
      <div class="sl-figure" class:live={failed.length > 0}>
        <p class="sl-figure-value">{failed.length}</p>
        <p class="sl-figure-label">Assumptions failed</p>
      </div>
      <div class="sl-figure" class:live={lostFindings.length > 0}>
        <p class="sl-figure-value">{lostFindings.length}<span class="sl-of">/{totals.findings}</span></p>
        <p class="sl-figure-label">Conclusions lose footing</p>
      </div>
      <div class="sl-figure" class:live={lostRecommendations.length > 0}>
        <p class="sl-figure-value">{lostRecommendations.length}<span class="sl-of">/{totals.recommendations}</span></p>
        <p class="sl-figure-label">Redesign options fall</p>
      </div>
      <div class="sl-figure sl-good" class:live={disarmed.length > 0}>
        <p class="sl-figure-value">{disarmed.length}<span class="sl-of">/{totals.plays}</span></p>
        <p class="sl-figure-label"><ExplainLabel term="disarmed" text="Plays disarmed" /></p>
      </div>
    </div>

    <div class="sl-body">
      <!-- THE LEVERS. Sticky, so the consequence is never out of sight of the
           thing that caused it. -->
      <aside class="sl-levers" aria-label="Assumptions to fail">
        <!--
          A COLUMN HEADING, not a sentence per row. The weight each lever carries
          is the only per-row figure worth showing and it is the rail's sort
          order, so it becomes a column with a name at the top. The priority
          score that used to be spelled out fourteen times is what the ordering
          IS; the card on each row still carries it.
        -->
        <div class="sl-lever-head">
          <p class="sl-label">Suppose these fail</p>
          <p class="sl-label sl-lever-head-n">Rests on it</p>
        </div>
        <ul class="sl-lever-list">
          {#each railLevers as lever (lever.artefact.id)}
            {@const on = failed.includes(lever.artefact.id)}
            <li class:on>
              <!--
                THE PEEK ANCHOR IS THE LABEL, NOT THE SPAN INSIDE IT.

                `peekHandlers` resolves through `closest('[data-pa-peek]')`, and
                a `<span>` cannot take focus — so on the span the explainer was
                pointer-only and did not exist for a keyboard at all. On the
                `<label>`, focusing the checkbox it wraps climbs to it and the
                card opens. Same rule as the retired `field` kind: never a
                tabindex on non-interactive content, anchor to something that
                already takes focus.
              -->
              <label class="sl-lever" data-pa-peek={`assumption:${lever.artefact.id}`}>
                <input type="checkbox" checked={on} onchange={() => toggle(lever.artefact.id)} />
                <span class="sl-lever-label" title={lever.artefact.label}>{lever.artefact.label}</span>
                <span class="sl-lever-n">{lever.dependants}</span>
              </label>
            </li>
          {/each}
        </ul>
        <div class="sl-lever-actions">
          <button type="button" class="sl-link" onclick={() => (failed = levers.slice(0, 3).map((l) => l.artefact.id))}>
            Fail the top three
          </button>
          {#if failed.length}
            <button type="button" class="sl-link" onclick={() => (failed = [])}>Reset</button>
          {/if}
          {#if levers.length > RAIL}
            <button type="button" class="sl-link" onclick={() => (allLevers = !allLevers)}>
              {allLevers ? 'Show fewer' : `All ${Math.min(levers.length, ALL_LEVERS)}`}
            </button>
          {/if}
        </div>
        <p class="sl-intro">
          Ordered by how much turns on each. Only assumptions something actually cites are offered — a switch
          that does nothing when you pull it is a worse answer than no switch at all.
        </p>
        <!--
          WHAT IS NOT WIRED TO ANY OF THESE SWITCHES belongs beside the switches.
          It sat under the outcome as a full-width footer, where it read as a
          footnote to the results rather than as a property of the levers — and
          it left this column empty for half a screen while the column beside it
          ran on.
        -->
        <p class="sl-holds">
          The {result.checksHeld} structural {result.checksHeld === 1 ? 'check is' : 'checks are'} untouched by
          every switch here. They walk the relationships the paper itself states, so they are the part of the
          assessment that does not move when a hypothesis does.
        </p>
      </aside>

      <div class="sl-outcome">
        {#if !failed.length}
          <!--
            THE PREVIEW, laid out as the answer it is rather than as a paragraph
            about an answer: the same three figures the strip will show, against
            the assumption the most of the assessment rests on, and one button
            to commit to it.
          -->
          <div class="sl-resting">
            <p class="sl-resting-head">Nothing is switched off. This is the assessment as written.</p>
            {#if top && preview}
              <p class="sl-preview-head">
                If just one thing were wrong — <strong>{top.artefact.label}</strong>, the assumption the most
                of this assessment rests on — here is what would move.
              </p>
              <div class="sl-preview">
                <div>
                  <p class="sl-preview-fig">{hurt(preview.findings).length}<span class="sl-of">/{preview.findings.length}</span></p>
                  <p class="sl-figure-label">Conclusions lose footing</p>
                </div>
                <div>
                  <p class="sl-preview-fig">{hurt(preview.recommendations).length}<span class="sl-of">/{preview.recommendations.length}</span></p>
                  <p class="sl-figure-label">Redesign options fall</p>
                </div>
                <div>
                  <p class="sl-preview-fig sl-good-fig">{preview.plays.filter((r) => r.standing === 'disarmed').length}<span class="sl-of">/{preview.plays.length}</span></p>
                  <p class="sl-figure-label">Plays disarmed</p>
                </div>
              </div>
              <button type="button" class="sl-preview-run" onclick={() => (failed = [top.artefact.id])}>
                Switch it off and show me →
              </button>
            {:else}
              <p>
                Switch an assumption off on the left and this recomputes in front of you: which conclusions
                lose their footing, which redesign options lose the finding behind them, and which plays stop
                being available at all.
              </p>
            {/if}
            <p class="sl-intro">
              Nothing here is a prediction and nothing calls a model. It walks the citations the assessment
              already made, so the same switches always give the same answer — which is the difference
              between a sensitivity analysis and a second guess.
            </p>
          </div>
        {:else}
          <div class="sl-chosen">
            <p class="sl-label">Holding false</p>
            <div class="sl-chips">
              {#each chosen as a (a.id)}
                <button type="button" class="sl-chip" data-pa-peek={`assumption:${a.id}`} onclick={() => toggle(a.id)}>
                  {a.label} <span class="sl-chip-x" aria-hidden="true">✕</span>
                </button>
              {/each}
            </div>
          </div>

          <!--
            THE TWO DIRECTIONS, side by side and named.
            `stress.ts`: "A conclusion that rests on a false hypothesis loses its
            footing. A play whose precondition fails is DISARMED — the actor
            needed that to be true, so a failed assumption is good news for the
            policy here and bad news three lines above." Two columns is the only
            layout that says that without a paragraph explaining it.

            `align-content: start` on each column: they hold different numbers of
            rows and stretching the shorter one left its rule floating half a
            screen below its last item.
          -->
          <div class="sl-columns">
            <section class="sl-column sl-loses">
              <header>
                <p class="sl-column-kicker">Bad news for the assessment</p>
                <h4>What stops standing</h4>
              </header>

              {#if lostFindings.length}
                {@const cause = sharedCause(lostFindings)}
                <div class="sl-group">
                  <p class="sl-group-head">
                    <span class="sl-group-n">{lostFindings.length}<span class="sl-of">/{totals.findings}</span></span>
                    {lostFindings.length === 1 ? 'conclusion loses' : 'conclusions lose'} footing
                  </p>
                  <p class="sl-note">
                    {#if cause}All {cause} — {/if}not shown to be wrong,
                    <ExplainLabel term="standing" text="no longer supported" as="inline" /> by what was cited for them.
                  </p>
                  <ul>
                    {#each lostFindings.slice(0, SHOWN) as row (row.artefact.id)}
                      {@render resultRow(row, 'artefact', row.standing, !cause)}
                    {/each}
                  </ul>
                  {#if lostFindings.length > SHOWN}
                    <p class="sl-more">and {lostFindings.length - SHOWN} more — open one to read why</p>
                  {/if}
                </div>
              {/if}

              {#if lostRecommendations.length}
                {@const cause = sharedCause(lostRecommendations)}
                <div class="sl-group">
                  <p class="sl-group-head">
                    <span class="sl-group-n">{lostRecommendations.length}<span class="sl-of">/{totals.recommendations}</span></span>
                    redesign {lostRecommendations.length === 1 ? 'option loses' : 'options lose'} the finding behind it
                  </p>
                  <ul>
                    {#each lostRecommendations.slice(0, SHOWN) as row (row.artefact.id)}
                      {@render resultRow(row, 'artefact', row.standing, !cause)}
                    {/each}
                  </ul>
                  {#if lostRecommendations.length > SHOWN}
                    <p class="sl-more">and {lostRecommendations.length - SHOWN} more</p>
                  {/if}
                </div>
              {/if}

              <!--
                THE REASONING IS A COUNT, NOT A LIST.

                Eighteen rows reading "Synthetic model principal_agent" told a
                reader nothing they could act on and made this column twice the
                height of the one beside it. A model or scenario losing its
                footing is the same failure already stated above, counted a
                second way — so it gets the figure and a route to the rest.
              -->
              {#if lostReasoning.length}
                <p class="sl-also">
                  <span class="sl-group-n">{lostReasoning.length}<span class="sl-of">/{totals.reasoning}</span></span>
                  {lostReasoning.length === 1 ? 'model or scenario stops' : 'models and scenarios stop'} standing —
                  <button
                    type="button"
                    class="sl-link"
                    data-pa-peek={`artefact:${lostReasoning[0].artefact.id}`}
                    onclick={() => onopen(lostReasoning[0].artefact.id)}
                  >open the first</button>
                </p>
              {/if}

              {#if !lostFindings.length && !lostRecommendations.length && !lostReasoning.length}
                <p class="sl-note sl-nothing">Nothing the assessment concluded depends on these. That is itself worth knowing.</p>
              {/if}
            </section>

            <section class="sl-column sl-gains">
              <header>
                <p class="sl-column-kicker">Good news for the policy</p>
                <h4>What comes off the table</h4>
              </header>

              {#if disarmed.length}
                {@const cause = sharedCause(disarmed)}
                <div class="sl-group">
                  <p class="sl-group-head">
                    <span class="sl-group-n">{disarmed.length}<span class="sl-of">/{totals.plays}</span></span>
                    {disarmed.length === 1 ? 'play is' : 'plays are'} disarmed
                  </p>
                  <p class="sl-note">
                    {#if cause}All {cause} — the{:else}The{/if} actor needed that to be true to run it. Same switch, opposite
                    direction, which is why the two are never added into one number.
                  </p>
                  <ul>
                    {#each disarmed.slice(0, SHOWN) as row (row.artefact.id)}
                      {@render resultRow(row, 'play', 'off the table', !cause)}
                    {/each}
                  </ul>
                  {#if disarmed.length > SHOWN}
                    <p class="sl-more">and {disarmed.length - SHOWN} more</p>
                  {/if}
                </div>
              {:else}
                <p class="sl-note sl-nothing">
                  No play needed any of these to be true. Every one of them stays available whether the
                  assumption holds or not.
                </p>
              {/if}
            </section>
          </div>
        {/if}

      </div>
    </div>
  </div>
{:else}
  <p class="sl-nothing sl-note">
    No assumption in this assessment is cited by a model, scenario, play or finding, so there is nothing to
    stress yet.
  </p>
{/if}

<style>
  /* ——— the consequence strip ————————————————————————————————— */
  .sl-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin-top: 20px;
  }
  .sl-figure {
    background: var(--bg);
    padding: 12px 14px;
    min-width: 0;
  }
  .sl-figure-value {
    font-family: var(--font-display);
    font-size: var(--fs-num-md);
    line-height: 1;
    margin: 0;
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .sl-figure.live .sl-figure-value {
    color: var(--accent);
  }
  /* The disarmed count is the one figure here that is good news, so it takes
     the counter-accent rather than the accent. Never --good beside --accent:
     the pair fails colourblind separation. */
  .sl-figure.sl-good.live .sl-figure-value {
    color: var(--accent-ink);
  }
  /*
   * A DENOMINATOR, because a bare count is not a magnitude.
   *
   * "15 conclusions lose footing" reads the same on an assessment with fifteen
   * conclusions and one with ninety, and those are opposite findings. It is set
   * small and muted so the figure it qualifies still leads.
   */
  .sl-of {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0;
    color: var(--text-muted);
  }
  .sl-figure-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 7px 0 0;
  }

  /* ——— the two halves ———————————————————————————————————————— */
  .sl-body {
    display: grid;
    grid-template-columns: minmax(14rem, 19rem) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
    margin-top: 20px;
  }
  .sl-levers {
    position: sticky;
    top: calc(var(--site-nav-height, 0px) + 3.6rem);
    min-width: 0;
  }
  .sl-outcome {
    min-width: 0;
  }

  .sl-label,
  .sl-column-kicker,
  .sl-group-head,
  .sl-tag,
  .sl-more {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    margin: 0;
  }
  .sl-label {
    color: var(--text-muted);
  }
  .sl-intro,
  .sl-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 8px 0 0;
    max-width: 68ch;
  }
  .sl-nothing {
    border-left: 2px solid var(--line-strong);
    padding-left: 13px;
  }

  /* ——— the lever rail ———————————————————————————————————————— */
  /*
   * ONE LINE PER LEVER, and the weight as a COLUMN.
   *
   * Each row used to carry a sentence — "3 things rest on it · 38% on how much
   * turns on it, how arguable it is and what it would cost" — repeated verbatim
   * fourteen times, which ran the rail to ~810px and set the height of the whole
   * workspace before a single result was drawn. The sentence is the rail's sort
   * order; it is stated once under the list.
   */
  .sl-lever-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 7px;
  }
  .sl-lever-head-n {
    text-align: right;
    flex: 0 0 auto;
  }
  .sl-lever-list {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--line-strong);
  }
  .sl-lever-list li {
    border-bottom: 1px solid var(--line);
  }
  .sl-lever-list li.on {
    background: var(--accent-tint-08);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .sl-lever {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px 7px 8px;
    cursor: pointer;
  }
  .sl-lever input {
    accent-color: var(--accent);
    flex: 0 0 auto;
  }
  /* The name is the only part that may grow, so it takes the free space and
     clips; `title` keeps the full wording without arming a popover per row. */
  .sl-lever-label {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--fs-label);
    line-height: 1.35;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-bottom: 1px dotted var(--line-strong);
  }
  .sl-lever-n {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .sl-lever-list li.on .sl-lever-n {
    color: var(--accent);
  }
  .sl-lever-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 11px 0 0;
  }

  /* ——— the resting preview ——————————————————————————————————— */
  .sl-resting-head {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.15;
    margin: 0 0 10px;
  }
  .sl-resting p {
    line-height: 1.6;
    max-width: 68ch;
  }
  .sl-preview-head {
    margin: 10px 0 0;
    line-height: 1.55;
  }
  /* The same shape as the strip it is previewing, so the reader recognises the
     answer when it arrives rather than reading a second format for it. */
  .sl-preview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin: 14px 0 0;
  }
  .sl-preview > div {
    background: var(--bg);
    padding: 11px 13px;
    min-width: 0;
  }
  .sl-preview-fig {
    font-family: var(--font-display);
    font-size: var(--fs-num-md);
    line-height: 1;
    margin: 0;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .sl-good-fig {
    color: var(--accent-ink);
  }
  .sl-preview-run {
    font: inherit;
    margin-top: 14px;
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 7px 11px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .sl-preview-run:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ——— what is holding false ————————————————————————————————— */
  .sl-chosen {
    margin-bottom: 16px;
  }
  .sl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 8px;
  }
  .sl-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: var(--accent-tint-14);
    border: 1px solid var(--accent);
    border-radius: 0;
    padding: 4px 9px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }
  .sl-chip:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .sl-chip-x {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .sl-chip:hover .sl-chip-x {
    color: var(--bg);
  }

  /* ——— the two directions ———————————————————————————————————— */
  .sl-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
  }
  .sl-column {
    background: var(--bg);
    padding: 14px 16px 16px;
    min-width: 0;
    /* The columns hold different numbers of rows; stretching the shorter one
       left its content floating above half a screen of its own ground. */
    align-content: start;
  }
  .sl-column header {
    border-bottom: 1px solid var(--divider);
    padding-bottom: 9px;
    margin-bottom: 12px;
  }
  .sl-column h4 {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    margin: 5px 0 0;
  }
  .sl-loses .sl-column-kicker {
    color: var(--accent);
  }
  .sl-gains .sl-column-kicker {
    color: var(--accent-ink);
  }

  .sl-group + .sl-group {
    margin-top: 15px;
    padding-top: 13px;
    border-top: 1px solid var(--divider);
  }
  .sl-group-head {
    display: flex;
    align-items: baseline;
    gap: 7px;
    color: var(--text-primary);
  }
  .sl-group-n {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .sl-gains .sl-group-n {
    color: var(--accent-ink);
  }
  .sl-group ul {
    list-style: none;
    padding: 0;
    margin: 9px 0 0;
  }
  /*
   * ONE LINE PER RESULT. `.sl-why` carried `width: 100%` inside a wrapping flex
   * row, so the tag, the name and the reason each took a line of their own and
   * twenty-two results became sixty-six lines. The name takes the free space
   * and clips; the reason only appears at all when it is not already the
   * group's caption.
   */
  .sl-group li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--fs-label);
    border-top: 1px solid var(--divider);
    padding: 6px 0;
  }
  .sl-group li:first-child {
    border-top: 0;
  }
  .sl-tag {
    border: 1px solid var(--line-strong);
    padding: 2px 5px;
    color: var(--text-muted);
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .sl-tag.gone {
    border-color: var(--accent);
    color: var(--accent);
  }
  .sl-tag.sl-off {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  /*
   * THE NAME OUTRANKS THE REASON when the row has to give something up. Left to
   * share the row evenly they both clipped — "Synthet…" beside "needs
   * \u201cSynthe…" is two halves of nothing — and the name is the part a reader
   * scans for. The reason is capped at two fifths and the name takes the rest.
   */
  .sl-why {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 42%;
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sl-more {
    color: var(--text-muted);
    margin-top: 9px;
  }
  /* A whole group reduced to its figure. It sits on the column's rule rather
     than inside a bordered block, because it is a footnote to the two groups
     above it rather than a third thing of the same kind. */
  .sl-also {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 7px;
    margin: 15px 0 0;
    padding-top: 13px;
    border-top: 1px solid var(--divider);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .sl-also .sl-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .sl-link {
    font: inherit;
    font-size: var(--fs-label);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
  .sl-link:hover {
    color: var(--accent);
  }
  /* In a row the name is the only thing that may grow, so it clips rather than
     wrapping — `overflow-wrap: anywhere` would put it back on three lines. */
  .sl-group li .sl-link {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sl-lever-actions .sl-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .sl-holds {
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 16px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--divider);
  }

  /*
   * Below this the two outcome columns are ~310px each and a tag, a name and a
   * reason cannot share one line without all three becoming ellipses. The
   * reason goes: the group's caption already states it whenever every row
   * shares one, the row keeps it as a native `title`, and the drill holds all
   * of it. The NAME is what a reader scans for and it keeps the width.
   */
  @media (max-width: 1200px) {
    .sl-why {
      display: none;
    }
  }

  @media (max-width: 900px) {
    .sl-body {
      grid-template-columns: minmax(0, 1fr);
    }
    .sl-levers {
      position: static;
    }
  }

  /*
   * On paper the reader has no switches, so the lab prints as the assessment
   * AS WRITTEN plus the list of levers — which is the useful half: "here is
   * what this rests on, and how much rests on each". Nothing may CLIP on paper:
   * an ellipsis exists for a fixed ink strip that a page does not have.
   */
  @media print {
    .sl-strip,
    .sl-chosen,
    .sl-columns,
    .sl-lever-actions {
      display: none !important;
    }
    .sl-body {
      grid-template-columns: minmax(0, 1fr);
    }
    .sl-levers {
      position: static;
    }
    .sl-lever input {
      display: none;
    }
    .sl-lever-label,
    .sl-why,
    .sl-group li .sl-link {
      overflow: visible;
      white-space: normal;
      text-overflow: clip;
    }
  }
</style>
