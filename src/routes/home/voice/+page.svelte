<script lang="ts">
  // What the house says to Alexa, and what Alexa says back.
  //
  // Two tabs: the numbers (volume, time of day, who, where, what about, and how
  // often Alexa missed) and the log itself. Everything here reads
  // `alexa_utterances`, filled every five minutes from Home Assistant; the same
  // numbers are what jkai's `alexa_voice_summary` tool answers from. Was
  // /jkai/voice; what the Echoes sense beyond speech is /home/echoes.
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import Sparkline from '$lib/components/jkai/daydream/Sparkline.svelte';
  import type { DeckTile, Facet, RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import { ago } from '$lib/daydream/format';
  import { VOICE_TOPIC_LABEL, isVoiceTopic } from '$lib/alexa/types';

  let { data }: { data: PageData } = $props();

  const s = $derived(data.summary);

  type Tab = 'overview' | 'log';
  let tab = $state<Tab>('overview');
  const tabs = $derived([
    { id: 'overview', label: 'Overview' },
    { id: 'log', label: 'Log', count: data.rows.length },
  ]);

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

  function topicLabel(key: string): string {
    return isVoiceTopic(key) ? VOICE_TOPIC_LABEL[key] : key === 'untagged' ? 'Not yet tagged' : key;
  }
  function pct(n: number, of: number): string {
    return of > 0 ? `${Math.round((n / of) * 100)}%` : '—';
  }
  function hh(h: number): string {
    return `${String(h).padStart(2, '0')}:00`;
  }

  // ── The deck ───────────────────────────────────────────────────────────
  const busiestHour = $derived.by(() => {
    let best = -1;
    let n = 0;
    s.byHour.forEach((v, h) => {
      if (v > n) {
        n = v;
        best = h;
      }
    });
    return best;
  });
  const topSpeaker = $derived(s.byPerson.find((p) => p.key !== 'Unrecognised') ?? null);
  const delta = $derived(s.previousTotal > 0 ? Math.round(((s.total - s.previousTotal) / s.previousTotal) * 100) : null);

  const tiles = $derived<DeckTile[]>([
    {
      key: 'total',
      label: `Last ${s.window.days} days`,
      value: String(s.total),
      tone: 'steady',
      lit: true,
      sub:
        delta == null
          ? `${(s.total / s.window.days).toFixed(1)} a day`
          : `${(s.total / s.window.days).toFixed(1)} a day · ${delta >= 0 ? '+' : ''}${delta}% on the ${s.window.days} before`,
    },
    {
      key: 'missed',
      label: 'Alexa missed',
      value: pct(s.missed, s.total),
      tone: s.total && s.missed / s.total > 0.2 ? 'watch' : 'quiet',
      sub: `${s.missed} began "sorry" or "hmm"`,
    },
    {
      key: 'hour',
      label: 'Busiest hour',
      value: busiestHour >= 0 ? hh(busiestHour) : '—',
      tone: 'steady',
      sub: busiestHour >= 0 ? `${s.byHour[busiestHour]} utterances` : 'nothing yet',
    },
    {
      key: 'who',
      label: 'Most heard',
      value: topSpeaker?.key ?? '—',
      tone: 'steady',
      sub: topSpeaker ? `${pct(topSpeaker.n, s.total)} of the window · by voice ID` : 'voice ID recognised nobody',
    },
  ]);

  // ── Rollups ────────────────────────────────────────────────────────────
  const deviceCells = $derived<RollupCell[]>(
    s.byDevice.map((d) => ({
      key: d.key,
      label: d.key,
      mark: d.room,
      value: String(d.n),
      corner: pct(d.n, s.total),
      tone: 'steady',
      onclick: () => openLog({ device: d.key }),
    })),
  );
  const topicCells = $derived<RollupCell[]>(
    s.byTopic.map((t) => ({
      key: t.key,
      label: topicLabel(t.key),
      value: String(t.n),
      corner: pct(t.n, s.total),
      tone: t.key === 'untagged' ? 'quiet' : 'steady',
      sub: t.key === 'untagged' ? 'tagged overnight' : null,
      onclick: isVoiceTopic(t.key) ? () => openLog({ topic: t.key }) : null,
    })),
  );
  const personCells = $derived<RollupCell[]>(
    s.byPerson.map((p) => ({
      key: p.key,
      label: p.key,
      value: String(p.n),
      corner: pct(p.n, s.total),
      tone: p.key === 'Unrecognised' ? 'quiet' : 'steady',
      onclick: () => openLog({ person: p.key }),
    })),
  );

  // ── Hour of day ────────────────────────────────────────────────────────
  const hourMax = $derived(Math.max(1, ...s.byHour));
  const BAR_W = 20;
  const GAP = 2;
  const CH = 120;

  // ── The log ────────────────────────────────────────────────────────────
  let q = $state('');
  let device = $state('all');
  let person = $state('all');
  let topic = $state('all');
  let missedOnly = $state(false);

  function openLog(f: { device?: string; person?: string; topic?: string }) {
    device = f.device ?? 'all';
    person = f.person ?? 'all';
    topic = f.topic ?? 'all';
    q = '';
    missedOnly = false;
    tab = 'log';
  }

  const MISS = /^(sorry|hmm|i (don'?t|do not) know|i'?m not sure|i didn'?t (catch|understand)|i can'?t (help|find)|i couldn'?t)/i;
  // An empty reply is Alexa just doing it (music, news), not a miss.
  const isMiss = (reply: string | null) => !!reply && MISS.test(reply);

  function facetsOf(key: (r: PageData['rows'][number]) => string): Facet[] {
    const counts = new Map<string, number>();
    for (const r of data.rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
    return [
      { id: 'all', label: 'All', count: data.rows.length },
      ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, label: id, count })),
    ];
  }
  const deviceFacets = $derived(facetsOf((r) => r.device));
  const personFacets = $derived(facetsOf((r) => r.personName ?? 'Unrecognised'));
  const topicFacets = $derived(
    facetsOf((r) => r.topic ?? 'untagged').map((f) => (f.id === 'all' ? f : { ...f, label: topicLabel(f.id) })),
  );

  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return data.rows.filter(
      (r) =>
        (device === 'all' || r.device === device) &&
        (person === 'all' || (r.personName ?? 'Unrecognised') === person) &&
        (topic === 'all' || (r.topic ?? 'untagged') === topic) &&
        (!missedOnly || isMiss(r.reply)) &&
        (!needle ||
          r.command.toLowerCase().includes(needle) ||
          (r.reply ?? '').toLowerCase().includes(needle) ||
          (r.intent ?? '').toLowerCase().includes(needle)),
    );
  });

  const windowFacets = $derived<Facet[]>(data.windows.map((d) => ({ id: String(d), label: d === 365 ? '1 year' : `${d} days` })));
  function pickWindow(id: string) {
    goto(`?days=${id}`, { keepFocus: true, noScroll: true });
  }

  const readout = $derived([
    { label: 'Last heard', value: s.lastAt ? ago(s.lastAt) : 'never' },
    { label: 'Devices', value: String(s.byDevice.length) },
    { label: 'Logged', value: String(s.allTime) },
  ]);
</script>

<HomeFrame
  path="/home/voice"
  kicker="Home · Voice log"
  title={['What the house', 'says to Alexa']}
  standfirst="Every command spoken to an Echo, what Alexa said back, where and when — read from Home Assistant every five minutes, tagged by topic overnight. Ask jkai about it in chat."
  summary={readout}
  {tabs}
  active={tab}
  ontab={(id) => (tab = id as Tab)}
  footer={[
    'strangeramblings.com/home/voice',
    s.firstAt ? `Logging since ${WHEN.format(new Date(s.firstAt))}` : 'Logging since the HA upgrade, 24 Sep 2026',
    'The owner, and people given Home access',
  ]}>
  <div class="vx">
    {#if data.loadError}
      <section class="band"><div class="inner"><LoadErrorCard kicker="The voice log could not be read" message={data.loadError} /></div></section>
    {/if}

    <section class="band flush-top">
      <div class="inner">
        <div class="window">
          <FacetBar label="Window" active={String(data.days)} facets={windowFacets} onpick={pickWindow} />
        </div>
      </div>
    </section>

    {#if tab === 'overview'}
      {#if s.allTime === 0}
        <section class="band">
          <div class="inner">
            <div class="card quiet">
              <p class="card-body">
                Nothing heard yet. The first utterance lands here within five minutes of someone saying "Alexa, …" to
                any Echo — Home Assistant's voice events only exist from the 2026.9 upgrade on 24 September, so there is
                no history before that to fetch.
              </p>
            </div>
          </div>
        </section>
      {:else}
        <section class="band">
          <div class="inner">
            <SectionHead
              kicker="A / Volume"
              title={['How much, and', 'when']}
              strap="Days and hours are the house's clock (Europe/London). Missed means Alexa opened its reply with a sorry or a hmm. Times are when Home Assistant heard of it, seconds after it was said."
            />
            <StatDeck {tiles} min={200} />

            {#if data.series.length >= 2}
              <div class="chart">
                <p class="field-label">Per day</p>
                <Sparkline points={data.series} format={(v) => `${Math.round(v)} utterances`} height={64} />
              </div>
            {/if}

            <div class="chart">
              <p class="field-label">By hour of day, {s.window.days} days</p>
              <svg
                class="hours"
                viewBox="0 0 {24 * (BAR_W + GAP)} {CH + 18}"
                role="img"
                aria-label="Utterances by hour of day"
              >
                <line x1="0" x2={24 * (BAR_W + GAP)} y1={CH} y2={CH} class="base" />
                {#each s.byHour as n, h (h)}
                  {@const bh = n ? Math.max(2, (n / hourMax) * (CH - 4)) : 0}
                  <g>
                    <title>{hh(h)}–{hh((h + 1) % 24)}: {n} utterance{n === 1 ? '' : 's'}</title>
                    <rect x={h * (BAR_W + GAP)} y="0" width={BAR_W + GAP} height={CH} class="hit" />
                    {#if bh}
                      <rect x={h * (BAR_W + GAP) + GAP / 2} y={CH - bh} width={BAR_W} height={bh} rx="2" class="bar" />
                    {/if}
                    {#if h % 3 === 0}
                      <text x={h * (BAR_W + GAP) + BAR_W / 2} y={CH + 14} text-anchor="middle" class="tick">{String(h).padStart(2, '0')}</text>
                    {/if}
                  </g>
                {/each}
              </svg>
            </div>
          </div>
        </section>

        <section class="band sunken">
          <div class="inner">
            <SectionHead
              kicker="B / Who, where, what"
              title={['Rooms, voices', 'and topics']}
              strap="Pick a cell to open the log filtered to it. Speakers are Alexa voice ID's guess; topics come from a fixed list, tagged overnight."
            />
            {#if deviceCells.length}
              <div class="rollup">
                <p class="field-label">By device</p>
                <RollupGrid cells={deviceCells} min={190} dense />
              </div>
            {/if}
            {#if topicCells.length}
              <div class="rollup">
                <p class="field-label">By topic</p>
                <RollupGrid cells={topicCells} min={170} dense />
              </div>
            {/if}
            {#if personCells.length}
              <div class="rollup">
                <p class="field-label">By speaker</p>
                <RollupGrid cells={personCells} min={170} dense />
              </div>
            {/if}
          </div>
        </section>

        <section class="band">
          <div class="inner">
            <SectionHead
              kicker="C / Habits"
              title={['Said most', 'often']}
              strap="The exact phrases repeated most in the window, and Amazon's own name for what it thought was asked."
            />
            <div class="pair">
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead><tr><th>Phrase</th><th class="right">Times</th></tr></thead>
                  <tbody>
                    {#each s.topCommands as c (c.key)}
                      <tr><td class="lead">{c.key}</td><td class="right num">{c.n}</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead><tr><th>Amazon intent</th><th class="right">Times</th></tr></thead>
                  <tbody>
                    {#each s.topIntents as c (c.key)}
                      <tr><td class="lead">{c.key}</td><td class="right num">{c.n}</td></tr>
                    {:else}
                      <tr><td colspan="2">Amazon sent no intent names in this window.</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      {/if}
    {:else}
      <section class="band">
        <div class="inner">
          <SectionHead
            kicker="Log"
            title={['Everything', 'that was said']}
            strap="Newest first. The search matches the command, the reply and Amazon's intent."
          />
          <div class="controls">
            <input class="search" type="search" placeholder="Search what was said…" bind:value={q} aria-label="Search the voice log" />
            <label class="miss"><input type="checkbox" bind:checked={missedOnly} /> Only where Alexa missed</label>
            <FacetBar label="Device" active={device} facets={deviceFacets} onpick={(id) => (device = id)} />
            <FacetBar label="Speaker" active={person} facets={personFacets} onpick={(id) => (person = id)} />
            <FacetBar label="Topic" active={topic} facets={topicFacets} onpick={(id) => (topic = id)} />
          </div>

          {#if shown.length === 0}
            <div class="card quiet"><p class="card-body">Nothing in the loaded log matches.</p></div>
          {:else}
            <div class="tbl-wrap">
              <table class="tbl">
                <thead><tr><th>When</th><th>Said</th><th>Alexa replied</th><th>Where</th><th>Who</th><th>Topic</th></tr></thead>
                <tbody>
                  {#each shown as r (r.id)}
                    <tr class:missed={isMiss(r.reply)}>
                      <td class="nowrap">{WHEN.format(new Date(r.occurredAt))}</td>
                      <td class="lead said">{r.command}</td>
                      <td class="reply">{r.reply ?? '—'}</td>
                      <td class="nowrap">{r.room ?? r.device}</td>
                      <td class="nowrap">{r.personName ?? '—'}</td>
                      <td class="nowrap">{r.topic ? topicLabel(r.topic) : '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          {#if data.rows.length >= data.logCap}
            <p class="note">
              Showing the newest {data.logCap} of {s.total} in the window. The numbers on Overview cover all of them, and
              jkai's search reaches the rest.
            </p>
          {/if}
        </div>
      </section>
    {/if}
  </div>
</HomeFrame>

<style>
  .hours {
    display: block;
    width: 100%;
    max-width: 720px;
    height: auto;
  }
  .hours .base {
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  .hours .hit {
    fill: transparent;
  }
  .hours .bar {
    fill: var(--accent-ink);
  }
  .hours g:hover .bar {
    fill: var(--accent);
  }
  .hours .tick {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-muted);
  }
  .rollup {
    margin-top: clamp(20px, 2.4vw, 32px);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0 20px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 22px;
  }
  .search {
    font: inherit;
    font-size: var(--fs-body-sm);
    padding: 9px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: var(--surface-card);
    color: var(--text-primary);
    max-width: 480px;
  }
  .search:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .miss {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }

  .tbl-wrap {
    overflow-x: auto;
    border: 1px solid var(--card-border);
  }
  .tbl {
    border-collapse: collapse;
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .tbl thead tr {
    background: var(--card-bg);
    border-bottom: 2px solid rgba(26, 16, 8, 0.2);
  }
  .tbl th {
    padding: 11px 12px;
    text-align: left;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tbl tbody tr {
    border-bottom: 1px solid var(--line-hair);
  }
  .tbl tbody tr:last-child {
    border-bottom: none;
  }
  .tbl tbody tr:hover {
    background: rgba(26, 16, 8, 0.05);
  }
  .tbl td {
    padding: 10px 12px;
    vertical-align: top;
    color: var(--text-secondary);
  }
  .tbl .right {
    text-align: right;
    width: 1%;
    white-space: nowrap;
  }
  .tbl .num {
    font-variant-numeric: tabular-nums;
  }
  .tbl .nowrap {
    white-space: nowrap;
  }
  .tbl .lead {
    color: var(--text-primary);
  }
  .tbl .said {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    min-width: 22ch;
  }
  .tbl .reply {
    min-width: 28ch;
    overflow-wrap: anywhere;
  }
  .tbl tr.missed .reply {
    color: var(--warn);
  }
</style>
