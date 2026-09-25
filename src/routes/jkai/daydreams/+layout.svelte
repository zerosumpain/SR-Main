<script lang="ts">
  // The daydream hub's chrome, worn by every room.
  //
  // Twelve rooms, twelve routes. This layout is the cover, the rail and the
  // foot; a room is whatever renders between them. The rail is a row of real
  // links, so a tab is a navigation and never a `?tab=` state change — the
  // same-route trap that killed five shipped links lives in git history now.
  //
  // The rooms render inside `DsVocab`, which carries the shared CSS vocabulary
  // (band, card, pill, tag, table, button) — /home's pages wear it too.
  import type { Snippet } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import DsVocab from '$lib/components/jkai/daydream/hub/DsVocab.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import { HUB_BASE, hubTabs, isRoom } from '$lib/daydream/hub';
  import { ago, pct } from '$lib/daydream/format';
  import { postThought } from '$lib/daydream/feed-client';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const counts = $derived(data.counts);
  const tabs = $derived(hubTabs(counts));
  const active = $derived.by(() => {
    const seg = page.url.pathname.slice(HUB_BASE.length + 1).split('/')[0];
    return isRoom(seg) ? seg : 'feed';
  });

  let togglingEnabled = $state(false);
  async function toggleEnabled() {
    togglingEnabled = true;
    const r = await postThought({ action: 'set_enabled', enabled: !data.enabled });
    if (!r.ok) console.error('[daydream] toggle failed:', r.error);
    else await invalidateAll();
    togglingEnabled = false;
  }


  // The cover reports the think loop and nothing else. It used to count places
  // to name, rules to approve and the health of two dozen jobs — the engine the
  // 2026-09-25 simplification retired — so a paused job read as a failure here.
  const think = $derived(counts.think);
  const readout = $derived([
    { label: 'Last cycle', value: think.lastCycleAt ? ago(think.lastCycleAt) : 'never' },
    { label: 'Cadence', value: 'every 45 min' },
    { label: 'Interrupts', value: 'up to 4 a day' },
  ]);

  const coverTiles = $derived<DeckTile[]>([
    {
      key: 'noticed',
      label: 'Noticed, 7 days',
      value: String(think.week),
      tone: 'steady',
      sub: 'notes written, each citing what it read',
    },
    {
      key: 'rate',
      label: 'Waiting on you',
      value: String(counts.notesToRate),
      tone: counts.notesToRate ? 'action' : 'good',
      lit: counts.notesToRate > 0,
      sub: counts.notesToRate ? 'rate them — it learns from the verdicts' : 'every note rated',
    },
    {
      key: 'useful',
      label: 'Useful, 30 days',
      value: think.rated30d ? pct(think.useful30d / think.rated30d) : '—',
      tone: 'steady',
      sub: `${think.useful30d} of ${think.rated30d} rated`,
    },
    {
      key: 'watches',
      label: 'Active watches',
      value: String(counts.activeWatches),
      tone: counts.activeWatches ? 'steady' : 'quiet',
      sub: counts.activeWatches ? 'checked on their own schedules' : 'nothing being watched',
    },
  ]);
</script>

<svelte:head><title>Daydreams — JKAI</title></svelte:head>

<DaydreamShell
  path="/jkai/daydreams"
  kicker="JKAI · Background intelligence"
  title={['Spare cycles,', 'one question each']}
  standfirst="Every 45 minutes it takes one part of your life — health, home, mail, chat, diary, money or something to read — and looks into it with read-only tools. It writes at most two notes, each citing what it read. Up to four a day reach you; the rest wait here."
  {readout}
  live={data.enabled}
  liveBusy={togglingEnabled}
  ontoggleLive={toggleEnabled}
  {tabs}
  {active}
  footer={[
    'strangeramblings.com/jkai/daydreams',
    'Owner-gated · nothing here leaves the house',
    `${think.useful30d} useful of ${think.rated30d} rated, 30 days`,
  ]}
>
  {#snippet masthead()}
    <StatDeck dark tiles={coverTiles} min={210} />
  {/snippet}

  <DsVocab>
    {#if data.hubError}
      <section class="band">
        <div class="inner">
          <div class="card t-urgent">
            <p class="card-kicker">The counts did not load</p>
            <p class="card-body">{data.hubError}</p>
            <p class="note">
              Every badge and tile above is therefore a zero for a reason that has nothing to
              do with what the engine has been noticing. The room below loads on its own.
            </p>
          </div>
        </div>
      </section>
    {/if}

    {#if !data.enabled}
      <section class="band">
        <div class="inner">
          <div class="card t-watch">
            <p class="card-kicker">Paused</p>
            <p class="card-body">
              Nothing is being observed and nothing is being noticed. The control in the masthead
              resumes it; everything below is the state it was in when it stopped.
            </p>
          </div>
        </div>
      </section>
    {/if}

    {@render children()}
  </DsVocab>
</DaydreamShell>

