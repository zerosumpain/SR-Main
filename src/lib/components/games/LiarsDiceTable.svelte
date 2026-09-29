<script lang="ts">
  // The Liar's Dice table on the web: the same wire room the app renders
  // (`toWire` in $lib/games/liars-dice), drawn in the site's register.
  //
  // Nothing here decides a rule. Legal bids come from the rules module's own
  // `bidProblem` (via $lib/games/liars-dice-view), the reveal's count comes
  // from the server, and every move is a POST the server can refuse — the
  // sentence it refuses with is what the page shows.
  import { untrack } from 'svelte';
  import Die from './Die.svelte';
  import type { WireRoom } from '$lib/games/liars-dice';
  import { bidWords, counts, defaultBid, facesAt, legalQuantities, nameOf } from '$lib/games/liars-dice-view';

  type Player = WireRoom['players'][number] & { sawInvite?: boolean };
  type Room = Omit<WireRoom, 'players'> & { players: Player[] };

  interface Props {
    room: Room;
    /** Server-clock now, ticking — `Date.now()` corrected by the room's `serverNow`. */
    now: number;
    busy: boolean;
    /** Players the host could still invite from the lobby. */
    invitable: { id: string; name: string }[];
    onact: (action: string, body?: Record<string, unknown>) => void;
  }

  let { room, now, busy, invitable, onact }: Props = $props();

  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const isHost = $derived(room.hostId === room.meId);
  const myTurn = $derived(room.phase === 'bidding' && room.turnId === room.meId);
  const seats = $derived(room.players.filter((p) => p.seated));
  const lobbyPeople = $derived(room.players.filter((p) => p.status === 'joined' || p.status === 'invited'));
  const joinedCount = $derived(room.players.filter((p) => p.status === 'joined').length);
  const left = $derived(room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - now) : 0);
  const turnShare = $derived(room.phase === 'bidding' && room.turnMs ? Math.min(1, left / room.turnMs) : 0);
  const standing = $derived(room.bid ? { quantity: room.bid.quantity, face: room.bid.face } : null);

  // The picker. Reset to the smallest legal raise whenever the standing bid or
  // the turn moves — keyed on those alone, the writes untracked.
  let pickQ = $state(1);
  let pickF = $state(2);
  const bidKey = $derived(`${room.round}:${room.bids.length}:${room.turnId}:${room.totalDice}`);
  $effect(() => {
    void bidKey;
    untrack(() => {
      const d = defaultBid(standing, room.totalDice, room.wildOnes);
      pickQ = d?.quantity ?? 1;
      pickF = d?.face ?? room.minFace;
    });
  });
  const quantities = $derived(legalQuantities(standing, room.totalDice, room.wildOnes));
  const faces = $derived(facesAt(pickQ, standing, room.totalDice, room.wildOnes));
  const pickLegal = $derived(faces.some((f) => f.face === pickF && f.legal));

  function chooseQuantity(q: number) {
    pickQ = q;
    const here = facesAt(q, standing, room.totalDice, room.wildOnes);
    if (!here.find((f) => f.face === pickF)?.legal) pickF = here.find((f) => f.legal)?.face ?? pickF;
  }

  let inviting = $state<string[]>([]);
  const toInvite = $derived(invitable.filter((p) => !room.players.some((q) => q.id === p.id && (q.status === 'joined' || q.status === 'invited'))));

  const statusWord: Record<string, string> = {
    joined: 'In',
    invited: 'Invited',
    declined: 'Declined',
    left: 'Left',
  };
  const secs = (ms: number) => Math.ceil(ms / 1000);

  const reveal = $derived(room.reveal);
  const revealLine = $derived.by(() => {
    if (!reveal) return '';
    const who = nameOf(room, reveal.challengerId);
    const bidder = nameOf(room, reveal.bid.playerId);
    const loser = nameOf(room, reveal.loserId);
    const was = reveal.count === 1 ? 'was' : 'were';
    return `${who}${reveal.auto ? ' (timed out)' : ''} called ${bidder}'s ${bidWords(reveal.bid)} a lie. There ${was} ${reveal.count}. ${loser} ${reveal.eliminated ? 'lost their last die and is out' : 'loses a die'}.`;
  });
</script>

<div class="table">
  <!-- The table's state line. The rule itself is the cover's standfirst. -->
  <div class="status">
    <span class="tag">{room.dicePerPlayer} dice each · {room.difficulty}</span>
    {#if room.round > 0}<span class="tag">Round {room.round} · {room.totalDice} dice in play</span>{/if}
  </div>

  {#if room.phase === 'lobby'}
    <section class="panel">
      <h2 class="panel-title">The lobby</h2>
      <ul class="lobby-list">
        {#each lobbyPeople as p (p.id)}
          <li>
            <span class="who">{p.name}{p.id === room.meId ? ' (you)' : ''}{p.isHost ? ' · host' : ''}</span>
            <span class="state" class:in={p.status === 'joined'}>
              {statusWord[p.status] ?? p.status}{p.status === 'invited' && p.sawInvite ? ' · seen' : ''}
            </span>
          </li>
        {/each}
      </ul>
      {#if me?.status === 'invited'}
        <div class="acts">
          <button class="btn primary" disabled={busy} onclick={() => onact('join')}>Join</button>
          <button class="btn" disabled={busy} onclick={() => onact('decline')}>Decline</button>
        </div>
      {:else if isHost}
        {#if toInvite.length}
          <div class="invite-more">
            <span class="label">Invite more</span>
            <div class="people">
              {#each toInvite as p (p.id)}
                <label class="person" class:on={inviting.includes(p.id)}>
                  <input
                    type="checkbox"
                    checked={inviting.includes(p.id)}
                    onchange={() => (inviting = inviting.includes(p.id) ? inviting.filter((x) => x !== p.id) : [...inviting, p.id])}
                  />
                  {p.name}
                </label>
              {/each}
            </div>
            <button
              class="btn"
              disabled={busy || inviting.length === 0}
              onclick={() => {
                onact('invite', { invite: inviting });
                inviting = [];
              }}>Send invites</button
            >
          </div>
        {/if}
        <div class="acts">
          <button class="btn primary big" disabled={busy || joinedCount < 2} onclick={() => onact('start')}>Start the game</button>
          <button class="btn" disabled={busy} onclick={() => onact('leave')}>Cancel</button>
          {#if joinedCount < 2}<span class="hint">Liar's Dice needs at least two players in.</span>{/if}
        </div>
      {:else}
        <div class="acts">
          <span class="hint">Waiting for {nameOf(room, room.hostId)} to start.</span>
          <button class="btn" disabled={busy} onclick={() => onact('leave')}>Leave</button>
        </div>
      {/if}
      {#if room.phaseEndsAt}<p class="fine">The lobby closes in {Math.ceil(left / 60000)} min if nobody starts.</p>{/if}
    </section>
  {:else if room.phase === 'countdown'}
    <section class="panel centre">
      <p class="label">Cups down</p>
      <p class="count">{secs(left)}</p>
    </section>
  {:else if room.phase === 'closed'}
    <section class="panel centre">
      <p class="big-line">That game has finished.</p>
    </section>
  {:else}
    <!-- The seats: everyone at the table, in seat order. -->
    <ul class="seats">
      {#each seats as p (p.id)}
        {@const turn = room.turnId === p.id}
        <li class="seat" class:turn class:out={p.out} class:mine={p.id === room.meId}>
          <div class="seat-head">
            <span class="who">{p.name}{p.id === room.meId ? ' (you)' : ''}</span>
            <span class="n">{p.out ? 'Out' : `${p.diceCount} ${p.diceCount === 1 ? 'die' : 'dice'}`}</span>
          </div>
          <div class="cup">
            {#if p.dice && p.dice.length && room.phase !== 'reveal'}
              {#each p.dice as d, i (i)}<Die value={d} size={p.id === room.meId ? 34 : 22} />{/each}
            {:else if !p.out}
              {#each Array(p.diceCount) as _, i (i)}<Die value={null} size={22} />{/each}
            {/if}
          </div>
          {#if turn}
            <div class="clock" aria-label="{secs(left)} seconds left">
              <div class="clock-fill" class:late={turnShare < 0.25} style="width: {turnShare * 100}%"></div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if room.phase === 'bidding'}
      <div class="play">
        <section class="panel">
          <p class="label">Standing bid</p>
          {#if room.bid}
            <p class="bid-now">
              <span class="bid-q">{room.bid.quantity}</span>
              <span class="bid-x">×</span>
              <Die value={room.bid.face} size={44} />
            </p>
            <p class="fine">{nameOf(room, room.bid.playerId)} bid {bidWords(room.bid)}{room.bid.auto ? ' (timed out)' : ''}.</p>
          {:else}
            <p class="big-line">No bid yet.</p>
            <p class="fine">{nameOf(room, room.turnId)} opens round {room.round}.</p>
          {/if}

          {#if myTurn}
            <div class="picker">
              <p class="label">Your turn · {secs(left)} s</p>
              <div class="qty">
                <span class="label">How many</span>
                <div class="qty-row">
                  {#each quantities as q (q)}
                    <button class="chip" class:on={pickQ === q} onclick={() => chooseQuantity(q)} aria-pressed={pickQ === q}>{q}</button>
                  {/each}
                </div>
              </div>
              <div class="faces">
                <span class="label">Of</span>
                <div class="face-row">
                  {#each faces as f (f.face)}
                    <button
                      class="face-btn"
                      class:on={pickF === f.face}
                      disabled={!f.legal}
                      onclick={() => (pickF = f.face)}
                      aria-pressed={pickF === f.face}
                      aria-label="{f.face}s"
                    >
                      <Die value={f.face} size={34} />
                    </button>
                  {/each}
                </div>
              </div>
              <div class="acts">
                <button
                  class="btn primary big"
                  disabled={busy || !pickLegal}
                  onclick={() => onact('bid', { quantity: pickQ, face: pickF })}>Bid {bidWords({ quantity: pickQ, face: pickF })}</button
                >
                <button class="btn liar big" disabled={busy || !room.bid} onclick={() => onact('liar')}>Liar!</button>
              </div>
            </div>
          {:else if me?.out}
            <p class="hint">You are out — watch the rest play.</p>
          {:else}
            <p class="hint">Waiting for {nameOf(room, room.turnId)} · {secs(left)} s</p>
          {/if}
        </section>

        <section class="panel">
          <p class="label">This round</p>
          {#if room.bids.length === 0}
            <p class="fine">No bids yet.</p>
          {:else}
            <ol class="history">
              {#each [...room.bids].reverse() as b, i (room.bids.length - i)}
                <li class:top={i === 0}>
                  <span class="who">{nameOf(room, b.playerId)}</span>
                  <span class="what">{bidWords(b)}{b.auto ? ' · timed out' : ''}</span>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      </div>
    {:else if room.phase === 'reveal' && reveal}
      <section class="panel">
        <p class="label">Cups up</p>
        <p class="big-line">{revealLine}</p>
        <ul class="reveal">
          {#each reveal.dice as cup (cup.playerId)}
            <li class:loser={cup.playerId === reveal.loserId}>
              <span class="who">{nameOf(room, cup.playerId)}</span>
              <span class="cup">
                {#each cup.dice as d, i (i)}
                  <Die
                    value={d}
                    size={30}
                    hit={d === reveal.bid.face}
                    wild={room.wildOnes && d === 1 && reveal.bid.face !== 1}
                    dim={!counts(d, reveal.bid.face, room.wildOnes)}
                  />
                {/each}
              </span>
            </li>
          {/each}
        </ul>
        <p class="fine">
          {reveal.count} counted towards {bidWords(reveal.bid)}{room.wildOnes ? ' (ones are wild, outlined)' : ''}. Next roll in {secs(left)} s.
        </p>
      </section>
    {:else if room.phase === 'finished'}
      <section class="panel">
        <p class="label">Final standings</p>
        {#if room.winnerIds.length}
          <p class="big-line">{nameOf(room, room.winnerIds[0])} {room.winnerIds[0] === room.meId ? '(you) ' : ''}wins.</p>
        {/if}
        {#if room.reveal}<p class="fine">Last call: {revealLine}</p>{/if}
        <ol class="standings">
          {#each room.standings ?? [] as s (s.id)}
            <li class:first={s.place === 1}>
              <span class="place">{s.place}</span>
              <span class="who">{s.name}{s.id === room.meId ? ' (you)' : ''}</span>
              <span class="what">
                {s.place === 1 ? `${s.dice} ${s.dice === 1 ? 'die' : 'dice'} left` : s.left ? `Left in round ${s.outRound}` : `Out in round ${s.outRound}`}
              </span>
            </li>
          {/each}
        </ol>
        <div class="acts">
          {#if isHost}
            <button class="btn primary big" disabled={busy} onclick={() => onact('again')}>Play again</button>
          {:else}
            <span class="hint">{nameOf(room, room.hostId)} can start another.</span>
          {/if}
          <a class="btn" href="/games">Back to the lobby</a>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .table {
    display: grid;
    gap: 18px;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: baseline;
  }
  .tag,
  .label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tag {
    color: var(--accent);
  }
  .label {
    display: block;
    margin: 0 0 8px;
  }
  .fine,
  .hint {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .fine {
    margin: 10px 0 0;
  }
  .hint {
    color: var(--text-muted);
  }
  .panel {
    min-width: 0;
    padding: 18px;
    border: 1px solid var(--card-border);
    background: var(--surface-card);
  }
  .panel.centre {
    text-align: center;
  }
  .panel-title {
    margin: 0 0 12px;
    font-family: var(--font-display);
    font-size: 1.4rem;
    text-transform: uppercase;
  }
  .big-line {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.1rem, 2.2vw, 1.5rem);
    line-height: 1.2;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .count {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(4rem, 12vw, 7rem);
    line-height: 1;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .lobby-list,
  .history,
  .standings,
  .reveal,
  .seats {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lobby-list li,
  .history li,
  .standings li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line-strong);
  }
  .who {
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .state,
  .what {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    text-align: right;
  }
  .state.in {
    color: var(--success);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .invite-more {
    margin-top: 16px;
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .person.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .person input {
    accent-color: var(--accent);
    margin: 0;
  }

  /* Seats */
  .seats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
    gap: 10px;
  }
  .seat {
    position: relative;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--card-border);
    background: var(--surface-card);
  }
  .seat.turn {
    border-color: var(--accent);
  }
  .seat.turn::before {
    content: '';
    position: absolute;
    left: -1px;
    top: -1px;
    bottom: -1px;
    width: 3px;
    background: var(--accent);
  }
  .seat.out {
    opacity: 0.5;
  }
  .seat-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .cup {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 22px;
  }
  .clock {
    height: 4px;
    margin-top: 12px;
    background: var(--line-strong);
    overflow: hidden;
  }
  .clock-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.25s linear;
  }
  .clock-fill.late {
    background: var(--error);
  }

  /* Play */
  .play {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.6fr);
    gap: 18px;
    align-items: start;
  }
  .bid-now {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
  }
  .bid-q {
    font-family: var(--font-display);
    font-size: 3rem;
    line-height: 1;
  }
  .bid-x {
    font-family: var(--font-mono);
    font-size: 1.4rem;
    color: var(--text-muted);
  }
  .picker {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--line-strong);
    display: grid;
    gap: 14px;
  }
  .picker > .label {
    color: var(--accent);
    margin: 0;
  }
  .qty-row,
  .face-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    min-width: 40px;
    min-height: 40px;
    padding: 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    cursor: pointer;
  }
  .chip.on {
    background: var(--text-primary);
    color: var(--bg);
    border-color: var(--text-primary);
  }
  .face-btn {
    padding: 3px;
    background: transparent;
    border: 2px solid transparent;
    border-radius: 0;
    cursor: pointer;
  }
  .face-btn.on {
    border-color: var(--accent);
  }
  .face-btn:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }
  .history li.top .what {
    color: var(--accent);
  }

  /* Reveal */
  .reveal {
    margin-top: 14px;
  }
  .reveal li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 14px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line-strong);
  }
  .reveal li.loser .who {
    color: var(--error);
  }

  /* Standings */
  .standings {
    margin-top: 14px;
  }
  .standings li {
    justify-content: flex-start;
    align-items: baseline;
  }
  .place {
    font-family: var(--font-display);
    font-size: 1.3rem;
    width: 1.6em;
    flex: none;
  }
  .standings li.first .place {
    color: var(--accent);
  }
  .standings .what {
    margin-left: auto;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 8px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    text-decoration: none;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--text-primary);
    border-radius: 0;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--text-primary);
    color: var(--bg);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .btn.liar {
    border-color: var(--error);
    color: var(--error);
  }
  .btn.liar:hover:not(:disabled) {
    background: var(--error);
    color: var(--bg);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn.big {
    min-height: 48px;
    padding: 10px 20px;
  }

  @media (max-width: 760px) {
    .play {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
