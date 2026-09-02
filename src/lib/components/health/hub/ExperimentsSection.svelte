<script lang="ts">
  // H — EXPERIMENTS. Change one thing, measure it.
  //
  // At most one runs LIVE at a time. A second overlapping variable makes
  // attribution impossible, and an experiment you cannot attribute is just a
  // resolution — so the rest sit QUEUED behind an entry condition, and their
  // last block says what would let them start rather than when to stop.
  import type { Experiment } from '$lib/health/experiments';
  import SectionHead from './SectionHead.svelte';
  import { countWord } from './format';

  interface Props {
    experiments: Experiment[];
    /**
     * The section letter. Fixed at H for the owner, but the anonymous document
     * does not render G — its route cards name real corridors near home — and
     * a run of section heads that goes E, F, H reads as a page with a hole in
     * it rather than as a shorter page.
     */
    letter?: string;
  }

  let { experiments, letter = 'H' }: Props = $props();

  const live = $derived(experiments.filter((e) => e.state === 'LIVE').length);
  const queued = $derived(experiments.length - live);
  const kicker = $derived(
    `${letter} / Experiments · ${countWord(live).toLowerCase()} live, ${countWord(queued).toLowerCase()} queued`,
  );
</script>

{#if experiments.length}
  <section class="h">
    <div class="h-inner">
      <SectionHead
        dark
        {kicker}
        title={['Change one thing,', 'measure it']}
        strap="One at a time is the limit — a second overlapping variable makes attribution impossible, and an experiment you can't attribute is just a resolution."
      />

      <div class="h-grid">
        {#each experiments as exp (exp.id)}
          <div class="h-card">
            <div class="h-card-head">
              <span class="h-badge" class:queued={exp.state === 'QUEUED'}>
                {exp.state} · {exp.code}
              </span>
              <p class="h-counter">{exp.counter}</p>
            </div>
            <h3 class="h-title">{exp.title}</h3>

            <div class="h-blocks">
              <div>
                <p class="h-label" class:lead={exp.state === 'LIVE'}>Change</p>
                <p class="h-text lead">{exp.change}</p>
              </div>
              <div>
                <p class="h-label">Hold constant</p>
                <p class="h-text">{exp.holdConstant}</p>
              </div>
              <div>
                <p class="h-label">Measure</p>
                <p class="h-text">{exp.measure}</p>
              </div>
              <div class="h-stop">
                <p class="h-label">{exp.stopRuleLabel}</p>
                <p class="h-text">{exp.stopRule}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>
{/if}

<style>
  .h {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
  }
  .h-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .h-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  .h-card {
    background: var(--text-primary);
    border: 1px solid rgba(237, 228, 212, 0.16);
    padding: 24px;
    min-width: 0;
    /* The design shows three. With one LIVE and nothing queued, an auto-fit
       track at `1fr` stretches that single card the full 1400px and it stops
       reading as a card at all. */
    max-width: 640px;
  }
  .h-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .h-badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    background: var(--accent-on-dark);
    color: var(--text-primary);
    padding: 4px 9px;
    white-space: nowrap;
  }
  .h-badge.queued {
    background: transparent;
    border: 1px solid rgba(237, 228, 212, 0.4);
    color: rgba(237, 228, 212, 0.7);
  }
  .h-counter {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0;
    text-align: right;
  }
  .h-title {
    font-family: var(--font-display);
    font-size: 21px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0 0 18px;
  }

  .h-blocks {
    display: flex;
    flex-direction: column;
    gap: 13px;
  }
  .h-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.5);
    margin: 0 0 5px;
  }
  .h-label.lead {
    color: var(--accent-on-dark);
  }
  .h-text {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
    margin: 0;
    text-wrap: pretty;
  }
  .h-text.lead {
    color: rgba(237, 228, 212, 0.85);
  }
  .h-stop {
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    padding-top: 13px;
  }
</style>
