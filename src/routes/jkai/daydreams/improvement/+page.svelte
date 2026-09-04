<script lang="ts">
  // Is the loop closing? Two dashboards showed a great deal about the
  // self-improvement engine — runs, phases, budget, generated code — and
  // neither showed whether anything it built was ever used. On the day the
  // merge started: 33 tools shipped in a fortnight, none ever called.
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import LoopScoreboard from '$lib/components/jkai/daydream/LoopScoreboard.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import ImprovementPanel from '$lib/components/jkai/daydream/ImprovementPanel.svelte';
  import AppetiteBoard from '$lib/components/jkai/daydream/rooms/AppetiteBoard.svelte';
  import QueueBoard from '$lib/components/jkai/daydream/rooms/QueueBoard.svelte';
  import { postThought } from '$lib/daydream/feed-client';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: PageData } = $props();

  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  async function act(body: Record<string, unknown>, key: string) {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error ?? 'that did not work';
    else await invalidateAll();
    busy = null;
    return r.ok;
  }

  // The loop as six even cells, in the order the work flows. A zero is a
  // fact and stays quiet; the first non-zero stage after a zero is where the
  // loop is currently stuck.
  const story = $derived(data.story);
  // Seven stages in the order the work flows. Appetite leads it because that
  // is the reordering: until 2026-09-04 every driver here was a repair of
  // something that already existed, and the first cell was a fault.
  const cells = $derived<RollupCell[]>([
    {
      key: 'appetite',
      mark: '1',
      label: 'Capabilities wanted',
      value: String(data.appetite.counts.byStatus.proposed ?? 0),
      suffix: data.appetite.counts.total ? `/${data.appetite.counts.total}` : null,
      sub: `${data.appetite.newDataOpen} of them bring new data in`,
      tone: (data.appetite.counts.byStatus.proposed ?? 0) ? 'action' : 'quiet',
      href: '#appetite',
    },
    {
      key: 'faults',
      mark: '2',
      label: 'Faults raised',
      value: String(story.faults.open),
      suffix: story.faults.total ? `/${story.faults.total}` : null,
      sub: Object.entries(story.faults.byWants).map(([w, n]) => `${n} ${w.replace('_', ' ')}`).join(' · ') || 'nothing daydream could not do',
      tone: story.faults.open ? 'action' : 'quiet',
      href: '/jkai/daydreams/engine',
    },
    {
      key: 'ideas',
      mark: '3',
      label: 'Ideas queued',
      value: String(story.backlog.open),
      sub: `${story.backlog.engine} about the engine itself · ${story.backlog.shipped} shipped all time`,
      tone: story.backlog.open ? 'steady' : 'quiet',
      // The queue now has a surface of its own. This cell used to point at the
      // ledger, which explains what CHANGED — not what is waiting.
      href: '#queue',
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
      key: 'signals',
      mark: '5',
      label: 'Tool signals swept',
      value: String(data.loop.toolSignals?.sweepable ?? 0),
      suffix: data.loop.toolSignals ? `/${data.loop.toolSignals.registered}` : null,
      sub: data.loop.toolSignals ? `${data.loop.toolSignals.observing} observing · ${data.loop.toolSignals.minPairs} days to join` : 'not read',
      tone: (data.loop.toolSignals?.sweepable ?? 0) ? 'good' : 'quiet',
      href: '/jkai/daydreams/engine',
    },
    {
      key: 'findings',
      mark: '6',
      label: 'Findings, 7 days',
      value: String(story.findings7d),
      sub: 'survived the false-discovery correction; carded into pondering',
      tone: story.findings7d ? 'good' : 'quiet',
      href: '/jkai/daydreams/discoveries',
    },
    {
      key: 'thoughts',
      mark: '7',
      label: 'Thoughts, 7 days',
      value: String(story.thoughts7d),
      sub: 'raised across every family',
      tone: story.thoughts7d ? 'steady' : 'quiet',
      href: '/jkai/daydreams/feed',
    },
  ]);

  // ── The doctor, folded in ────────────────────────────────────────────────
  //
  // The full report is 800 lines of symptom, cause and fix and stays at its
  // own route; what belongs in the unified room is the answer. The last cell
  // is the fold itself: a finding the doctor could not fix becomes an ordinary
  // fault, which is the queue cell 2 counts.
  const doctor = $derived(data.doctor);
  const doctorCells = $derived<RollupCell[]>([
    {
      key: 'open',
      mark: 'A',
      label: 'Findings open',
      value: String(doctor.openFindings),
      sub: doctor.openFindings ? 'proposed or refused, waiting on somebody' : 'nothing outstanding',
      tone: doctor.openFindings ? 'watch' : 'good',
      href: '/jkai/daydreams/doctor',
    },
    {
      key: 'fixed',
      mark: 'B',
      label: 'Fixed last night',
      value: String(doctor.fixedLastNight),
      sub: 'node config, inside the whitelist',
      tone: doctor.fixedLastNight ? 'good' : 'quiet',
    },
    {
      key: 'stopped',
      mark: 'C',
      label: 'Schedules stopped',
      value: String(doctor.quarantinedLastNight),
      sub: 'the circuit breaker, on a runaway cron',
      tone: doctor.quarantinedLastNight ? 'action' : 'quiet',
    },
    {
      key: 'escalated',
      mark: 'D',
      label: 'Handed to the queue',
      value: String(doctor.escalatedLastNight),
      sub: 'needed repo code, so it became a fault',
      tone: doctor.escalatedLastNight ? 'steady' : 'quiet',
      href: '#appetite',
    },
  ]);
</script>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / Is the loop closing?"
      title={['What it built,', 'and what it used']}
      strap="Two dashboards showed everything about the self-improvement engine except whether a single thing it built was ever called. On the day this merged: 33 tools shipped, none used."
    />
    <LoopScoreboard health={data.loop} verdict={data.loopVerdict} />
  </div>
</section>

<section class="band" id="appetite">
  <div class="inner">
    <SectionHead
      kicker="B / Appetite"
      title={['What it would like', 'to be able to do']}
      strap="Each evening the engine reads the types of question you have been asking, an inventory of every source, API, toolset, watch, feed and schedule the site can already reach, and the faults where it came up short — then names capabilities the site does not have. Every proposal cites the evidence that produced it or it is dropped unread. Accepting one queues it; it does not spend anything until a build slot opens."
    />
    {#if actionError}<p class="err">{actionError}</p>{/if}
    <AppetiteBoard view={data.appetite} {busy} {act} />
  </div>
</section>

<section class="band sunken" id="queue">
  <div class="inner">
    <SectionHead
      kicker="C / The queue"
      title={['Everything it wants', 'to do next']}
      strap="Every idea the engine is holding, in the order it will reach for them. Six stages left to right: proposed, accepted, in build, verifying, live, parked. A card can be dragged to Accepted or Parked and nowhere else — a tool becomes live when jkai calls it, and a drag must never be what starts a build that can spend £2. The priority on a card is the field the picker actually ranks on."
    />
    {#if actionError}<p class="err">{actionError}</p>{/if}
    <QueueBoard view={data.board} {busy} {act} />
  </div>
</section>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="D / The loop, end to end"
      title={['What it could not do,', 'and what that built']}
      strap="Seven stages in the order the work flows: a capability the appetite scan wants, a fault daydreaming raises, an idea self-improve queues, a tool it ships, a signal that tool becomes, a finding the sweep keeps, a thought that finding shapes. The first zero after a non-zero is where the loop is stuck."
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

<section class="band" id="doctor">
  <div class="inner">
    <SectionHead
      kicker="E / The doctor"
      title={['What broke,', 'and who fixed it']}
      strap="Failed canvas runs, triaged nightly over a rolling week. It stops a runaway schedule itself and repairs node config inside a narrow whitelist; anything needing repo code becomes a fault, which is the same queue everything above is drawn from. That is the fold — not a shared page, a shared ledger."
    />
    {#if doctor.error}
      <div class="card t-urgent"><p class="card-body">The doctor's ledger could not be read: {doctor.error}</p></div>
    {:else}
      <RollupGrid cells={doctorCells} min={190} />
      <p class="note">
        Runs at {data.doctorWindow.window}{data.doctorWindow.active ? '' : ' — the activity is paused'}.
        {#if doctor.lastRunAt}Last run {doctor.lastRunStatus}.{:else}No run recorded yet.{/if}
        <a href="/jkai/daydreams/doctor">Open the full report →</a>
      </p>
    {/if}
  </div>
</section>

<style>
  .ledger {
    margin-top: clamp(28px, 4vw, 56px);
    padding-top: clamp(24px, 3vw, 40px);
    border-top: 2px solid var(--text-primary);
  }
</style>
