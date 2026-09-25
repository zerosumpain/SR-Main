<script lang="ts">
  // What the self-improvement engine did overnight, and the ledger of what it
  // built. The loop scoreboard and the appetite board went with the daydream
  // engine in P4a (2026-09-25).
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import NightTimeline from '$lib/components/jkai/daydream/rooms/NightTimeline.svelte';
  import ImprovementPanel from '$lib/components/jkai/daydream/ImprovementPanel.svelte';

  let { data }: { data: PageData } = $props();
</script>

<nav class="improvement-actions" aria-label="Improvement actions">
  <a class="cta" href="/jkai/daydreams/doctor">Open Doctor →</a>
  <a class="btn" href="/jkai/daydreams/backlog">Epic backlog →</a>
</nav>

<!-- The night, before anything it produced. One window, one budget: a night
     that overruns is a night that stops rather than a night that spends, so
     what ran and what it cost is the frame for everything below. -->
<section class="band improvement-room" id="overnight">
  <div class="inner">
    <SectionHead
      kicker="A / The overnight"
      title={['What it did while', 'you were asleep']}
      strap="One window, every activity that fired in it, one budget. The engine is scheduled by the heartbeat, so a pass that was scheduled and did not fire shows as a gap here rather than as a silence."
    />
    <NightTimeline night={data.night} />
  </div>
</section>

<section class="band improvement-room">
  <div class="inner">
    <SectionHead
      kicker="B / The ledger"
      title={['What it built,', 'and what it changed']}
      strap="Runs, phases, budget and what each night produced. Ideas it queued wait in the backlog room."
    />
    {#if data.improvement}
      <div class="ledger" id="improvement-ledger">
        <ImprovementPanel data={data.improvement} embedded />
      </div>
    {:else}
      <div class="card t-urgent"><p class="card-body">The improvement ledger could not be read.</p></div>
    {/if}
  </div>
</section>

<style>
  .improvement-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 18px clamp(20px, 3vw, 44px); border-bottom: 1px solid var(--line); background: var(--surface-rail); }

  .ledger {
    margin-top: clamp(28px, 4vw, 56px);
    padding-top: clamp(24px, 3vw, 40px);
    border-top: 2px solid var(--text-primary);
  }
  .improvement-room { padding-block: clamp(20px, 2.5vw, 32px); }
  .improvement-room :global(.sh) { align-items: start; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; padding-bottom: 16px; border-bottom: 2px solid var(--line-strong); margin-bottom: 20px; }
  .improvement-room :global(.sh-title) { font-size: clamp(22px, 2.2vw, 30px); line-height: 1.05; }
  .improvement-room :global(.sh-kicker) { color: var(--accent-ink); margin-bottom: 8px; }
  .improvement-room :global(.sh-strap) { font-size: var(--fs-nav); }
  @media (max-width: 640px) { .improvement-room :global(.sh) { grid-template-columns: 1fr; gap: 12px; } }
</style>
