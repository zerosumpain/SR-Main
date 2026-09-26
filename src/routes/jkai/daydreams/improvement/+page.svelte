<script lang="ts">
  // Is the loop closing? Two dashboards showed a great deal about the
  // self-improvement engine — runs, phases, budget, generated code — and
  // neither showed whether anything it built was ever used. On the day the
  // merge started: 33 tools shipped in a fortnight, none ever called.
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import NightTimeline from '$lib/components/jkai/daydream/rooms/NightTimeline.svelte';
  import LoopScoreboard from '$lib/components/jkai/daydream/LoopScoreboard.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import ImprovementPanel from '$lib/components/jkai/daydream/ImprovementPanel.svelte';

  let { data }: { data: PageData } = $props();

  // The loop as five even cells, in the order the work flows. A zero is a
  // fact and stays quiet; the first non-zero stage after a zero is where the
  // loop is currently stuck.
  const story = $derived(data.story);
  // Since D3 (2026-09-26) every
  // producer — the think loop's build notes, the workflow doctor, the nightly
  // question-miner, the owner — writes to ONE backlog, deduped at intake, and
  // nothing costly is built until the owner accepts an item's brief.
  const channelLine = $derived(
    Object.entries(story.intake.byChannel)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${n} ${c}`)
      .join(' · '),
  );
  const cells = $derived<RollupCell[]>([
    {
      key: 'intake',
      mark: '1',
      label: 'Ideas in, 7 days',
      value: String(story.intake.week),
      sub: channelLine || 'nothing new queued this week',
      tone: story.intake.week ? 'steady' : 'quiet',
      href: '/jkai/develop/backlog',
    },
    {
      key: 'tap',
      mark: '2',
      label: 'Waiting for your tap',
      value: String(story.awaitingTap),
      sub: 'a build or watch starts only once you accept its brief',
      tone: story.awaitingTap ? 'action' : 'quiet',
      href: '/jkai/develop/backlog',
    },
    {
      key: 'ideas',
      mark: '3',
      label: 'Deliverables queued',
      value: String(story.backlog.open),
      sub: `${story.backlog.engine} about the engine itself · ${story.backlog.shipped} shipped all time`,
      tone: story.backlog.open ? 'steady' : 'quiet',
      // The queue is its own room. The ledger below explains what changed;
      // Backlog is where waiting work is managed.
      href: '/jkai/develop/backlog',
    },
    {
      key: 'tools',
      mark: '4',
      label: `Tools built, ${data.loop.tools.windowDays}d`,
      value: String(data.loop.tools.shippedRecently),
      sub: `${data.loop.tools.shippedRecentlyCalled} of them called`,
      tone: data.loop.tools.shippedRecently ? (data.loop.tools.shippedRecentlyCalled ? 'good' : 'watch') : 'quiet',
    },
    {
      key: 'thoughts',
      mark: '5',
      label: 'Thoughts, 7 days',
      value: String(story.thoughts7d),
      sub: 'notes the think loop wrote',
      tone: story.thoughts7d ? 'steady' : 'quiet',
      href: '/jkai/daydreams',
    },
  ]);

</script>

<nav class="improvement-actions" aria-label="Improvement actions">
  <a class="cta" href="/jkai/develop/doctor">Open Doctor →</a>
  <a class="btn" href="/jkai/develop/backlog">Epic backlog →</a>
</nav>

<!-- The night, before anything it produced. One window, one budget: a night
     that overruns is a night that stops rather than a night that spends, so
     what ran and what it cost is the frame for every count below. -->
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
      kicker="B / Is the loop closing?"
      title={['What it built,', 'and what it used']}
      strap="Two dashboards showed everything about the self-improvement engine except whether a single thing it built was ever called. On the day this merged: 33 tools shipped, none used."
    />
    <LoopScoreboard health={data.loop} verdict={data.loopVerdict} />
  </div>
</section>


<section class="band improvement-room">
  <div class="inner">
    <SectionHead
      kicker="C / The loop, end to end"
      title={['What it was asked for,', 'and what that built']}
      strap="Five stages in the order the work flows: ideas arriving on the one backlog (think-loop build notes, doctor escalations, questions you asked, your own entries), the ones waiting for your tap, the queue, the tools it keeps running, the notes the think loop writes. The first zero after a non-zero is where the loop is stuck."
    />
    {#if story.error}<p class="err">{story.error}</p>{/if}
    <RollupGrid {cells} min={190} />
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
