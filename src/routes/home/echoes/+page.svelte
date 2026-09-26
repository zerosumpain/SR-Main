<script lang="ts">
  // What the Echoes sense and hold beyond speech: room temperature, light and
  // motion, the alarms, timers and reminders they are holding, and what they
  // played. Reads `alexa_signals`; jkai's `alexa_home_signals` answers from
  // the same numbers. Was the House tab of /jkai/voice.
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import Sparkline from '$lib/components/jkai/daydream/Sparkline.svelte';
  import type { DeckTile, Facet } from '$lib/components/jkai/daydream/hub/types';
  import { ago } from '$lib/daydream/format';

  let { data }: { data: PageData } = $props();

  // Pinned to Europe/London — the server runs UTC, and "bedtime" is the house's.
  const WHEN = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const hs = $derived(data.house);
  const KIND_LABEL: Record<string, string> = { alarm: 'Alarm', timer: 'Timer', reminder: 'Reminder' };
  // A busy kitchen sets a dozen timers on a Sunday; the newest few say what the
  // table is for, and jkai's `alexa_home_signals` reaches the rest.
  const SCHEDULE_ROWS = 15;

  const roomTiles = $derived<DeckTile[]>(
    hs.now.map((r): DeckTile => {
      const where = r.room ?? r.device;
      if (r.kind === 'temperature') {
        return { key: `${r.device}|t`, label: `${where} · temperature`, value: String(r.value ?? '—'), suffix: '°C', tone: 'steady', sub: `changed ${ago(r.at)}` };
      }
      if (r.kind === 'illuminance') {
        return { key: `${r.device}|l`, label: `${where} · light`, value: String(Math.round(r.value ?? 0)), suffix: ' lx', tone: 'quiet', sub: `changed ${ago(r.at)}` };
      }
      const m = hs.motion.find((x) => x.device === r.device);
      return {
        key: `${r.device}|m`,
        label: `${where} · motion`,
        value: r.text === 'on' ? 'Moving' : 'Still',
        tone: r.text === 'on' ? 'watch' : 'quiet',
        sub: m?.lastOnAt ? `last movement ${ago(m.lastOnAt)} · ${m.onCount} in ${hs.window.days} days` : 'no movement seen yet',
      };
    }),
  );

  // Hour labels for the sparkline tooltip, on the house's clock.
  const HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  const windowFacets = $derived<Facet[]>(data.windows.map((d) => ({ id: String(d), label: d === 365 ? '1 year' : `${d} days` })));
  function pickWindow(id: string) {
    goto(`?days=${id}`, { keepFocus: true, noScroll: true });
  }

  const temp = $derived(hs.now.find((r) => r.kind === 'temperature'));
  const summary = $derived([
    { label: 'Temperature', value: temp?.value != null ? `${temp.value}°` : '—', sub: temp ? temp.room ?? temp.device : 'no sensor' },
    { label: 'Pending', value: String(hs.pending.length), sub: 'alarms · timers · reminders' },
    { label: 'Tracks', value: String(hs.listening.plays), sub: `last ${hs.window.days} days` },
  ]);
</script>

<HomeFrame
  path="/home/echoes"
  kicker="Home · The Echoes"
  title={['What the Echoes', 'sense and hold']}
  standfirst="Room readings, the alarms and timers each Echo is holding, and what they played — read from Home Assistant every five minutes."
  {summary}
  footer={[
    'strangeramblings.com/home/echoes',
    hs.firstAt ? `Recording since ${WHEN.format(new Date(hs.firstAt))}` : 'Recording from the first sync',
    'The owner, and people given Home access',
  ]}
>
  <section class="band flush-top">
    <div class="inner">
      <FacetBar label="Window" active={String(data.days)} facets={windowFacets} onpick={pickWindow} />
    </div>
  </section>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The Echo signals could not be read" message={data.loadError} /></div></section>
  {/if}
  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / Rooms"
        title={['What the Echoes', 'sense']}
        strap="Temperature, light and motion from the Echoes that have the sensors. Home Assistant asks Amazon every five minutes, so a brief movement between two asks is never seen."
      />
      {#if roomTiles.length}
        <StatDeck tiles={roomTiles} min={220} />
      {:else}
        <div class="card quiet"><p class="card-body">No room readings yet. The first land within five minutes of the sync starting.</p></div>
      {/if}
      {#each hs.temperature as t (t.device)}
        {#if t.points.length >= 2}
          <div class="chart">
            <p class="field-label">{t.room ?? t.device} · hourly °C · {t.min}–{t.max}</p>
            <Sparkline
              points={t.points.map((p) => ({ label: HOUR.format(new Date(p.at)), value: p.value }))}
              format={(v) => `${v.toFixed(1)} °C`}
              height={64}
            />
          </div>
        {/if}
      {/each}
    </div>
  </section>

  <section class="band sunken">
    <div class="inner">
      <SectionHead
        kicker="B / Schedule"
        title={['Alarms, timers', 'and reminders']}
        strap="A row is a new due time on an Echo, seen within five minutes of being set; a repeating alarm appears again each day it rolls on. Cancelling is not recorded — Home Assistant cannot tell it from the Echo dropping offline — so one cancelled early stays pending until it would have gone off."
      />
      <div class="pair top">
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Pending now</th><th>Device</th><th class="right">Due</th></tr></thead>
            <tbody>
              {#each hs.pending as p (p.device + p.kind)}
                <tr><td class="lead">{KIND_LABEL[p.kind]}</td><td>{p.room ?? p.device}</td><td class="right nowrap">{WHEN.format(new Date(p.dueAt))}</td></tr>
              {:else}
                <tr><td colspan="3">Nothing set on any Echo.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Came into view</th><th>What</th><th>Device</th><th class="right">For</th></tr></thead>
            <tbody>
              {#each hs.scheduled.slice(0, SCHEDULE_ROWS) as p (p.device + p.kind + p.setAt)}
                <tr>
                  <td class="nowrap">{WHEN.format(new Date(p.setAt))}</td>
                  <td class="lead">{KIND_LABEL[p.kind]}</td>
                  <td>{p.room ?? p.device}</td>
                  <td class="right nowrap">{WHEN.format(new Date(p.dueAt))}</td>
                </tr>
              {:else}
                <tr><td colspan="4">No alarm, timer or reminder in the last {hs.window.days} days.</td></tr>
              {/each}
            </tbody>
          </table>
          {#if hs.scheduled.length > SCHEDULE_ROWS}
            <p class="note in-tbl">The newest {SCHEDULE_ROWS} of {hs.scheduled.length}{hs.scheduled.length >= 200 ? '+' : ''}. Ask jkai for the rest.</p>
          {/if}
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="C / Listening"
        title={['What the Echoes', 'played']}
        strap="One row per track starting. This arrives by Amazon's push feed, the same one the voice log rides, so when the voice log goes quiet this does too."
      />
      {#if hs.listening.plays === 0}
        <div class="card quiet">
          <p class="card-body">
            Nothing played in the last {hs.window.days} days — or Home Assistant is not receiving Amazon's push feed. If the
            voice log is quiet as well, it is the feed.
          </p>
        </div>
      {:else}
        <div class="pair">
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>When</th><th>Track</th><th>Artist</th><th>Where</th></tr></thead>
              <tbody>
                {#each hs.listening.recent as r (r.device + r.at)}
                  <tr>
                    <td class="nowrap">{WHEN.format(new Date(r.at))}</td>
                    <td class="lead said">{r.title}</td>
                    <td>{r.artist ?? '—'}</td>
                    <td class="nowrap">{r.room ?? r.device}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Artist</th><th class="right">Tracks</th></tr></thead>
              <tbody>
                {#each hs.listening.topArtists as a (a.key)}
                  <tr><td class="lead">{a.key}</td><td class="right num">{a.n}</td></tr>
                {:else}
                  <tr><td colspan="2">No artist names came with these tracks.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>
  </section>
</HomeFrame>
