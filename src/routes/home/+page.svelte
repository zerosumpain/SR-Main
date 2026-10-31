<script lang="ts">
  // The house, now. One slice of each page under /home — who is in, what the
  // Echoes read and hold, what was last said, and whether Home Assistant is
  // healthy — each a way into its own page. Every card loads on its own, so a
  // source that is down says so in its own place.
  import type { PageData } from './$types';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import type { DeckTile, RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import type { Tone } from '$lib/daydream/priority';
  import { ago } from '$lib/daydream/format';
  import TodayAhead from '$lib/components/home/people/TodayAhead.svelte';

  type Ahead = NonNullable<Awaited<PageData['ahead']>>;

  let { data }: { data: PageData } = $props();

  // The day ahead streams; keep the last answer while a refresh reads the next.
  let ahead = $state<Ahead | null>(null);
  let aheadState = $state<'pending' | 'ready' | 'failed'>('pending');
  $effect(() => {
    const promise = data.ahead;
    let current = true;
    promise.then((v) => {
      if (!current) return;
      if (v) {
        ahead = v;
        aheadState = 'ready';
      } else if (!ahead) aheadState = 'failed';
    });
    return () => {
      current = false;
    };
  });
  const aheadNames = $derived(new Map(Object.entries(ahead?.names ?? {})));

  /** Over this many minutes without a fix, "home" is a guess — as on /home/people. */
  const STALE_MINS = 30;

  const TIME = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // ── Who is in ──────────────────────────────────────────────────────────
  type Member = PageData['members'][number];
  function memberTone(m: Member): Tone {
    if (m.ageMins == null) return 'quiet';
    if (m.ageMins > STALE_MINS) return 'watch';
    return m.isHome ? 'good' : 'steady';
  }
  function memberSub(m: Member): string {
    if (m.ageMins == null) return 'not on the trail';
    const bits: string[] = [];
    if (!m.isHome) bits.push(m.placeLabel ? `at ${m.placeLabel}` : m.distanceHomeKm != null ? `${m.distanceHomeKm} km away` : 'out');
    if (m.batteryPct != null) bits.push(`${m.batteryPct}%`);
    if (m.ageMins > STALE_MINS) bits.push(`seen ${Math.round(m.ageMins / 60)}h ago`);
    return bits.join(' · ') || 'at home';
  }
  const people = $derived<RollupCell[]>(
    data.members.map((m) => ({
      key: m.subject,
      label: cap(m.subject),
      value: m.ageMins == null ? '—' : m.isHome ? 'home' : 'out',
      sub: memberSub(m),
      tone: memberTone(m),
      href: `/home/people#p-${m.subject}`,
    })),
  );
  const inCount = $derived(data.members.filter((m) => m.ageMins != null && m.isHome).length);

  // ── The Echoes ─────────────────────────────────────────────────────────
  const h = $derived(data.house);
  const temp = $derived(h.now.find((r) => r.kind === 'temperature'));
  const light = $derived(h.now.find((r) => r.kind === 'illuminance'));
  const next = $derived(h.pending[0] ?? null);
  const track = $derived(h.listening.recent[0] ?? null);
  const KIND: Record<string, string> = { alarm: 'Alarm', timer: 'Timer', reminder: 'Reminder' };

  const echoTiles = $derived<DeckTile[]>([
    {
      key: 'temp',
      label: temp ? `${temp.room ?? temp.device} · temperature` : 'Temperature',
      value: temp?.value != null ? String(temp.value) : '—',
      suffix: temp ? '°C' : null,
      tone: 'steady',
      sub: temp ? `changed ${ago(temp.at)}` : 'no Echo reports one',
    },
    {
      key: 'light',
      label: light ? `${light.room ?? light.device} · light` : 'Light',
      value: light?.value != null ? String(Math.round(light.value)) : '—',
      suffix: light ? ' lx' : null,
      tone: 'quiet',
      sub: light ? `changed ${ago(light.at)}` : 'no Echo reports one',
    },
    {
      key: 'next',
      label: next ? `Next ${KIND[next.kind].toLowerCase()}` : 'Alarms & timers',
      value: next ? TIME.format(new Date(next.dueAt)).replace(/^\w+ /, '') : 'None',
      tone: next ? 'action' : 'quiet',
      sub: next ? `${next.room ?? next.device} · ${TIME.format(new Date(next.dueAt)).split(' ')[0]}` : 'nothing set on any Echo',
    },
    {
      key: 'track',
      label: 'Last played',
      value: track ? track.title : '—',
      tone: 'steady',
      sub: track ? `${track.artist ?? 'unknown artist'} · ${track.room ?? track.device} · ${ago(track.at)}` : 'nothing today',
    },
  ]);

  // ── Devices ────────────────────────────────────────────────────────────
  const dv = $derived(data.devices);
  const broken = $derived(dv ? dv.integrations.filter((i) => i.verdict === 'down' || i.verdict === 'degraded') : []);

  const summary = $derived([
    ...(data.showPeople ? [{ label: 'In', value: `${inCount}/${data.members.length || 5}`, sub: 'of the household' }] : []),
    ...(data.showEchoes
      ? [{ label: 'Indoors', value: temp?.value != null ? `${temp.value}°` : '—', sub: temp ? temp.room ?? temp.device : 'no reading' }]
      : []),
    { label: 'Needs a look', value: dv ? String(broken.length) : '—', sub: dv ? 'integrations' : 'HA unreachable' },
  ]);
</script>

<HomeFrame
  path="/home"
  kicker="Home · Now"
  title={['The house,', 'right now']}
  standfirst="Who is in, what the Echoes read and heard, and whether Home Assistant is healthy — a slice of each page under Home, each one a way in."
  {summary}
  footer={['strangeramblings.com/home', 'Life360, Alexa and Home Assistant', 'The owner, and people given Home access']}
>
  {#if data.showPeople}
  <section class="band">
    <div class="inner">
      <SectionHead kicker="A / People" title={['Who is', 'in']} strap="From the family trail — Life360 through Home Assistant, every two minutes." />
      {#if data.familyError}
        <LoadErrorCard kicker="The household did not load" message={data.familyError} />
      {:else}
        <RollupGrid cells={people} min={180} />
      {/if}
      <p class="more"><a class="link" href="/home/people">Today's movements and each person's patterns →</a></p>
      {#if data.showBacklog}
        <p class="more"><a class="link" href="/home/backlog">What the family wants to watch — the backlog →</a></p>
      {/if}
    </div>
  </section>
  {/if}

  {#if data.showPeople}
  <section class="band sunken">
    <div class="inner">
      <SectionHead kicker="B / Ahead" title={['The rest of', 'today']} strap="Where each person's own routines put them until midnight, and the journeys between. Learned from the trips they have made; school holidays honoured." />
      {#if ahead}
        <TodayAhead ahead={ahead.ahead} names={aheadNames} now={ahead.now} />
        {#if ahead.changes.length}
          <ul class="changes">
            {#each ahead.changes as c (c.key)}
              <li><strong>{c.title}</strong> <span>{c.detail}</span></li>
            {/each}
          </ul>
        {/if}
      {:else if aheadState === 'failed'}
        <LoadErrorCard kicker="The day ahead did not load" message="Routines could not be read just now; who is in, above, is unaffected." />
      {:else}
        <p class="note">Reading the routines…</p>
      {/if}
      {#if ahead?.isOwner}
        <p class="more"><a class="link" href="/home/people/forecast">How good the forecast is, what changed, and where next →</a></p>
        <p class="more"><a class="link" href="/home/people/patterns">Ninety days of movement patterns: places, times, who is with whom, steps →</a></p>
      {:else}
        <p class="more"><a class="link" href="/home/people">Your routines, what changed, and your week →</a></p>
      {/if}
    </div>
  </section>
  {/if}

  {#if data.showEchoes}
  <section class="band">
    <div class="inner">
      <SectionHead kicker="C / Echoes" title={['What the Echoes', 'read']} strap="Room sensors, the next alarm or timer set on any Echo, and the last track played today." />
      {#if data.houseError}
        <LoadErrorCard kicker="The Echo signals did not load" message={data.houseError} />
      {:else}
        <StatDeck tiles={echoTiles} min={220} />
      {/if}
      <p class="more"><a class="link" href="/home/echoes">Temperature history, schedule and listening →</a></p>
    </div>
  </section>
  {/if}

  {#if data.showVoice}
  <section class="band sunken">
    <div class="inner">
      <SectionHead kicker="D / Voice" title={['Lately', 'said']} strap="The newest things said to an Echo, and what Alexa said back." />
      {#if data.saidError}
        <LoadErrorCard kicker="The voice log did not load" message={data.saidError} />
      {:else}
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>When</th><th>Said</th><th>Where</th></tr></thead>
            <tbody>
              {#each data.said as u (u.id)}
                <tr>
                  <td class="nowrap">{ago(u.occurredAt)}</td>
                  <td class="lead">{u.command}{#if u.reply}<span class="reply">{u.reply}</span>{/if}</td>
                  <td class="nowrap">{u.room ?? u.device}</td>
                </tr>
              {:else}
                <tr><td colspan="3">Nothing said yet.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      <p class="more"><a class="link" href="/home/voice">The whole log, by room, person and topic →</a></p>
    </div>
  </section>
  {/if}

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="E / Devices"
        title={broken.length ? ['What is', 'not working'] : ['Everything is', 'answering']}
        strap="Home Assistant integrations that are down, or with a quarter or more of their devices unavailable."
      />
      {#if data.devicesError}
        <LoadErrorCard kicker="Home Assistant could not be read" message={data.devicesError} />
      {:else if broken.length}
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Integration</th><th class="right">Unavailable</th></tr></thead>
            <tbody>
              {#each broken as i (i.id)}
                <tr>
                  <td class="lead"><span class="pill {i.verdict === 'down' ? 't-urgent' : 't-watch'}">{i.verdict}</span> {i.label}</td>
                  <td class="right num">{i.unavailable} / {i.entities}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="note good">All {dv?.integrations.length ?? 0} integrations are running.</p>
      {/if}
      <p class="more"><a class="link" href="/home/devices">Every integration and battery →</a></p>
    </div>
  </section>
</HomeFrame>

<style>
  .more {
    margin: 16px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .changes {
    list-style: none;
    margin: 18px 0 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .changes li {
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .changes span {
    display: block;
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
  }
  .reply {
    display: block;
    margin-top: 3px;
    color: var(--text-muted);
  }
</style>
