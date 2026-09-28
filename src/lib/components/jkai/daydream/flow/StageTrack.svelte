<script lang="ts">
  // Where one note is in its journey: four dots on a rule, the reached ones
  // filled. The same four words as the guide at the top of the Inbox, so the
  // card and the explanation cannot drift apart.
  import { STAGES, STAGE_LABEL, type Stage } from '$lib/daydream/think/explain';

  let { stage, compact = false }: { stage: Stage; compact?: boolean } = $props();
  const reached = $derived(STAGES.indexOf(stage));
</script>

<div class="track" class:compact aria-label="Stage: {STAGE_LABEL[stage]}, {reached + 1} of {STAGES.length}">
  <ol aria-hidden="true">
    {#each STAGES as s, i (s)}
      <li class:on={i <= reached} class:here={i === reached}><span class="dot"></span></li>
    {/each}
  </ol>
  {#if !compact}<span class="label">{STAGE_LABEL[stage]}</span>{/if}
</div>

<style>
  .track {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  ol {
    display: flex;
    align-items: center;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
  }
  li + li::before {
    content: '';
    width: 14px;
    height: 1px;
    background: var(--line-strong);
  }
  li.on + li.on::before {
    background: var(--accent-ink);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    border: 1px solid var(--text-ghost);
    background: transparent;
  }
  li.on .dot {
    border-color: var(--accent-ink);
    background: var(--accent-ink);
  }
  li.here .dot {
    width: 10px;
    height: 10px;
    background: var(--bg);
    border-width: 2px;
  }
  .label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
</style>
