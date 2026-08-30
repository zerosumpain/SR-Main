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
  import type { Tripwire } from '$lib/health/tripwires';
  import SectionHead from './SectionHead.svelte';
  import { countWord } from './format';

  interface Props {
    tripwires: Tripwire[];
  }

  let { tripwires }: Props = $props();

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
  <section class="e">
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
              <tr class:tripped={w.state === 'TRIPPED'}>
                <td>
                  <span class="e-badge state-{w.state.toLowerCase()}" class:unread={!w.readable}>
                    {w.readable ? w.state : 'NO READ'}
                  </span>
                </td>
                <td class="e-signal">
                  {w.signal}<br /><span class="e-window">{w.window}</span>
                </td>
                <td class="e-trigger">{w.trigger}</td>
                <td class="e-now state-{w.state.toLowerCase()}" class:unread={!w.readable}>{w.now}</td>
                <td class="e-meaning">{w.meaning}</td>
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
