<script lang="ts">
  // Iron Roads on a phone at the TV: my hand and my tickets (nobody else's),
  // whose turn it is, and on mine the three things a turn can be — draw cards,
  // claim a route I can pay for right now, or take more tickets. Drives the
  // wire from `toWire` in $lib/games/iron-roads and posts its moves through the
  // party's act route: `{ action: 'keep', tickets }`, `{ action: 'draw', source }`,
  // `{ action: 'claim', route, colour }`, `{ action: 'tickets' }`.
  import { onMount } from 'svelte';
  import type { Card, WireRoom } from '$lib/games/iron-roads';
  import { CARD_COLOURS, ROUTE_POINTS, route as routeOf, routeName, townName } from '$lib/games/iron-roads-map';
  import IronCard from '../../iron/IronCard.svelte';
  import IronMap from '../../iron/IronMap.svelte';
  import { playerPaint, routePaint } from '../../iron/colours';
  import { playAct } from '../play-stream';

  let { code, room, skewMs = 0 }: { code: string; room: WireRoom; skewMs?: number } = $props();

  type Tab = 'draw' | 'claim' | 'tickets';

  let now = $state(Date.now());
  let tab = $state<Tab>('draw');
  let picked = $state<string | null>(null);
  /** Ticket ids ticked in the keep chooser; null = not touched yet (all ticked). */
  let ticked = $state<number[] | null>(null);
  let busy = $state(false);
  let toast = $state<{ text: string; good: boolean; key: number } | null>(null);

  // Plain handles, never reactive (svelte5-pitfalls §1).
  let ticker: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let toastSeq = 0;

  onMount(() => {
    ticker = setInterval(() => (now = Date.now()), 250);
    return () => {
      if (ticker) clearInterval(ticker);
      if (toastTimer) clearTimeout(toastTimer);
      ticker = null;
      toastTimer = null;
    };
  });

  const ALL: Card[] = [...CARD_COLOURS, 'engine'];
  const me = $derived(room.me);
  const meRow = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const seats = $derived(Object.fromEntries(room.players.map((p) => [p.id, p.seat])));
  const mover = $derived(room.players.find((p) => p.id === room.turnId) ?? null);
  const myTurn = $derived(!!me?.myTurn);
  const pending = $derived(me?.pending ?? null);
  const pendingKey = $derived(pending ? pending.tickets.map((t) => t.id).join(',') : '');
  const keepIds = $derived(ticked ?? pending?.tickets.map((t) => t.id) ?? []);
  const secondsLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, Math.ceil((room.phaseEndsAt - (now + skewMs)) / 1000)));
  const handTotal = $derived(me ? ALL.reduce((a, c) => a + me.hand[c], 0) : 0);
  const openTowns = $derived(new Set((me?.tickets ?? []).filter((t) => !t.done).flatMap((t) => [t.from, t.to])));

  const claimable = $derived(
    (me?.claimable ?? [])
      .map((c) => {
        const r = routeOf(c.route)!;
        return { ...c, r, points: ROUTE_POINTS[r.length] ?? 0, helps: openTowns.has(r.a) || openTowns.has(r.b) };
      })
      .sort((a, b) => Number(b.helps) - Number(a.helps) || b.points - a.points || routeName(a.r).localeCompare(routeName(b.r))),
  );
  const pickedRoute = $derived(claimable.find((c) => c.route === picked) ?? null);

  // A new ticket offer starts with all of them ticked; a new turn starts on Draw.
  let lastOffer = '';
  let lastTurn = '';
  $effect(() => {
    const offer = pendingKey;
    const turnKey = `${room.turns}:${room.turnId}:${myTurn}`;
    if (offer !== lastOffer) {
      lastOffer = offer;
      ticked = null;
    }
    if (turnKey !== lastTurn) {
      lastTurn = turnKey;
      tab = 'draw';
      picked = null;
    }
  });

  const ordinal = (n: number) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };
  const myStanding = $derived(room.standings?.find((s) => s.id === room.meId) ?? null);

  function say(text: string, good: boolean) {
    toast = { text, good, key: ++toastSeq };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), good ? 1400 : 2600);
  }

  async function act(body: Record<string, unknown>, done?: string) {
    if (busy) return;
    busy = true;
    try {
      await playAct<WireRoom>(code, body);
      if (done) say(done, true);
      navigator.vibrate?.(15);
    } catch (err) {
      say(err instanceof Error ? err.message : 'That did not go through.', false);
    } finally {
      busy = false;
    }
  }

  function toggle(id: number) {
    const cur = keepIds;
    ticked = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  }

  /** "2 red + 1 engine" for paying a route of `length` in `colour`. */
  function costLine(colour: Card, length: number): string {
    if (!me) return '';
    if (colour === 'engine') return `${length} ${length === 1 ? 'engine' : 'engines'}`;
    const c = Math.min(me.hand[colour], length);
    const e = length - c;
    return `${c} ${colour}${e ? ` + ${e} ${e === 1 ? 'engine' : 'engines'}` : ''}`;
  }

  function claim(route: string, colour: Card) {
    const r = routeOf(route);
    void act({ action: 'claim', route, colour }, r ? `${routeName(r)} is yours` : 'Claimed');
    picked = null;
  }
</script>

<div class="iron-pad">
  {#if room.phase === 'lobby'}
    <section class="iron-centre">
      <p class="iron-kicker">Iron Roads</p>
      <p class="iron-lead">Waiting for the TV to start…</p>
    </section>
  {:else if room.phase === 'countdown'}
    <section class="iron-centre">
      <p class="iron-kicker">Get ready</p>
      <p class="iron-count">{Math.max(1, secondsLeft ?? 1)}</p>
      <p class="iron-lead">Claim railways between the towns and join up your tickets.</p>
    </section>
  {:else if room.phase === 'finished' || room.phase === 'closed'}
    <section class="iron-finish">
      <p class="iron-kicker">The last train's in</p>
      <h1 class="iron-title">
        {#if room.winnerIds.includes(room.meId)}You win{:else if myStanding}{ordinal(myStanding.place)}{:else}Finished{/if}
      </h1>
      {#if myStanding}
        <p class="iron-lead">
          {myStanding.score} points — {myStanding.routePoints} from routes, {myStanding.ticketPoints >= 0 ? '+' : ''}{myStanding.ticketPoints} from tickets{myStanding.longestBonus
            ? `, +${myStanding.longestBonus} for the longest line`
            : ''}.
        </p>
      {/if}
      {#if room.standings?.length}
        <h2 class="iron-kicker iron-gap">Standings</h2>
        <ol class="iron-list">
          {#each room.standings as s (s.id)}
            <li class:iron-mine={s.id === room.meId}>
              <span class="iron-dot" style:background={playerPaint(s.seat)}></span>
              <span class="iron-grow">{s.place}. {s.name}</span>
              <span>{s.score}</span>
            </li>
          {/each}
        </ol>
      {/if}
      {#if myStanding?.tickets.length}
        <h2 class="iron-kicker iron-gap">My tickets</h2>
        <ul class="iron-list">
          {#each myStanding.tickets as t (t.id)}
            <li class:iron-failed={!t.done}>
              <span class="iron-grow">{townName(t.from)} – {townName(t.to)}</span>
              <span>{t.done ? '+' : '−'}{t.points}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="iron-lead iron-quiet">The TV takes everyone back to the lobby.</p>
    </section>
  {:else if me}
    <header class="iron-bar" class:iron-bar-mine={myTurn}>
      <span class="iron-turn">
        {#if room.phase === 'choosing'}Pick your tickets{:else if myTurn}Your turn{:else if mover}{mover.name}'s turn{:else}Waiting{/if}
      </span>
      {#if secondsLeft !== null}<span class="iron-clock" class:iron-late={secondsLeft <= 10}>{secondsLeft}s</span>{/if}
    </header>
    <p class="iron-stats">
      <span class="iron-dot" style:background={playerPaint(meRow?.seat)}></span>
      {me.trains} trains · {meRow?.score ?? 0} points · {handTotal} cards
    </p>
    {#if room.finalRound}
      <p class="iron-warn">Last round — one turn each.</p>
    {/if}

    {#if pending}
      <section class="iron-keep">
        <h2 class="iron-kicker">Keep at least {pending.min === 1 ? 'one' : pending.min}</h2>
        {#each pending.tickets as t (t.id)}
          {@const on = keepIds.includes(t.id)}
          <button type="button" class="iron-ticket iron-pick" class:iron-on={on} aria-pressed={on} onclick={() => toggle(t.id)}>
            <span class="iron-tick">{on ? 'Keep' : 'Pass'}</span>
            <span class="iron-tname">{t.name}</span>
            <span class="iron-tpts">{t.points}</span>
            <span class="iron-tline">{t.line}</span>
          </button>
        {/each}
        <button
          type="button"
          class="iron-go"
          disabled={busy || keepIds.length < pending.min}
          onclick={() => act({ action: 'keep', tickets: keepIds }, `Kept ${keepIds.length}`)}
        >
          Keep {keepIds.length}
        </button>
      </section>
    {:else if myTurn}
      {#if room.drawn === 0}
        <div class="iron-tabs" role="tablist">
          <button type="button" role="tab" class:iron-on={tab === 'draw'} aria-selected={tab === 'draw'} onclick={() => (tab = 'draw')}>Draw</button>
          <button type="button" role="tab" class:iron-on={tab === 'claim'} aria-selected={tab === 'claim'} onclick={() => (tab = 'claim')}>
            Claim{claimable.length ? ` · ${claimable.length}` : ''}
          </button>
          <button type="button" role="tab" class:iron-on={tab === 'tickets'} aria-selected={tab === 'tickets'} onclick={() => (tab = 'tickets')}>Tickets</button>
        </div>
      {:else}
        <p class="iron-warn">Take your second card — not a face-up engine.</p>
      {/if}

      {#if tab === 'draw' || room.drawn > 0}
        <section class="iron-draw">
          <div class="iron-market">
            {#each room.market as c, i (i)}
              <button type="button" class="iron-mcard" disabled={busy || !c || !me.canMarket[i]} onclick={() => act({ action: 'draw', source: i })}>
                {#if c}<IronCard card={c} />{/if}
              </button>
            {/each}
          </div>
          <button type="button" class="iron-go" disabled={busy || !me.canDeck} onclick={() => act({ action: 'draw', source: 'deck' })}>
            Draw from the deck · {room.deck + room.discard}
          </button>
          <p class="iron-hint">Two cards a turn. A face-up engine is wild but takes your whole turn.</p>
        </section>
      {:else if tab === 'claim'}
        <section class="iron-claim">
          <div class="iron-thumb">
            <IronMap owners={room.owners} {seats} highlight={picked} compact />
          </div>
          {#if !claimable.length}
            <p class="iron-lead iron-quiet">Nothing you can pay for yet. Draw some cards.</p>
          {:else}
            <ul class="iron-routes">
              {#each claimable as c (c.route)}
                <li>
                  <button type="button" class="iron-route" class:iron-on={picked === c.route} onclick={() => (picked = picked === c.route ? null : c.route)}>
                    <span class="iron-pips">
                      {#each Array(c.r.length) as _, k (k)}<span class="iron-pip" style:background={routePaint(c.r.colour)}></span>{/each}
                    </span>
                    <span class="iron-grow">{routeName(c.r)}{#if c.helps}<span class="iron-helps"> · ticket</span>{/if}</span>
                    <span class="iron-tpts">+{c.points}</span>
                  </button>
                  {#if picked === c.route && pickedRoute}
                    <div class="iron-pay">
                      {#each c.colours as col (col)}
                        <button type="button" class="iron-go iron-paybtn" disabled={busy} onclick={() => claim(c.route, col)}>
                          {c.colours.length > 1 ? `Pay ${costLine(col, c.r.length)}` : `Claim · ${costLine(col, c.r.length)}`}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {:else}
        <section class="iron-more">
          <p class="iron-lead">Draw three tickets and keep at least one. A finished ticket scores its points, an unfinished one takes them off.</p>
          <button type="button" class="iron-go" disabled={busy || !me.canTickets} onclick={() => act({ action: 'tickets' })}>
            {me.canTickets ? 'Draw 3 tickets' : 'No tickets left'}
          </button>
        </section>
      {/if}
    {:else}
      <p class="iron-lead iron-quiet">{room.last ?? 'Waiting for your turn.'}</p>
    {/if}

    <h2 class="iron-kicker iron-gap">My hand</h2>
    <div class="iron-hand">
      {#each ALL as c (c)}
        <span class="iron-slot" class:iron-none={!me.hand[c]}><IronCard card={c} count={me.hand[c]} /></span>
      {/each}
    </div>

    <h2 class="iron-kicker iron-gap">My tickets</h2>
    {#if me.tickets.length}
      <ul class="iron-list">
        {#each me.tickets as t (t.id)}
          <li class:iron-done={t.done}>
            <span class="iron-mark">{t.done ? 'Done' : 'Open'}</span>
            <span class="iron-grow">{t.name}<span class="iron-tline">{t.line}</span></span>
            <span>{t.points}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="iron-lead iron-quiet">None yet.</p>
    {/if}
  {:else}
    <section class="iron-centre">
      <p class="iron-lead">You're watching this one.</p>
    </section>
  {/if}

  {#if toast}
    {#key toast.key}
      <p class="iron-toast" class:iron-good={toast.good} role="status">{toast.text}</p>
    {/key}
  {/if}
</div>

<style>
  .iron-pad {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0 40px;
  }
  .iron-centre,
  .iron-finish {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .iron-centre {
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
  }
  .iron-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .iron-gap {
    margin-top: 14px;
  }
  .iron-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3rem;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--chrome-ink);
  }
  .iron-count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .iron-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .iron-quiet {
    color: var(--on-ink-55);
  }
  .iron-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 10px 12px;
    border-radius: 2px;
    background: var(--on-ink-05);
    border: 1px solid var(--on-ink-14);
  }
  .iron-bar-mine {
    background: var(--accent);
    border-color: var(--accent);
  }
  .iron-turn {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.6rem;
    color: var(--chrome-ink);
  }
  .iron-clock {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.4rem;
    color: var(--chrome-ink);
    font-variant-numeric: tabular-nums;
  }
  .iron-clock.iron-late {
    color: var(--accent-on-dark);
  }
  .iron-bar-mine .iron-clock.iron-late {
    color: var(--chrome-bg);
  }
  .iron-stats {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--on-ink-70);
  }
  .iron-dot {
    display: inline-block;
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 100px;
  }
  .iron-warn,
  .iron-hint {
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .iron-hint {
    border-left-color: var(--on-ink-30);
    color: var(--on-ink-70);
  }
  .iron-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .iron-tabs button,
  .iron-go {
    min-height: 56px;
    padding: 10px 12px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .iron-tabs button.iron-on {
    border-color: var(--accent-on-dark);
    background: var(--on-ink-12);
  }
  .iron-go {
    width: 100%;
    border-color: var(--accent);
    background: var(--accent);
  }
  .iron-go:disabled,
  .iron-tabs button:disabled {
    opacity: 0.45;
  }
  .iron-draw,
  .iron-claim,
  .iron-more,
  .iron-keep {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .iron-market {
    --iron-card-w: 100%;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .iron-mcard {
    padding: 0;
    border: 0;
    background: transparent;
    aspect-ratio: 2 / 3;
    --iron-card-w: 100%;
  }
  .iron-mcard:disabled {
    opacity: 0.35;
  }
  .iron-mcard :global(.iron-card-label) {
    font-size: 12px;
  }
  .iron-thumb {
    padding: 6px;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    background: var(--on-ink-05);
    aspect-ratio: 1060 / 610;
  }
  .iron-routes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .iron-route {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 52px;
    padding: 10px 12px;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    background: var(--on-ink-05);
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    text-align: left;
  }
  .iron-route.iron-on {
    border-color: var(--accent-on-dark);
    background: var(--on-ink-12);
  }
  .iron-pips {
    display: flex;
    gap: 2px;
    flex: none;
    width: 66px;
  }
  .iron-pip {
    width: 11px;
    height: 16px;
    border-radius: 2px;
    border: 1px solid var(--on-ink-30);
  }
  .iron-helps {
    color: var(--accent-on-dark);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .iron-pay {
    display: grid;
    gap: 6px;
    padding: 6px 0 4px;
  }
  .iron-paybtn {
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .iron-grow {
    flex: 1;
    min-width: 0;
  }
  .iron-tpts {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
  }
  .iron-hand {
    --iron-card-w: 100%;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
  }
  .iron-slot {
    display: block;
  }
  .iron-slot :global(.iron-card-label) {
    font-size: 12px;
    letter-spacing: 0;
  }
  .iron-slot :global(.iron-card-count) {
    font-size: 1.25rem;
  }
  .iron-none {
    opacity: 0.28;
  }
  .iron-ticket {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas: 'tick name pts' 'line line line';
    align-items: baseline;
    column-gap: 10px;
    row-gap: 4px;
    width: 100%;
    padding: 12px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    text-align: left;
  }
  .iron-ticket.iron-on {
    border-color: var(--accent-on-dark);
    background: var(--on-ink-08);
  }
  .iron-tick {
    grid-area: tick;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .iron-on .iron-tick {
    color: var(--accent-on-dark);
  }
  .iron-tname {
    grid-area: name;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.05rem;
  }
  .iron-ticket .iron-tpts {
    grid-area: pts;
  }
  .iron-tline {
    grid-area: line;
    display: block;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--on-ink-70);
  }
  .iron-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .iron-list li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 10px 12px;
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .iron-list li.iron-mine {
    background: var(--on-ink-12);
  }
  .iron-list li.iron-failed .iron-grow {
    text-decoration: line-through;
    color: var(--on-ink-55);
  }
  .iron-mark {
    flex: none;
    width: 40px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--on-ink-55);
  }
  .iron-done .iron-mark {
    color: var(--good-on-dark);
  }
  .iron-toast {
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
    animation: iron-pop 180ms ease-out both;
  }
  .iron-toast.iron-good {
    background: var(--accent-ink);
    color: var(--chrome-ink);
  }
  @keyframes iron-pop {
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
