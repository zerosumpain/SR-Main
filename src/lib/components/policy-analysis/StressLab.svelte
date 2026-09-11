<script lang="ts">
  // THE STRESS TEST — the one thing on this page you can run rather than read.
  //
  // Ask 7: "stress test layout is awful, and the user experience is not clear."
  // The arithmetic was never the problem and is untouched — `stress.ts` walks
  // citations the assessment already made, so the same switches always give the
  // same answer and no model runs. What was wrong was the reading:
  //
  //  * the consequence appeared as four stacked prose sections below the fold,
  //    so pulling a lever showed nothing until you scrolled;
  //  * the two OPPOSITE directions — a conclusion losing its footing, and a play
  //    being disarmed — were three sections apart in one column, which is the
  //    one thing `stress.ts`'s own comment says must never be blurred;
  //  * nothing said what state you were in, so a reader who had pulled two
  //    levers had no way to see which two.
  //
  // So: a consequence strip that changes the instant a lever moves, the levers
  // in a sticky rail beside it, and the two directions in two NAMED columns —
  // "the assessment loses" against "the policy gains". Same numbers, same
  // module, legible.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { leverage, stress, type StressRow } from '$lib/policy-analysis/stress';
  import ExplainLabel from './ExplainLabel.svelte';

  interface Props {
    artefacts: Artefact[];
    onopen: (id: string) => void;
  }

  let { artefacts, onopen }: Props = $props();

  let failed = $state<string[]>([]);
  /** How many levers the rail offers before it becomes a list to scroll. */
  const LEVERS = 14;
  const SHOWN = 8;

  const levers = $derived(leverage(artefacts));
  const result = $derived(stress(artefacts, failed));

  /**
   * WHAT THE RESTING PANEL SAYS.
   *
   * With nothing switched off the right-hand half used to be three paragraphs
   * explaining what would happen if you did, beside four zeroes — half a
   * workspace spent telling the reader that they had not used it yet. It
   * PREVIEWS instead: the same computation, run against the single most
   * load-bearing assumption, so the panel arrives already showing what is at
   * stake and the reader can commit to it with one button. Costs nothing — the
   * whole module is a walk over citations that already exist.
   */
  const top = $derived(levers[0] ?? null);
  const preview = $derived(top ? stress(artefacts, [top.artefact.id]) : null);
  const hurt = (rows: StressRow[]) => rows.filter((r) => r.standing !== 'holds');

  const lostFindings = $derived(hurt(result.findings));
  const lostRecommendations = $derived(hurt(result.recommendations));
  const lostReasoning = $derived([...hurt(result.models), ...hurt(result.scenarios)]);
  const disarmed = $derived(hurt(result.plays));

  const byId = $derived(new Map(artefacts.map((a) => [a.id, a])));
  const chosen = $derived(failed.map((id) => byId.get(id)).filter((a): a is Artefact => Boolean(a)));

  const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 100)}%`;

  function toggle(id: string) {
    failed = failed.includes(id) ? failed.filter((f) => f !== id) : [...failed, id];
  }
</script>

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
        <p class="sl-figure-value">{lostFindings.length}</p>
        <p class="sl-figure-label">Conclusions lose footing</p>
      </div>
      <div class="sl-figure" class:live={lostRecommendations.length > 0}>
        <p class="sl-figure-value">{lostRecommendations.length}</p>
        <p class="sl-figure-label">Redesign options fall</p>
      </div>
      <div class="sl-figure sl-good" class:live={disarmed.length > 0}>
        <p class="sl-figure-value">{disarmed.length}</p>
        <p class="sl-figure-label"><ExplainLabel term="disarmed" text="Plays disarmed" /></p>
      </div>
    </div>

    <div class="sl-body">
      <!-- THE LEVERS. Sticky, so the consequence is never out of sight of the
           thing that caused it. -->
      <aside class="sl-levers" aria-label="Assumptions to fail">
        <p class="sl-label">Suppose these turn out to be wrong</p>
        <p class="sl-intro">
          Only assumptions something actually cites are offered. A hypothesis nothing rests on cannot change
          an answer, and a switch that does nothing when you pull it is a worse answer than no switch at all.
        </p>
        <div class="sl-lever-actions">
          <button type="button" class="sl-link" onclick={() => (failed = levers.slice(0, 3).map((l) => l.artefact.id))}>
            Fail the three most load-bearing
          </button>
          {#if failed.length}
            <button type="button" class="sl-link" onclick={() => (failed = [])}>Reset</button>
          {/if}
        </div>
        <ul class="sl-lever-list">
          {#each levers.slice(0, LEVERS) as lever (lever.artefact.id)}
            {@const on = failed.includes(lever.artefact.id)}
            <li class:on>
              <label class="sl-lever">
                <input type="checkbox" checked={on} onchange={() => toggle(lever.artefact.id)} />
                <span class="sl-lever-body" data-pa-peek={`assumption:${lever.artefact.id}`}>
                  <span class="sl-lever-label">{lever.artefact.label}</span>
                  <span class="sl-lever-meta">
                    {lever.dependants} {lever.dependants === 1 ? 'thing rests on it' : 'things rest on it'}{#if lever.priority}
                      · {pct(lever.priority)} on how much turns on it, how arguable it is and what it would
                      cost{/if}
                  </span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
        {#if levers.length > LEVERS}
          <p class="sl-intro">
            {levers.length - LEVERS} further cited assumptions are not listed here. Open one from the report
            or from a play's preconditions to read it.
          </p>
        {/if}
      </aside>

      <div class="sl-outcome">
        {#if !failed.length}
          <div class="sl-resting">
            <p class="sl-resting-head">Nothing is switched off. This is the assessment as written.</p>
            {#if top && preview}
              <p class="sl-preview-head">
                If just one thing were wrong — <strong>{top.artefact.label}</strong>, the assumption the most
                of this assessment rests on — here is what would move.
              </p>
              <ul class="sl-preview">
                <li>
                  <span class="sl-preview-fig">{hurt(preview.findings).length}</span>
                  of {preview.findings.length} conclusions would lose their footing
                </li>
                <li>
                  <span class="sl-preview-fig">{hurt(preview.recommendations).length}</span>
                  of {preview.recommendations.length} redesign options would lose the finding behind them
                </li>
                <li>
                  <span class="sl-preview-fig">{preview.plays.filter((r) => r.standing === 'disarmed').length}</span>
                  plays would be disarmed — the actor needed this to be true
                </li>
              </ul>
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
          -->
          <div class="sl-columns">
            <section class="sl-column sl-loses">
              <header>
                <p class="sl-column-kicker">Bad news for the assessment</p>
                <h4>What stops standing</h4>
              </header>

              {#if lostFindings.length}
                <div class="sl-group">
                  <p class="sl-group-head">
                    {lostFindings.length}
                    {lostFindings.length === 1 ? 'conclusion loses' : 'conclusions lose'} footing
                  </p>
                  <p class="sl-note">
                    Not shown to be wrong — <ExplainLabel term="standing" text="no longer supported" as="inline" /> by what was cited for them.
                  </p>
                  <ul>
                    {#each lostFindings.slice(0, SHOWN) as row (row.artefact.id)}
                      <li>
                        <span class="sl-tag" class:gone={row.standing === 'unsupported'}>{row.standing}</span>
                        <button type="button" class="sl-link" data-pa-peek={`artefact:${row.artefact.id}`} onclick={() => onopen(row.artefact.id)}>{row.artefact.label}</button>
                        <span class="sl-why">{row.because[0]}</span>
                      </li>
                    {/each}
                  </ul>
                  {#if lostFindings.length > SHOWN}<p class="sl-note">and {lostFindings.length - SHOWN} more</p>{/if}
                </div>
              {/if}

              {#if lostRecommendations.length}
                <div class="sl-group">
                  <p class="sl-group-head">
                    {lostRecommendations.length} redesign
                    {lostRecommendations.length === 1 ? 'option loses' : 'options lose'} the finding behind it
                  </p>
                  <ul>
                    {#each lostRecommendations as row (row.artefact.id)}
                      <li>
                        <span class="sl-tag" class:gone={row.standing === 'unsupported'}>{row.standing}</span>
                        <button type="button" class="sl-link" data-pa-peek={`artefact:${row.artefact.id}`} onclick={() => onopen(row.artefact.id)}>{row.artefact.label}</button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if lostReasoning.length}
                <div class="sl-group">
                  <p class="sl-group-head">
                    {lostReasoning.length}
                    {lostReasoning.length === 1 ? 'model or scenario stops' : 'models and scenarios stop'} standing
                  </p>
                  <ul>
                    {#each lostReasoning.slice(0, 6) as row (row.artefact.id)}
                      <li><button type="button" class="sl-link" data-pa-peek={`artefact:${row.artefact.id}`} onclick={() => onopen(row.artefact.id)}>{row.artefact.label}</button></li>
                    {/each}
                  </ul>
                </div>
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
                <div class="sl-group">
                  <p class="sl-group-head">
                    {disarmed.length} {disarmed.length === 1 ? 'play is' : 'plays are'} disarmed
                  </p>
                  <p class="sl-note">
                    The actor needed that to be true to run it. Same switch, opposite direction — which is why
                    the two are never added into one number.
                  </p>
                  <ul>
                    {#each disarmed.slice(0, SHOWN) as row (row.artefact.id)}
                      <li>
                        <span class="sl-tag sl-off">off the table</span>
                        <button type="button" class="sl-link" data-pa-peek={`play:${row.artefact.id}`} onclick={() => onopen(row.artefact.id)}>{row.artefact.label}</button>
                        <span class="sl-why">{row.because[0]}</span>
                      </li>
                    {/each}
                  </ul>
                  {#if disarmed.length > SHOWN}<p class="sl-note">and {disarmed.length - SHOWN} more</p>{/if}
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

        <p class="sl-holds">
          The {result.checksHeld} structural {result.checksHeld === 1 ? 'check is' : 'checks are'} untouched by any of
          this. They walk the relationships the paper itself states, so they are the part of the assessment
          that does not move when a hypothesis does.
        </p>
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
  .sl-preview-head {
    margin: 10px 0 0;
    line-height: 1.55;
  }
  .sl-preview {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    gap: 1px;
    background: var(--line-hair);
  }
  .sl-preview li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    background: var(--bg);
    padding: 8px 0;
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .sl-preview-fig {
    font-family: var(--font-display);
    font-size: var(--fs-num-md);
    line-height: 1;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    min-width: 2ch;
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
  .sl-figure-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 7px 0 0;
  }

  .sl-body {
    display: grid;
    grid-template-columns: minmax(15rem, 21rem) minmax(0, 1fr);
    gap: 26px;
    align-items: start;
    margin-top: 22px;
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
  .sl-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    margin: 0;
  }
  .sl-label {
    color: var(--text-muted);
    margin-bottom: 9px;
  }
  .sl-intro,
  .sl-note {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 8px 0 0;
    max-width: 68ch;
  }
  .sl-nothing {
    border-left: 2px solid var(--line-strong);
    padding-left: 13px;
  }

  .sl-lever-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 12px 0 10px;
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
    align-items: flex-start;
    gap: 9px;
    padding: 9px 10px 9px 8px;
    cursor: pointer;
  }
  .sl-lever input {
    margin-top: 3px;
    accent-color: var(--accent);
    flex: 0 0 auto;
  }
  .sl-lever-body {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .sl-lever-label {
    font-size: var(--fs-label);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .sl-lever-meta {
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-muted);
  }

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

  .sl-chosen {
    margin-bottom: 20px;
  }
  .sl-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
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

  .sl-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
  }
  .sl-column {
    background: var(--bg);
    padding: 15px 17px 18px;
    min-width: 0;
  }
  .sl-column header {
    border-bottom: 1px solid var(--divider);
    padding-bottom: 10px;
    margin-bottom: 13px;
  }
  .sl-column h4 {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    margin: 6px 0 0;
  }
  .sl-loses .sl-column-kicker {
    color: var(--accent);
  }
  .sl-gains .sl-column-kicker {
    color: var(--accent-ink);
  }

  .sl-group {
    margin-bottom: 17px;
  }
  .sl-group-head {
    color: var(--text-primary);
    margin-bottom: 6px;
  }
  .sl-group ul {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: grid;
    gap: 7px;
  }
  .sl-group li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 7px;
    font-size: var(--fs-label);
    border-top: 1px solid var(--divider);
    padding-top: 7px;
  }
  .sl-tag {
    border: 1px solid var(--line-strong);
    padding: 2px 5px;
    color: var(--text-muted);
    flex: 0 0 auto;
  }
  .sl-tag.gone {
    border-color: var(--accent);
    color: var(--accent);
  }
  .sl-tag.sl-off {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  .sl-why {
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
    width: 100%;
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
    overflow-wrap: anywhere;
  }
  .sl-link:hover {
    color: var(--accent);
  }
  .sl-lever-actions .sl-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }

  .sl-holds {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 20px 0 0;
    padding-top: 13px;
    border-top: 1px solid var(--divider);
    max-width: 76ch;
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
   * what this rests on, and how much rests on each".
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
  }
</style>
