<script lang="ts">
  // E — TRIPWIRES. The nine watched numbers, as a table on the dark ground.
  //
  // A dashboard that shows everything every day trains you to look at none of
  // it. Each row has a trigger and one job: say whether it has been crossed.
  // TRIPPED rows are tinted and take a solid badge, CLOSE rows an outline, and
  // ARMED rows go olive — the only state on the page where "nothing to report"
  // is the good news.
  //
  // A wire whose window is too thin to read prints an em dash in NOW and says so
  // in the last column. `computeTripwires` still hands it back as ARMED — there
  // is no fourth state — so the badge goes MUTED rather than olive here: "we
  // cannot see it" and "it is fine" are different sentences, and only one of
  // them is good news.
  import { TRIPWIRE_METRIC, type Tripwire } from '$lib/health/tripwires';
  import { gettableHref } from '$lib/health/deep-links';
  import SectionHead from './SectionHead.svelte';
  import { countWord } from './format';

  interface Props {
    tripwires: Tripwire[];
    /** Opens the drill for the instrument behind a wire. */
    onmetric?: (id: string) => void;
    /**
     * The segment wire watches GROUND, so its row links to the gettable board
     * rather than to an instrument — and only when the reader is allowed the
     * board at all. Section F strips it for the anonymous audience and this row
     * has to make the same decision.
     */
    owner?: boolean;
  }

  let { tripwires, onmetric, owner = true }: Props = $props();

  /**
   * What a row opens, or null when it opens nothing.
   *
   * A wire with no instrument behind it is not made clickable. `strain-balance`
   * watches a ratio no panel prints, and an unreadable wire has nothing to show
   * — offering a drill that opens on an em dash and an empty chart is a worse
   * answer than a row that stays a row.
   */
  function drillFor(w: Tripwire): string | null {
    if (!w.readable) return null;
    return TRIPWIRE_METRIC[w.id];
  }

  const tripped = $derived(tripwires.filter((t) => t.state === 'TRIPPED').length);
  const strap = $derived(
    `Trigger values are the site's own thresholds where it has them, and your own baselines where it doesn't. ${
      tripped === 0
        ? 'Nothing is live right now.'
        : tripped === 1
          ? 'One is live right now.'
          : `${countWord(tripped).toLowerCase().replace(/^./, (c) => c.toUpperCase())} are live right now.`
    }`,
  );
</script>

{#if tripwires.length}
  <section id="health-e" class="e">
    <div class="e-inner">
      <SectionHead
        dark
        kicker="E / Tripwires · {countWord(tripwires.length).toLowerCase()} watched numbers"
        title={['Tell me when,', 'not every day']}
        {strap}
      />

      <div class="e-scroll">
        <table class="e-table">
          <thead>
            <tr>
              <th>State</th>
              <th>Signal</th>
              <th>Trigger</th>
              <th>Now</th>
              <th>What it means · what to do</th>
            </tr>
          </thead>
          <tbody>
            {#each tripwires as w (w.id)}
              {@const drill = drillFor(w)}
              <tr class:tripped={w.state === 'TRIPPED'} class:live={drill != null}>
                <td>
                  <span class="e-badge state-{w.state.toLowerCase()}" class:unread={!w.readable}>
                    {w.readable ? w.state : 'NO READ'}
                  </span>
                </td>
                <td class="e-signal">
                  <!-- The signal name is the handle. Making the whole ROW a
                       button would swallow the meaning column's text selection,
                       and this table is read as much as it is clicked. -->
                  {#if drill}
                    <button type="button" class="e-open" onclick={() => onmetric?.(drill)}>
                      {w.signal}
                    </button>
                  {:else}
                    {w.signal}
                  {/if}
                  <br /><span class="e-window">{w.window}</span>
                </td>
                <td class="e-trigger">{w.trigger}</td>
                <td class="e-now state-{w.state.toLowerCase()}" class:unread={!w.readable}>{w.now}</td>
                <td class="e-meaning">
                  {w.meaning}
                  {#if w.id === 'segment-pb' && owner && w.readable}
                    <a class="e-go" href={gettableHref()} data-sveltekit-preload-data="hover">
                      Open the gettable board →
                    </a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>
{/if}

<style>
  .e {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
  }
  .e-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  /* The table keeps its columns and scrolls rather than reflowing — a trigger
     and the number beside it stop meaning anything once they stack. */
  .e-scroll {
    overflow-x: auto;
  }
  .e-table {
    border-collapse: collapse;
    width: 100%;
    min-width: 860px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .e-table th {
    text-align: left;
    padding: 0 14px 12px 0;
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    border-bottom: 1px solid rgba(237, 228, 212, 0.3);
  }
  .e-table th:last-child,
  .e-table td:last-child {
    padding-right: 0;
  }
  .e-table td {
    padding: 14px 14px 14px 0;
    vertical-align: top;
    border-bottom: 1px solid rgba(237, 228, 212, 0.12);
  }
  .e-table tbody tr:last-child td {
    border-bottom: none;
  }
  .e-table tbody tr.tripped {
    background: rgba(232, 134, 58, 0.09);
  }

  .e-badge {
    display: inline-block;
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .e-badge.state-tripped {
    background: var(--accent-on-dark);
    color: var(--text-primary);
    padding: 3px 8px;
  }
  .e-badge.state-close {
    border: 1px solid rgba(232, 134, 58, 0.5);
    color: var(--accent-on-dark);
    padding: 3px 8px;
  }
  .e-badge.state-armed {
    color: var(--good-on-dark);
    padding: 3px 0;
  }
  .e-badge.unread {
    background: transparent;
    border: none;
    color: rgba(237, 228, 212, 0.45);
    font-weight: 400;
    padding: 3px 0;
  }

  .e-signal {
    font-weight: 500;
  }
  /* Styled back to the plain text it replaces. The signal name reads exactly as
     it did; it gains an underline on hover, which is what a name that opens
     something should do on a table that is mostly prose. */
  .e-open {
    display: inline;
    padding: 0;
    margin: 0;
    background: none;
    border: 0;
    border-radius: 0;
    font: inherit;
    font-weight: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .e-open:hover,
  .e-open:focus-visible {
    color: var(--accent-on-dark);
    border-bottom-color: var(--accent-on-dark);
  }
  .e-open:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 3px;
  }
  .e-go {
    display: block;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    text-decoration: none;
  }
  .e-go:hover,
  .e-go:focus-visible {
    color: var(--accent-on-dark);
  }
  .e-window {
    color: rgba(237, 228, 212, 0.55);
    font-weight: 400;
  }
  .e-trigger {
    color: rgba(237, 228, 212, 0.7);
    white-space: nowrap;
  }
  .e-now {
    font-weight: 700;
    white-space: nowrap;
  }
  .e-now.state-tripped,
  .e-now.state-close {
    color: var(--accent-on-dark);
  }
  .e-now.state-armed {
    color: var(--good-on-dark);
  }
  .e-now.unread {
    color: rgba(237, 228, 212, 0.45);
    font-weight: 400;
  }
  .e-meaning {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.8);
    min-width: 30ch;
  }
</style>
