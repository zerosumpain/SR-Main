<script lang="ts">
  // D — RANKED MOVES. Five rows on paper, ranked by leverage per unit of
  // effort, each stating what it BUYS and what it COSTS.
  //
  // The second column is the one that decides, which is why costs get equal
  // width to the benefits rather than a footnote. The five-bar meter on the
  // right is `leverage` out of five; the label under it says what the meter is
  // measuring, because "4 of 5" on its own is a number without a unit.
  import type { Move } from '$lib/health/moves';
  import SectionHead from './SectionHead.svelte';
  import { countWord } from './format';

  interface Props {
    moves: Move[];
  }

  let { moves }: Props = $props();

  const METER_BARS = 5;
  const bars = [...Array(METER_BARS).keys()];
</script>

{#if moves.length}
  <section class="d">
    <div class="d-inner">
      <SectionHead
        kicker="D / Ranked moves · you choose"
        title={[`${countWord(moves.length)} options,`, 'honest trade-offs']}
        strap="Ranked by leverage per unit of effort. Every row states what it costs and what it puts at risk, because the second column is the one that decides."
      />

      <div class="d-rows">
        {#each moves as move (move.id)}
          <div class="d-row">
            <p class="d-rank" class:muted={move.tone === 'muted'}>
              {String(move.rank).padStart(2, '0')}
            </p>

            <div class="d-cell">
              <h3 class="d-title">{move.title}</h3>
              <p class="d-rationale">{move.rationale}</p>
            </div>

            <div class="d-cell">
              <p class="d-label">Buys</p>
              <p class="d-text">{move.buys.join(' ')}</p>
            </div>

            <div class="d-cell">
              <p class="d-label">Costs / risks</p>
              <p class="d-text">{move.costs.join(' ')}</p>
            </div>

            <div class="d-cell">
              <p class="d-label">Leverage</p>
              <div class="d-meter" role="img" aria-label="Leverage {move.leverage} of {METER_BARS}">
                {#each bars as i (i)}
                  <div
                    class="d-bar"
                    class:on={i < move.leverage}
                    class:muted={move.tone === 'muted'}
                  ></div>
                {/each}
              </div>
              <p class="d-meter-label" class:muted={move.tone === 'muted'}>{move.leverageLabel}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>
{/if}

<style>
  .d {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .d-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  /* One hairline between rows, drawn as the container's own background showing
     through a 1px gap. Safe here — this is a fixed single column, not an
     `auto-fit` grid where unfilled tracks would paint as blocks. */
  .d-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .d-row {
    background: var(--bg);
    display: grid;
    grid-template-columns: 56px minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) 118px;
    gap: clamp(14px, 1.8vw, 28px);
    padding: 24px;
    align-items: start;
  }

  .d-rank {
    font-family: var(--font-display);
    font-size: 40px;
    line-height: 0.8;
    letter-spacing: -0.03em;
    color: var(--accent);
    margin: 0;
  }
  .d-rank.muted {
    color: rgba(26, 16, 8, 0.3);
  }

  .d-cell {
    min-width: 0;
  }
  .d-title {
    font-family: var(--font-display);
    font-size: 20px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0 0 10px;
  }
  .d-rationale {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    text-wrap: pretty;
  }
  .d-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 8px;
  }
  .d-text {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: rgba(26, 16, 8, 0.8);
    margin: 0;
    text-wrap: pretty;
  }

  .d-meter {
    display: flex;
    gap: 2px;
    margin-bottom: 8px;
  }
  .d-bar {
    height: 22px;
    flex: 1;
    background: rgba(26, 16, 8, 0.14);
  }
  .d-bar.on {
    background: var(--accent);
  }
  .d-bar.on.muted {
    background: rgba(26, 16, 8, 0.45);
  }
  .d-meter-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }
  .d-meter-label.muted {
    color: var(--text-ghost);
  }

  @media (max-width: 1080px) {
    .d-row {
      grid-template-columns: 56px minmax(0, 1fr);
      row-gap: 18px;
    }
    .d-rank {
      grid-row: span 4;
    }
  }
  @media (max-width: 560px) {
    .d-row {
      grid-template-columns: minmax(0, 1fr);
      padding: 20px;
    }
    .d-rank {
      grid-row: auto;
    }
  }
</style>
