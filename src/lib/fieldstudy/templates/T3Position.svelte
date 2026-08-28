<script lang="ts">
  /**
   * T3 · Position — recommending.
   *
   * One recommendation, defended. The rejected options are NAMED and stated
   * fairly; a strawman is worse than no comparison. The conditions are what it
   * depends on, and the sinkers are what would end it.
   *
   * This is the only page where the accent runs as a filled band. Once.
   */
  import ConfidenceChip from '../ConfidenceChip.svelte';
  import type { Beat } from '../study';

  let { beat }: { beat: Beat } = $props();
  const p = $derived(beat.position);
</script>

{#if p}
  <h2 class="fs-h1 fs-h1--display fs-position">{p.statement}</h2>

  {#if p.elaboration}<p class="fs-body fs-elaboration">{p.elaboration}</p>{/if}

  {#if p.confidence}
    <p class="fs-confidence-note">
      <ConfidenceChip level={p.confidence} />
      <span>The recommendation is stated at the confidence the evidence supports, not the confidence a recommendation would like to have.</span>
    </p>
  {/if}

  <div class="fs-because">
    {#each p.because as b, i (i)}
      <div>
        <span class="fs-margin-label">{b.headline}</span>
        <p>{b.detail}</p>
      </div>
    {/each}
  </div>

  <div class="fs-rejected">
    <span class="fs-margin-label">And not the others</span>
    {#each p.rejected as r, i (i)}
      <div class="fs-rejected-row">
        <span class="fs-rejected-name">{r.name}</span>
        <span class="fs-rejected-why">{r.why}</span>
      </div>
    {/each}
  </div>

  {#if p.conditions?.length}
    <div class="fs-conditions">
      <span class="fs-margin-label">What it depends on</span>
      <ul>{#each p.conditions as c, i (i)}<li>{c}</li>{/each}</ul>
    </div>
  {/if}

  <div class="fs-warn fs-sinkers">
    <span class="label">What would sink it</span>
    <p>{p.sinkers}</p>
  </div>

  {#if p.phases?.length}
    <div class="fs-cells fs-sequencing">
      {#each p.phases as phase, i (i)}
        <div>
          <span class="fs-margin-label">{phase.label}</span>
          <b class="fs-phase-name">{phase.name}</b>
          <p>{phase.detail}</p>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .fs-position {
    max-width: 20ch;
    margin-top: 26px;
  }
  .fs-elaboration {
    max-width: 100%;
    margin-top: 16px;
  }
  .fs-confidence-note {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 18px 0 0;
    padding-left: 14px;
    border-left: 3px solid var(--accent);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 100%;
  }
  /* The one filled accent band in the study. */
  .fs-because {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    /* Two shared rows — headline, then detail. Without them a two-line
       headline and a three-line headline start their bodies at different
       heights, and the three cells read as misaligned. */
    grid-template-rows: auto auto;
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    background-color: var(--accent-tint-08);
    margin-top: 28px;
  }
  .fs-because > div {
    display: grid;
    grid-row: span 2;
    grid-template-rows: subgrid;
    align-content: start;
    background: var(--accent-tint-08);
    padding: 16px 18px;
    min-width: 0;
  }
  .fs-because p {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .fs-rejected {
    margin-top: 28px;
    border-top: 2px solid var(--text-primary);
    padding-top: 14px;
  }
  .fs-rejected-row {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 16px;
    padding: 11px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .fs-rejected-name {
    font-weight: 500;
  }
  .fs-rejected-why {
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
  }
  .fs-conditions {
    margin-top: 24px;
    border: 1px solid var(--line-strong);
    padding: 15px 17px;
  }
  .fs-conditions ul {
    margin: 9px 0 0;
    padding-left: 18px;
  }
  .fs-conditions li {
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .fs-sinkers p {
    margin: 9px 0 0;
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 100%;
  }
  .fs-phase-name { display: block; margin-top: 5px; }
  .fs-sinkers {
    margin-top: 20px;
  }
  .fs-sequencing {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-top: 24px;
  }
  .fs-sequencing p {
    margin: 7px 0 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  @media (max-width: 900px) {
    .fs-because { grid-template-columns: minmax(0, 1fr); }
    .fs-sequencing { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .fs-rejected-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
  }
</style>
