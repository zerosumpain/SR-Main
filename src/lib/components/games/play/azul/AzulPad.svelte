<script lang="ts">
  // Azul on a phone at the TV: the TV shows the whole table, the phone is the
  // hand. On my turn, step one is a tap on a colour at a factory or the centre;
  // step two is the pattern line (or the floor) it goes to, each choice saying
  // what would fit and what the floor would cost. Off my turn, my own board and
  // whose turn it is. Drives the same wire the app reads (`toWire` in
  // $lib/games/azul) and posts the same move
  // (`{ action: 'take', source, colour, line }`) through the party's act route.
  //
  // The pick is the only local state, and it is checked against the room on
  // every frame: if the tiles have gone, or the turn has, the pick goes too.
  import { onMount } from 'svelte';
  import type { WireRoom } from '$lib/games/azul';
  import AzulTile from '../../azul/AzulTile.svelte';
  import { playAct } from '../play-stream';

  let { code, room, skewMs }: { code: string; room: WireRoom; skewMs: number } = $props();

  type Source = 'centre' | number;
  type Player = WireRoom['players'][number];

  // Re-stated from azul.ts so its rules stay out of the browser.
  const COLOURS = ['blue', 'yellow', 'red', 'black', 'white'] as const;
  const FLOOR_PENALTIES = [1, 1, 2, 2, 2, 3, 3] as const;
  const wallColumn = (row: number, colour: string) => (COLOURS.indexOf(colour as (typeof COLOURS)[number]) + row) % 5;
  const wallColour = (row: number, col: number) => COLOURS[(((col - row) % 5) + 5) % 5];
  const penalty = (n: number) => FLOOR_PENALTIES.slice(0, Math.min(n, FLOOR_PENALTIES.length)).reduce((a, b) => a + b, 0);
  const rows = [0, 1, 2, 3, 4];

  let now = $state(Date.now());
  let sel = $state<{ source: Source; colour: string } | null>(null);
  let busy = $state(false);
  let toast = $state<{ text: string; good: boolean; key: number } | null>(null);

  // Plain handles, never reactive (svelte5-pitfalls §1).
  let ticker: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let toastSeq = 0;

  onMount(() => {
    ticker = setInterval(() => (now = Date.now()), 500);
    return () => {
      if (ticker) clearInterval(ticker);
      if (toastTimer) clearTimeout(toastTimer);
      ticker = null;
      toastTimer = null;
    };
  });

  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const seatedMe = $derived(!!me && me.seat !== null && me.status === 'joined');
  const myTurn = $derived(room.phase === 'playing' && !!me && room.turnId === room.meId);
  const turnPlayer = $derived(room.players.find((p) => p.id === room.turnId) ?? null);
  const remainingMs = $derived(room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - (now + skewMs)) : 0);
  const clock = $derived.by(() => {
    const s = Math.ceil(remainingMs / 1000);
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      return `${h}h ${Math.floor((s % 3600) / 60)}m`;
    }
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  const late = $derived(myTurn && remainingMs < 10_000);
  const lastLine = $derived(room.log.length ? room.log[room.log.length - 1].text : null);

  const poolOf = (source: Source) => (source === 'centre' ? room.centre : (room.factories[source] ?? []));
  const sourceName = (source: Source) => (source === 'centre' ? 'the centre' : `factory ${source + 1}`);
  const tiles = (n: number) => `${n} ${n === 1 ? 'tile' : 'tiles'}`;

  /** The pick, only while it still stands: my turn, and the tiles still there. */
  const pick = $derived.by(() => {
    if (!sel || !myTurn) return null;
    const colour = sel.colour;
    const count = poolOf(sel.source).filter((t) => t.c === colour).length;
    if (!count) return null;
    return { source: sel.source, colour, count, marker: sel.source === 'centre' && room.firstInCentre };
  });

  /** The centre's tiles, one group per colour, in the wall's colour order. */
  const centreGroups = $derived(
    COLOURS.map((c) => ({ c, n: room.centre.filter((t) => t.c === c).length })).filter((g) => g.n > 0),
  );

  /** Each place the pick may go, with what would happen there. */
  const choices = $derived.by(() => {
    if (!pick || !me) return [];
    const legal = room.canPlace[pick.colour as keyof typeof room.canPlace] ?? [];
    const floorNow = me.floor.length;
    const cost = (toFloor: number) => penalty(floorNow + toFloor) - penalty(floorNow);
    const out = rows.map((i) => {
      const line = me.lines[i];
      const cap = i + 1;
      const ok = legal.includes(i);
      const fit = Math.min(pick.count, cap - line.length);
      const spill = pick.count - Math.max(0, fit);
      const toFloor = spill + (pick.marker ? 1 : 0);
      let why = '';
      if (!ok) {
        if (line.length >= cap) why = 'Full';
        else if (line.length && line[0].c !== pick.colour) why = `Collecting ${line[0].c}`;
        else if (me.wall[i][wallColumn(i, pick.colour)] !== null) why = `${pick.colour[0].toUpperCase()}${pick.colour.slice(1)} is on the wall`;
        else why = 'Not this line';
      }
      const fills = ok && line.length + fit === cap;
      const say = !ok
        ? why
        : spill
          ? `${fit} fit, ${spill} to the floor`
          : fills
            ? `Fills the line`
            : `${line.length + fit} of ${cap}`;
      return { line: i as number | 'floor', ok, cap, have: line, fit: ok ? fit : 0, say, cost: ok ? cost(toFloor) : 0 };
    });
    const allFloor = pick.count + (pick.marker ? 1 : 0);
    out.push({ line: 'floor', ok: true, cap: 0, have: [], fit: 0, say: `All ${tiles(pick.count)} to the floor`, cost: cost(allFloor) });
    return out;
  });

  function say(text: string, good: boolean) {
    toast = { text, good, key: ++toastSeq };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), good ? 1400 : 2600);
  }

  function choose(source: Source, colour: string) {
    if (!myTurn || busy) return;
    if (sel && sel.source === source && sel.colour === colour) sel = null;
    else sel = { source, colour };
    navigator.vibrate?.(8);
  }

  async function place(line: number | 'floor') {
    const p = pick;
    if (!p || busy) return;
    busy = true;
    try {
      await playAct<WireRoom>(code, { action: 'take', source: p.source, colour: p.colour, line });
      sel = null;
      say(line === 'floor' ? `${p.count} ${p.colour} to the floor` : `${p.count} ${p.colour} to line ${line + 1}`, true);
      navigator.vibrate?.(15);
    } catch (err) {
      say(err instanceof Error ? err.message : 'That did not go through.', false);
    } finally {
      busy = false;
    }
  }

  const ordinal = (n: number) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };
  const mine = $derived(room.standings?.find((s) => s.id === room.meId) ?? null);
  const myRound = $derived(room.roundScores?.find((s) => s.id === room.meId) ?? null);
  const endReason = $derived(
    room.result?.reason === 'wall'
      ? 'Somebody finished a row of the wall.'
      : room.result?.reason === 'left'
        ? 'Everybody else left the table.'
        : room.result?.reason === 'tiles'
          ? 'The tiles ran out.'
          : '',
  );
</script>

{#snippet board(p: Player)}
  <section class="az-board" aria-label="My board">
    <div class="az-mid">
      <div class="az-lines">
        {#each rows as r (r)}
          <div class="az-line">
            {#each Array.from({ length: r + 1 }, (_, k) => k) as k (k)}
              <span class="az-slot">
                {#if p.lines[r][r - k]}<AzulTile c={p.lines[r][r - k].c} />{/if}
              </span>
            {/each}
          </div>
        {/each}
      </div>
      <div class="az-wall">
        {#each rows as r (r)}
          {#each rows as col (col)}
            <span class="az-cell"><AzulTile c={wallColour(r, col)} ghost={p.wall[r][col] === null} /></span>
          {/each}
        {/each}
      </div>
    </div>
    <div class="az-floor">
      {#each FLOOR_PENALTIES as pen, k (k)}
        <span class="az-fslot">
          <span class="az-slot">{#if p.floor[k]}<AzulTile c={p.floor[k].c} />{/if}</span>
          <span class="az-pen">−{pen}</span>
        </span>
      {/each}
    </div>
  </section>
{/snippet}

{#snippet bar()}
  <header class="az-bar">
    <span class="az-who" class:az-mineturn={myTurn}>
      {#if myTurn}Your turn{:else if turnPlayer}{turnPlayer.name} to play{:else}Waiting{/if}
    </span>
    {#if room.phaseEndsAt}
      <span class="az-clock" class:az-late={late}>{clock}</span>
    {/if}
  </header>
  <p class="az-meta">
    Round {room.round}{room.lastRound ? ' · last round' : ''} · {me?.score ?? 0} pts{me?.floorPenalty ? ` · floor −${me.floorPenalty}` : ''}
  </p>
{/snippet}

<div class="az">
  {#if room.phase === 'lobby'}
    <section class="az-centre">
      <p class="az-kicker">Azul</p>
      <p class="az-lead">Waiting for the TV to start…</p>
    </section>
  {:else if room.phase === 'countdown'}
    <section class="az-centre">
      <p class="az-kicker">Get ready</p>
      <p class="az-count">{Math.max(1, Math.ceil(remainingMs / 1000))}</p>
      <p class="az-lead">Take every tile of one colour. Fill your lines. The floor costs you.</p>
    </section>
  {:else if room.phase === 'finished' || room.phase === 'closed'}
    <section class="az-finish">
      <p class="az-kicker">Game over</p>
      <h1 class="az-title">
        {#if mine?.result === 'won'}You win{:else if mine?.result === 'drew'}A draw{:else if mine}{ordinal(mine.place)}{:else}Finished{/if}
      </h1>
      {#if mine}<p class="az-lead">{mine.score} points, {mine.rows} {mine.rows === 1 ? 'row' : 'rows'} done.</p>{/if}
      {#if endReason}<p class="az-lead az-quiet">{endReason}</p>{/if}

      {#if room.standings?.length}
        <h2 class="az-kicker az-gap">Standings</h2>
        <ol class="az-list">
          {#each room.standings as s (s.id)}
            <li class:az-me={s.id === room.meId}>
              <span>{s.place}. {s.name}{s.result === 'left' ? ' (left)' : ''}</span>
              <span>{s.score}{s.bonus?.points ? ` · +${s.bonus.points} bonus` : ''}</span>
            </li>
          {/each}
        </ol>
      {/if}
      {#if me && seatedMe}
        <h2 class="az-kicker az-gap">My wall</h2>
        {@render board(me)}
      {/if}
      <p class="az-lead az-quiet">The TV takes everyone back to the lobby.</p>
    </section>
  {:else if !me || me.seat === null}
    <section class="az-centre">
      <p class="az-kicker">Azul</p>
      <p class="az-lead">You are watching this one. The table is on the TV.</p>
    </section>
  {:else if room.phase === 'scoring'}
    <section class="az-finish">
      <p class="az-kicker">Round {room.round} scored</p>
      {#if myRound}
        <h1 class="az-title">{myRound.before} → {myRound.after}</h1>
        <p class="az-lead">
          {myRound.placements.length
            ? `${myRound.placements.length} ${myRound.placements.length === 1 ? 'tile' : 'tiles'} onto the wall for ${myRound.placements.reduce((a, x) => a + x.points, 0)}.`
            : 'Nothing onto the wall this time.'}
          {myRound.floor ? ` The floor cost ${myRound.floor}.` : ''}
        </p>
      {:else}
        <h1 class="az-title">{me.score}</h1>
      {/if}
      <p class="az-lead az-quiet">{room.lastRound ? 'That was the last round.' : 'The next round is being laid out.'}</p>
      {@render board(me)}
    </section>
  {:else if myTurn && pick}
    {@render bar()}
    <div class="az-picked">
      <span class="az-pickt" style:--t="32px"><AzulTile c={pick.colour} /></span>
      <span class="az-picktext">
        {pick.count}
        {pick.colour} from {sourceName(pick.source)}{pick.marker ? ', and the first-player marker' : ''}
      </span>
      <button class="az-back" type="button" onclick={() => (sel = null)} disabled={busy}>Put back</button>
    </div>

    <h2 class="az-kicker az-gap">Where they go</h2>
    <div class="az-choices" style:--t="26px">
      {#each choices as ch (ch.line)}
        <button class="az-choice" class:az-off={!ch.ok} type="button" disabled={!ch.ok || busy} onclick={() => place(ch.line)}>
          <span class="az-chead">
            <span class="az-cname">{ch.line === 'floor' ? 'Floor' : `Line ${ch.line + 1}`}</span>
            {#if ch.line !== 'floor'}
              <span class="az-cslots">
                {#each Array.from({ length: ch.cap }, (_, k) => k) as k (k)}
                  {@const fromRight = ch.cap - 1 - k}
                  <span class="az-slot" class:az-ghost={fromRight >= ch.have.length && fromRight < ch.have.length + ch.fit}>
                    {#if ch.have[fromRight]}
                      <AzulTile c={ch.have[fromRight].c} />
                    {:else if fromRight < ch.have.length + ch.fit}
                      <AzulTile c={pick.colour} />
                    {/if}
                  </span>
                {/each}
              </span>
            {/if}
          </span>
          <span class="az-csay">{ch.say}</span>
          {#if ch.cost}<span class="az-ccost">−{ch.cost} {ch.cost === 1 ? 'point' : 'points'}</span>{/if}
        </button>
      {/each}
    </div>
  {:else}
    {@render bar()}
    {#if myTurn}
      <p class="az-lead">Tap a colour at a factory or the centre. You take every tile of it.</p>
      <div class="az-factories" style:--t="34px">
        {#each room.factories as f, fi (fi)}
          <div class="az-factory" class:az-empty={!f.length}>
            <span class="az-fnum">{fi + 1}</span>
            {#if f.length}
              <div class="az-ftiles">
                {#each f as t (t.id)}
                  <button
                    class="az-tbtn"
                    type="button"
                    aria-label="Factory {fi + 1}: {f.filter((x) => x.c === t.c).length} {t.c}"
                    onclick={() => choose(fi, t.c)}
                    disabled={busy}
                  >
                    <AzulTile c={t.c} />
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="az-centrepool" style:--t="34px">
        <span class="az-kicker">Centre{room.firstInCentre ? ' · first to take here starts next round' : ''}</span>
        {#if centreGroups.length}
          <div class="az-groups">
            {#each centreGroups as g (g.c)}
              <button class="az-group" type="button" aria-label="Centre: {g.n} {g.c}" onclick={() => choose('centre', g.c)} disabled={busy}>
                <AzulTile c={g.c} />
                <span class="az-gn">×{g.n}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="az-lead az-quiet">Empty.</p>
        {/if}
      </div>
      <h2 class="az-kicker az-gap">My board</h2>
    {:else if lastLine}
      <p class="az-last">{lastLine}</p>
    {/if}
    <div style:--t="28px">{@render board(me)}</div>
    {#if !myTurn}
      <p class="az-lead az-quiet">The factories are on the TV. Your phone wakes up on your turn.</p>
    {/if}
  {/if}

  {#if toast}
    {#key toast.key}
      <p class="az-toast" class:az-good={toast.good} role="status">{toast.text}</p>
    {/key}
  {/if}
</div>

<style>
  .az {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0 32px;
  }
  .az-centre,
  .az-finish {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .az-centre {
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
  }
  .az-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .az-gap {
    margin-top: 12px;
  }
  .az-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3rem;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--chrome-ink);
  }
  .az-count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .az-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .az-quiet {
    color: var(--on-ink-55);
  }
  .az-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .az-who {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
    line-height: 1.1;
    color: var(--on-ink-80);
  }
  .az-who.az-mineturn {
    color: var(--accent-on-dark);
  }
  .az-clock {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.5rem;
    color: var(--chrome-ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .az-clock.az-late {
    color: var(--error);
  }
  .az-meta {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--on-ink-70);
  }
  .az-last {
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }

  /* Step one: the factories and the centre. */
  .az-factories {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .az-factory {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 104px;
    padding: 10px 6px 6px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .az-factory.az-empty {
    border-style: dashed;
    border-color: var(--on-ink-16);
    background: transparent;
  }
  .az-fnum {
    position: absolute;
    top: 4px;
    left: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--on-ink-55);
  }
  .az-ftiles {
    display: grid;
    grid-template-columns: repeat(2, auto);
    gap: 4px;
  }
  .az-tbtn,
  .az-group {
    display: grid;
    place-items: center;
    padding: 4px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
  }
  .az-tbtn:active,
  .az-group:active {
    background: var(--on-ink-16);
  }
  .az-centrepool {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
    padding: 10px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
  }
  .az-groups {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .az-group {
    grid-auto-flow: column;
    gap: 8px;
    min-height: 52px;
    padding: 6px 12px 6px 8px;
    background: var(--on-ink-05);
  }
  .az-gn {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--chrome-ink);
  }

  /* Step two: the pick and where it goes. */
  .az-picked {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
  }
  .az-pickt {
    flex: none;
  }
  .az-picktext {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--chrome-ink);
  }
  .az-back {
    flex: none;
    min-height: 44px;
    padding: 0 14px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .az-choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .az-choice {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    min-height: 64px;
    padding: 10px 12px;
    border: 2px solid var(--accent-on-dark);
    border-radius: 2px;
    background: var(--on-ink-05);
    color: var(--chrome-ink);
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }
  .az-choice:active:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
  }
  .az-choice.az-off {
    border-color: var(--on-ink-16);
    background: transparent;
    cursor: default;
  }
  .az-choice.az-off .az-cname,
  .az-choice.az-off .az-csay {
    color: var(--on-ink-55);
  }
  .az-choice:disabled:not(.az-off) {
    opacity: 0.6;
  }
  .az-chead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .az-cname {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .az-cslots {
    display: flex;
    gap: 3px;
  }
  .az-csay {
    font-family: var(--font-body);
    font-size: var(--fs-body);
  }
  .az-ccost {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
  }
  .az-ghost {
    opacity: 0.55;
  }

  /* My board: lines filling towards the wall, the wall, the floor. */
  .az-board {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    border: 2px solid var(--on-ink-16);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .az-mid {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .az-lines {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .az-line {
    display: flex;
    justify-content: flex-end;
    gap: 3px;
  }
  .az-wall {
    display: grid;
    grid-template-columns: repeat(5, var(--t, 28px));
    gap: 3px;
  }
  .az-slot,
  .az-cell {
    display: block;
    width: var(--t, 28px);
    height: var(--t, 28px);
    border-radius: 2px;
  }
  .az-slot {
    outline: 1px solid var(--on-ink-16);
    outline-offset: -1px;
  }
  .az-floor {
    display: flex;
    gap: 3px;
  }
  .az-fslot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .az-pen {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--on-ink-55);
  }

  .az-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .az-list li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--on-ink-05);
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .az-list li.az-me {
    background: var(--on-ink-12);
  }
  .az-toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    max-width: calc(100vw - 32px);
    margin: 0;
    padding: 12px 18px;
    border-radius: 2px;
    background: var(--chrome-ink);
    color: var(--chrome-bg);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    text-align: center;
    animation: az-pop 180ms ease-out both;
  }
  .az-toast.az-good {
    background: var(--accent-ink);
    color: var(--chrome-ink);
  }
  @keyframes az-pop {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
