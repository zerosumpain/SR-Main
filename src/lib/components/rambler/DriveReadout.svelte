<script lang="ts">
  // Drives and the odds they give, for one set of inputs.
  import { CONTEXTS, score, startDrives, states, type Drive, type DriveInput } from '$lib/landing/ramblers/drives';
  import { CHOICE_LABEL, DRIVE_LABEL } from './labels';

  let { input, limit = 6 }: { input: DriveInput; limit?: number } = $props();

  const ORDER: Drive[] = ['sleep', 'restless', 'attention', 'stress', 'appetite', 'work', 'curious', 'energy'];
  const drives = $derived(startDrives(input));
  const odds = $derived(score(drives).slice(0, limit));
  const showing = $derived.by(() => {
    const s = states(drives);
    const out: string[] = [];
    if (s.mad) out.push('a temper, once');
    if (s.sleepy) out.push('yawning');
    if (s.stressed) out.push('stressed episodes');
    else if (s.anxious) out.push('the odd fret');
    if (s.cold) out.push('scarf and shivers');
    if (s.hot) out.push('fanning himself');
    return out;
  });
</script>

<div class="readout">
  <div class="col">
    <h3>Drives</h3>
    {#each ORDER as k (k)}
      <div class="bar">
        <span>{DRIVE_LABEL[k]}</span>
        <span class="track"><span class="fill drive" style:width="{Math.round(drives.d[k] * 100)}%"></span></span>
        <span class="num">{drives.d[k].toFixed(2)}</span>
      </div>
    {/each}
  </div>
  <div class="col">
    <h3>What he does next</h3>
    {#each odds as o (o.a)}
      <div class="bar">
        <span>{CHOICE_LABEL[o.a]}</span>
        <span class="track"><span class="fill" style:width="{Math.round(o.p * 100)}%"></span></span>
        <span class="num">{Math.round(o.p * 100)}%</span>
      </div>
    {/each}
    {#if drives.context}
      <p class="context"><span>{CONTEXTS[drives.context].label}</span> {CONTEXTS[drives.context].reads}</p>
    {/if}
    <p class="showing">Showing as {showing.length ? showing.join(', ') : 'nothing in particular'}</p>
  </div>
</div>

<style>
  .readout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 640px) {
    .readout {
      grid-template-columns: 1fr;
    }
  }
  .col {
    display: grid;
    gap: 0.45rem;
    align-content: start;
    min-width: 0;
  }
  h3 {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    font-weight: 400;
    margin: 0 0 0.25rem;
  }
  .bar {
    display: grid;
    grid-template-columns: 8.5rem 1fr 2.6rem;
    gap: 0.6rem;
    align-items: center;
    font-size: 0.9rem;
    color: var(--text-primary);
  }
  .track {
    height: 0.6rem;
    background: var(--line-hair);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .fill.drive {
    background: var(--accent-ink);
  }
  .num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .context {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }
  .context span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--bg);
    background: var(--accent-ink);
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
    margin-right: 0.4rem;
  }
  .showing {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }
</style>
