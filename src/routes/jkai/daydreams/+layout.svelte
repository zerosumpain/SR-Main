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


  // The cover says what daydream is in one breath, then the four figures a
  // reader needs before opening anything: what is waiting on them, what is
  // running without them, whether it is worth having, and what is watched.
  const think = $derived(counts.think);
  const waiting = $derived(counts.notesToRate + counts.checks.waiting);
  const tabs = $derived(hubTabs({ ...counts, checksWaiting: counts.checks.waiting }));
  const readout = $derived([
    { label: 'Last look', value: think.lastCycleAt ? ago(think.lastCycleAt) : 'never' },
    { label: 'Looks', value: 'every 45 min, 07–23' },
    { label: 'Messages you', value: 'up to 4 a day' },
  ]);

  const coverTiles = $derived<DeckTile[]>([
    {
      key: 'waiting',
      label: 'Waiting on you',
      value: String(waiting),
      tone: waiting ? 'action' : 'good',
      lit: waiting > 0,
      sub: waiting
        ? [counts.notesToRate ? `${counts.notesToRate} to answer` : '', counts.checks.waiting ? `${counts.checks.waiting} to sign off` : ''].filter(Boolean).join(' · ')
        : 'all caught up',
    },
    {
      key: 'motion',
      label: 'In motion',
      value: String(counts.checks.running),
      tone: counts.checks.running ? 'steady' : 'quiet',
      sub: counts.checks.running ? 'double-checks running or put off' : 'nothing running',
    },
    {
      key: 'useful',
      label: 'Worth knowing, 30 days',
      value: think.rated30d ? pct(think.useful30d / think.rated30d) : '—',
      tone: 'steady',
      sub: think.rated30d ? `${think.useful30d} of the ${think.rated30d} you answered` : 'answer a few to see this',
    },
    {
      key: 'week',
      label: 'Spotted, 7 days',
      value: String(think.week),
      tone: 'quiet',
      sub: 'each one cites what it read',
    },
  ]);
</script>

<svelte:head><title>Daydreams — JKAI</title></svelte:head>

<DaydreamShell
  path="/jkai/daydreams"
  kicker="JKAI · Daydream"
  title={['Spotted while', 'you were busy']}
  standfirst="Every 45 minutes jkai takes one corner of your life — health, home, mail, chats, diary, money, or something worth reading — and looks for one thing worth your attention. It only reads; it never acts on its own. You decide what happens next: keep it, have it double-checked, or tell it to stop."
  {readout}
  live={data.enabled}
  liveBusy={togglingEnabled}
  ontoggleLive={toggleEnabled}
  {tabs}
  {active}
  footer={[
    'strangeramblings.com/jkai/daydreams',
    'Owner-gated · nothing here leaves the house',
    `${think.useful30d} worth knowing of ${think.rated30d} answered, 30 days`,
  ]}
>
  {#snippet masthead()}
    <StatDeck dark tiles={coverTiles} min={150} />
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

