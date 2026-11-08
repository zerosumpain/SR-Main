<script lang="ts">
  // Codenames on a phone at the TV. The TV board shows the grid for the room
  // to argue over; the phone shows what is mine to see or do: in the lobby my
  // team and whether I'd give the clues, in play the key and the clue form
  // when I'm the spymaster on my turn, the words to touch when my team is
  // guessing, and otherwise who we are waiting on. Drives the same wire the
  // app reads (`toWire` in $lib/games/codenames) and posts the same moves
  // (`team`, `clue`, `guess`, `pass`) through the party's act route.
  //
  // Guessing is two taps: the first lifts a card, the second turns it over,
  // so a card is never turned by a stray thumb.
  import { onMount } from 'svelte';
  import type { WireRoom } from '$lib/games/codenames';
  import { playAct } from '../play-stream';

  type Team = 'red' | 'blue';
  type Kind = Team | 'neutral' | 'assassin';

  let { code, room, skewMs }: { code: string; room: WireRoom; skewMs: number } = $props();

  // codenames.ts's limits, re-stated so its word list stays out of the browser.
  const MAX_CLUE = 24;
  const MAX_COUNT = 9;
  const SIDES: (Team | null)[] = ['red', 'blue', null];

  let now = $state(Date.now());
  let busy = $state(false);
  let lifted = $state<{ card: number; turn: number } | null>(null);
  let clueWord = $state('');
  let clueCount = $state(1);
  let clueError = $state<{ text: string; turn: number } | null>(null);
  let toast = $state<{ text: string; key: number } | null>(null);

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

  const teamName = (t: Team | null | undefined) => (t === 'blue' ? 'Blue' : t === 'red' ? 'Red' : 'Anywhere');
  const otherTeam = (t: Team): Team => (t === 'red' ? 'blue' : 'red');
  const kindName = (k: Kind | null) =>
    k === 'assassin' ? 'the assassin' : k === 'neutral' ? 'a bystander' : k ? `a ${k} agent` : '';

  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const myTeam = $derived((me?.team ?? null) as Team | null);
  const iGiveClues = $derived(!!me?.spymaster);
  const coop = $derived(room.mode === 'coop');
  const finalTeams = $derived<Team[]>(coop ? ['red'] : ['red', 'blue']);
  const joinedPlayers = $derived(room.players.filter((p) => p.status === 'joined'));
  const nameOf = (id: string | null | undefined) =>
    id === 'auto' ? 'Blue' : (room.players.find((p) => p.id === id)?.name ?? 'Somebody');
  const turnTeam = $derived(room.turnTeam as Team);
  const turnSpymaster = $derived(room.teams.find((t) => t.team === turnTeam)?.spymasterId ?? null);
  const key = $derived((room.key ?? null) as Kind[] | null);

  const remainingMs = $derived(room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - (now + skewMs)) : 0);
  const clock = $derived.by(() => {
    const s = Math.ceil(remainingMs / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  // Derived from the prop each time, so a card turned by a team-mate or a new turn drops the lift.
  const liftedCard = $derived(
    lifted && room.phase === 'guess' && room.canGuess && lifted.turn === room.turns && room.cards[lifted.card]?.by === null
      ? lifted.card
      : null,
  );
  const shownClueError = $derived(clueError && clueError.turn === room.turns && room.canClue ? clueError.text : null);

  const lastLine = $derived.by(() => {
    const l = room.last;
    if (!l) return null;
    const word = room.cards[l.card]?.word?.toUpperCase() ?? '';
    return l.by === 'auto'
      ? `Blue turned over ${word} by itself.`
      : `${nameOf(l.by)} turned over ${word}: ${kindName(l.kind as Kind)}.`;
  });

  const outcome = $derived.by(() => {
    const r = room.result;
    if (!r) return { title: 'Game over', line: '' };
    const won = room.winnerIds.includes(room.meId);
    if (coop) {
      if (r.winner === 'red') return { title: 'You win', line: 'Every red agent found before blue ran out.' };
      const line =
        r.reason === 'assassin'
          ? 'The assassin was turned over.'
          : r.reason === 'left'
            ? 'Too few players were left.'
            : 'Blue turned over all of its agents first.';
      return { title: 'You lose', line };
    }
    const w = r.winner as Team | null;
    if (!w) return { title: 'Game over', line: '' };
    const loser = otherTeam(w);
    const line =
      r.reason === 'assassin'
        ? `${teamName(loser)} turned over the assassin.`
        : r.reason === 'left'
          ? `${teamName(loser)} had nobody left.`
          : `${teamName(w)} found every agent.`;
    const title = won ? 'You win' : myTeam === loser ? 'You lose' : `${teamName(w)} wins`;
    return { title, line };
  });

  function say(text: string) {
    toast = { text, key: ++toastSeq };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2600);
  }

  async function send(body: Record<string, unknown>): Promise<WireRoom | null> {
    if (busy) return null;
    busy = true;
    try {
      return await playAct<WireRoom>(code, body);
    } catch (err) {
      throw err instanceof Error ? err : new Error('That did not go through.');
    } finally {
      busy = false;
    }
  }

  async function pick(team: Team | null, spymaster: boolean) {
    try {
      await send({ action: 'team', team, spymaster });
    } catch (err) {
      say((err as Error).message);
    }
  }

  async function giveClue(e: SubmitEvent) {
    e.preventDefault();
    const word = clueWord.trim();
    const turn = room.turns;
    if (!word) {
      clueError = { text: 'Type a clue.', turn };
      return;
    }
    if (/\s/.test(word)) {
      clueError = { text: 'One word, letters only.', turn };
      return;
    }
    try {
      await send({ action: 'clue', word, count: clueCount });
      clueWord = '';
      clueCount = 1;
      clueError = null;
      navigator.vibrate?.(15);
    } catch (err) {
      clueError = { text: (err as Error).message, turn };
      navigator.vibrate?.([30, 40, 30]);
    }
  }

  async function tapCard(i: number) {
    if (!room.canGuess || busy || room.cards[i]?.by !== null) return;
    if (liftedCard !== i) {
      lifted = { card: i, turn: room.turns };
      navigator.vibrate?.(8);
      return;
    }
    lifted = null;
    try {
      const out = await send({ action: 'guess', card: i });
      const kind = out?.cards[i]?.kind as Kind | null;
      if (kind === myTeam) navigator.vibrate?.(20);
      else if (kind) navigator.vibrate?.([40, 50, 40]);
    } catch (err) {
      say((err as Error).message);
    }
  }

  async function stop() {
    try {
      await send({ action: 'pass' });
    } catch (err) {
      say((err as Error).message);
    }
  }

  const step = (d: number) => (clueCount = Math.min(MAX_COUNT, Math.max(1, clueCount + d)));
</script>

{#snippet scores()}
  <div class="cnp-scores">
    {#each room.teams as t (t.team)}
      {#if !coop || t.team === 'red' || t.agents}
        <span class="cnp-score cnp-{t.team}">
          <span class="cnp-score-n">{t.left}</span>
          <span class="cnp-score-l">{teamName(t.team as Team)} left</span>
        </span>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet clueBanner()}
  {#if room.clue}
    <div class="cnp-clue cnp-{room.clue.team}">
      <span class="cnp-clue-word">{room.clue.word}</span>
      <span class="cnp-clue-n">{room.clue.count}</span>
      <span class="cnp-clue-left">
        {room.clue.guessesLeft} {room.clue.guessesLeft === 1 ? 'guess' : 'guesses'} left
      </span>
    </div>
  {/if}
{/snippet}

{#snippet keyGrid()}
  {#if key}
    <div class="cnp-grid" role="list" aria-label="The key">
      {#each room.cards as c (c.i)}
        <div class="cnp-card cnp-key cnp-k-{key[c.i]}" class:cnp-done={c.by !== null} role="listitem">
          <span class="cnp-word">{c.word}</span>
        </div>
      {/each}
    </div>
    <p class="cnp-legend">
      <span class="cnp-sw cnp-k-red"></span>Red
      <span class="cnp-sw cnp-k-blue"></span>Blue
      <span class="cnp-sw cnp-k-neutral"></span>Bystander
      <span class="cnp-sw cnp-k-assassin"></span>Assassin
    </p>
  {/if}
{/snippet}

<div class="cnp">
  {#if room.phase === 'lobby'}
    <section class="cnp-stack">
      <p class="cnp-kicker">Codenames · {coop ? 'co-op' : 'two teams'}</p>
      <h1 class="cnp-title">Pick a side</h1>
      <p class="cnp-lead">
        {#if coop}
          Two or three play together as red, against the clock. One of you gives the clues.
        {:else}
          Two teams. Each has a spymaster who gives the clues.
        {/if}
      </p>

      <div class="cnp-picks" role="group" aria-label="Your team">
        {#each SIDES as t (t ?? 'any')}
          <button
            type="button"
            class="cnp-pick cnp-pick-{t ?? 'any'}"
            class:cnp-on={myTeam === t}
            aria-pressed={myTeam === t}
            disabled={busy}
            onclick={() => pick(t, iGiveClues)}
          >
            {teamName(t)}
          </button>
        {/each}
      </div>

      <button
        type="button"
        class="cnp-toggle"
        class:cnp-on={iGiveClues}
        role="switch"
        aria-checked={iGiveClues}
        disabled={busy}
        onclick={() => pick(myTeam, !iGiveClues)}
      >
        <span class="cnp-switch" aria-hidden="true"><span></span></span>
        I'll be spymaster
      </button>

      <div class="cnp-teams">
        {#each SIDES as t (t ?? 'any')}
          {@const list = joinedPlayers.filter((p) => p.team === t)}
          {#if t !== null || list.length}
            <div class="cnp-team cnp-{t ?? 'any'}">
              <h2 class="cnp-kicker">{t ? teamName(t) : 'Anywhere'} · {list.length}</h2>
              <ul class="cnp-list">
                {#each list as p (p.id)}
                  <li class:cnp-mine={p.id === room.meId}>
                    <span>{p.name}{p.id === room.meId ? ' (you)' : ''}</span>
                    {#if p.spymaster}<span class="cnp-tag">Spymaster</span>{/if}
                  </li>
                {:else}
                  <li class="cnp-empty">Nobody yet</li>
                {/each}
              </ul>
            </div>
          {/if}
        {/each}
      </div>
      <p class="cnp-lead cnp-quiet">
        {coop ? 'Everyone plays red in co-op.' : 'Teams are evened out at the start.'} The TV starts the game.
      </p>
    </section>
  {:else if room.phase === 'countdown'}
    <section class="cnp-centre">
      <p class="cnp-kicker">Get ready</p>
      <p class="cnp-count">{Math.max(1, Math.ceil(remainingMs / 1000))}</p>
      <p class="cnp-lead">Dealing the cards. Teams are set as the board goes up.</p>
    </section>
  {:else if room.phase === 'clue' || room.phase === 'guess'}
    <header class="cnp-bar">
      <span class="cnp-role cnp-{myTeam ?? 'any'}">
        {teamName(myTeam)} · {iGiveClues ? 'spymaster' : 'operative'}
      </span>
      <span class="cnp-clock" class:cnp-late={remainingMs < 15_000}>{clock}</span>
    </header>
    {@render scores()}

    {#if room.phase === 'clue' && room.canClue}
      <p class="cnp-kicker">Your clue</p>
      {@render keyGrid()}
      <form class="cnp-form" onsubmit={giveClue}>
        <input
          class="cnp-input"
          class:cnp-bad={!!shownClueError}
          type="text"
          bind:value={clueWord}
          oninput={() => (clueError = null)}
          placeholder="One word"
          aria-label="Clue word"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          enterkeyhint="send"
          maxlength={MAX_CLUE}
        />
        <div class="cnp-stepper" role="group" aria-label="How many cards">
          <button type="button" class="cnp-step" onclick={() => step(-1)} disabled={clueCount <= 1} aria-label="One fewer">−</button>
          <span class="cnp-step-n" aria-live="polite">{clueCount}</span>
          <button type="button" class="cnp-step" onclick={() => step(1)} disabled={clueCount >= MAX_COUNT} aria-label="One more">+</button>
        </div>
        <button class="cnp-go" type="submit" disabled={busy || !clueWord.trim()}>Give clue</button>
      </form>
      {#if shownClueError}
        <p class="cnp-refused" role="alert">{shownClueError}</p>
      {/if}
      <p class="cnp-lead cnp-quiet">Not a word on the board, nor part of one.</p>
    {:else if room.phase === 'clue'}
      <section class="cnp-wait">
        <p class="cnp-lead">Waiting for {teamName(turnTeam)}'s spymaster…</p>
        {#if turnSpymaster}<p class="cnp-sub">{nameOf(turnSpymaster)} is thinking.</p>{/if}
      </section>
      {#if lastLine}<p class="cnp-last">{lastLine}</p>{/if}
      {@render keyGrid()}
    {:else if room.canGuess}
      {@render clueBanner()}
      <div class="cnp-grid" role="group" aria-label="The words">
        {#each room.cards as c (c.i)}
          {@const kind = c.kind as Kind | null}
          <button
            type="button"
            class="cnp-card cnp-tap {kind ? `cnp-k-${kind}` : ''} {!kind && key ? `cnp-hint-${key[c.i]}` : ''}"
            class:cnp-done={c.by !== null}
            class:cnp-lifted={liftedCard === c.i}
            disabled={c.by !== null || busy}
            aria-pressed={liftedCard === c.i}
            aria-label={c.by !== null ? `${c.word}, ${kindName(kind)}` : c.word}
            onclick={() => tapCard(c.i)}
          >
            <span class="cnp-word">{c.word}</span>
          </button>
        {/each}
      </div>
      <p class="cnp-lead cnp-quiet cnp-centred">
        {liftedCard !== null ? `Tap ${room.cards[liftedCard].word.toUpperCase()} again to turn it over.` : 'Tap a word, then tap it again to turn it over.'}
      </p>
      {#if lastLine}<p class="cnp-last">{lastLine}</p>{/if}
      <button type="button" class="cnp-pass" onclick={stop} disabled={busy || !room.clue?.cards.length}>
        {room.clue?.cards.length ? 'Stop guessing' : 'Make one guess first'}
      </button>
    {:else}
      {@render clueBanner()}
      <section class="cnp-wait">
        <p class="cnp-lead">{teamName(turnTeam)} is guessing.</p>
        <p class="cnp-sub">Watch the TV.</p>
      </section>
      {#if lastLine}<p class="cnp-last">{lastLine}</p>{/if}
      {@render keyGrid()}
    {/if}
  {:else if room.phase === 'finished'}
    <section class="cnp-stack">
      <p class="cnp-kicker">Game over</p>
      <h1 class="cnp-title">{outcome.title}</h1>
      {#if outcome.line}<p class="cnp-lead">{outcome.line}</p>{/if}
      {@render scores()}
      <div class="cnp-teams">
        {#each finalTeams as t (t)}
          {@const list = room.players.filter((p) => p.team === t && (p.status === 'joined' || p.status === 'left'))}
          <div class="cnp-team cnp-{t}">
            <h2 class="cnp-kicker">{teamName(t)}{room.result?.winner === t ? ' · won' : ''}</h2>
            <ul class="cnp-list">
              {#each list as p (p.id)}
                <li class:cnp-mine={p.id === room.meId}>
                  <span>{p.name}{p.status === 'left' ? ' (left)' : ''}</span>
                  {#if p.spymaster}<span class="cnp-tag">Spymaster</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
      {#if room.clues.length}
        <h2 class="cnp-kicker cnp-gap">The clues</h2>
        <ol class="cnp-list">
          {#each room.clues as c, n (n)}
            <li class="cnp-clue-row cnp-{c.team}">
              <span>{c.word} {c.count}</span>
              <span class="cnp-tag">{c.cards.length} turned</span>
            </li>
          {/each}
        </ol>
      {/if}
      <p class="cnp-lead cnp-quiet">The whole key is on the TV. The TV takes everyone back to the lobby.</p>
    </section>
  {:else}
    <section class="cnp-centre">
      <p class="cnp-kicker">Codenames</p>
      <p class="cnp-lead">That game has ended.</p>
    </section>
  {/if}

  {#if toast}
    {#key toast.key}
      <p class="cnp-toast" role="status">{toast.text}</p>
    {/key}
  {/if}
</div>

<style>
  .cnp {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0 32px;
  }
  .cnp-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .cnp-centre {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
  }
  .cnp-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .cnp-gap {
    margin-top: 12px;
  }
  .cnp-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.75rem;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--chrome-ink);
  }
  .cnp-count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .cnp-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .cnp-quiet {
    color: var(--on-ink-55);
    font-size: var(--fs-body-sm);
  }
  .cnp-centred {
    text-align: center;
  }
  .cnp-sub {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--on-ink-55);
  }

  /* ---- Lobby ---- */
  .cnp-picks {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
  }
  .cnp-pick {
    min-height: 64px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
    color: var(--chrome-ink);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.15rem;
  }
  .cnp-pick-red {
    border-color: var(--red-on-dark);
  }
  .cnp-pick-blue {
    border-color: var(--blue-on-dark);
  }
  .cnp-pick-red.cnp-on {
    background: var(--red);
    border-color: var(--red);
  }
  .cnp-pick-blue.cnp-on {
    background: var(--blue);
    border-color: var(--blue);
  }
  .cnp-pick-any.cnp-on {
    background: var(--on-ink-16);
    border-color: var(--chrome-ink);
  }
  .cnp-pick:disabled,
  .cnp-toggle:disabled {
    opacity: 0.6;
  }
  .cnp-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 0 14px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    text-align: left;
  }
  .cnp-toggle.cnp-on {
    border-color: var(--accent-on-dark);
  }
  .cnp-switch {
    position: relative;
    flex: none;
    width: 44px;
    height: 26px;
    border-radius: 100px;
    background: var(--on-ink-16);
  }
  .cnp-switch span {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 100px;
    background: var(--on-ink-55);
    transition: transform 150ms ease;
  }
  .cnp-toggle.cnp-on .cnp-switch {
    background: var(--accent);
  }
  .cnp-toggle.cnp-on .cnp-switch span {
    transform: translateX(18px);
    background: var(--chrome-ink);
  }
  .cnp-teams {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 6px;
  }
  .cnp-team {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 10px;
    border-left: 2px solid var(--on-ink-30);
  }
  .cnp-team.cnp-red {
    border-left-color: var(--red-on-dark);
  }
  .cnp-team.cnp-blue {
    border-left-color: var(--blue-on-dark);
  }
  .cnp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cnp-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .cnp-list li.cnp-mine {
    background: var(--on-ink-12);
  }
  .cnp-list li.cnp-empty {
    color: var(--on-ink-55);
  }
  .cnp-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .cnp-list li.cnp-clue-row {
    border-left: 2px solid var(--on-ink-30);
    font-family: var(--font-mono);
  }
  .cnp-clue-row.cnp-red {
    border-left-color: var(--red-on-dark);
  }
  .cnp-clue-row.cnp-blue {
    border-left-color: var(--blue-on-dark);
  }

  /* ---- Play ---- */
  .cnp-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .cnp-role {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-ink-70);
  }
  .cnp-role.cnp-red {
    color: var(--red-on-dark);
  }
  .cnp-role.cnp-blue {
    color: var(--blue-on-dark);
  }
  .cnp-clock {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2rem;
    color: var(--chrome-ink);
    font-variant-numeric: tabular-nums;
  }
  .cnp-clock.cnp-late {
    color: var(--accent-on-dark);
  }
  .cnp-scores {
    display: flex;
    gap: 6px;
  }
  .cnp-score {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 12px;
    border-left: 2px solid var(--on-ink-30);
    background: var(--on-ink-05);
  }
  .cnp-score.cnp-red {
    border-left-color: var(--red-on-dark);
  }
  .cnp-score.cnp-blue {
    border-left-color: var(--blue-on-dark);
  }
  .cnp-score-n {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.5rem;
    color: var(--chrome-ink);
  }
  .cnp-score-l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .cnp-clue {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 2px;
    background: var(--on-ink-08);
  }
  .cnp-clue.cnp-red {
    background: var(--red);
  }
  .cnp-clue.cnp-blue {
    background: var(--blue);
  }
  .cnp-clue-word {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
    letter-spacing: 0.04em;
    line-height: 1;
    color: var(--chrome-ink);
    overflow-wrap: anywhere;
  }
  .cnp-clue-n {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 100px;
    background: var(--chrome-bg);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.25rem;
    color: var(--chrome-ink);
  }
  .cnp-clue-left {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--chrome-ink);
    text-align: right;
  }
  .cnp-wait {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 20px 0 8px;
    text-align: center;
  }
  .cnp-wait .cnp-lead {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.4rem;
    color: var(--chrome-ink);
  }
  .cnp-last {
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }

  /* ---- The grid (key and words) ---- */
  .cnp-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    width: 100%;
  }
  .cnp-card {
    display: grid;
    place-items: center;
    min-height: 60px;
    padding: 4px 2px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
    color: var(--chrome-ink);
    text-align: center;
    touch-action: manipulation;
    -webkit-user-select: none;
    user-select: none;
  }
  .cnp-word {
    font-family: var(--font-body);
    font-size: clamp(12px, 3.3vw, 15px);
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .cnp-k-red {
    background: var(--red);
    border-color: var(--red);
  }
  .cnp-k-blue {
    background: var(--blue);
    border-color: var(--blue);
  }
  .cnp-k-neutral {
    background: var(--on-ink-16);
    border-color: var(--on-ink-16);
  }
  .cnp-k-assassin {
    background: var(--chrome-bg);
    border-color: var(--error);
    color: var(--error);
  }
  .cnp-key.cnp-done {
    opacity: 0.35;
  }
  .cnp-key.cnp-done .cnp-word {
    text-decoration: line-through;
  }
  .cnp-tap.cnp-done {
    opacity: 0.55;
  }
  .cnp-tap:disabled {
    cursor: default;
  }
  .cnp-tap.cnp-lifted {
    border-color: var(--accent-on-dark);
    background: var(--accent);
    transform: translateY(-3px);
  }
  /* A spymaster guessing alone still sees the key: a tinted edge on face-down cards. */
  .cnp-hint-red {
    border-color: var(--red-on-dark);
  }
  .cnp-hint-blue {
    border-color: var(--blue-on-dark);
  }
  .cnp-hint-assassin {
    border-color: var(--error);
  }
  .cnp-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--on-ink-55);
  }
  .cnp-sw {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid transparent;
    border-radius: 2px;
  }

  /* ---- Clue form ---- */
  .cnp-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    margin-top: 4px;
  }
  .cnp-input {
    min-width: 0;
    padding: 12px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-size: 16px;
    text-transform: uppercase;
  }
  .cnp-input:focus {
    outline: none;
    border-color: var(--accent-on-dark);
  }
  .cnp-input.cnp-bad {
    border-color: var(--error);
  }
  .cnp-stepper {
    display: flex;
    align-items: center;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
  }
  .cnp-step {
    width: 48px;
    height: 48px;
    border: 0;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.5rem;
  }
  .cnp-step:disabled {
    opacity: 0.3;
  }
  .cnp-step-n {
    min-width: 28px;
    text-align: center;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.5rem;
    color: var(--chrome-ink);
    font-variant-numeric: tabular-nums;
  }
  .cnp-go,
  .cnp-pass {
    min-height: 56px;
    border: 0;
    border-radius: 2px;
    background: var(--accent);
    color: var(--chrome-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .cnp-go {
    grid-column: 1 / -1;
  }
  .cnp-pass {
    margin-top: 6px;
    background: transparent;
    border: 2px solid var(--on-ink-30);
  }
  .cnp-go:disabled,
  .cnp-pass:disabled {
    opacity: 0.45;
  }
  .cnp-refused {
    margin: 0;
    padding: 10px 12px;
    border-left: 2px solid var(--error);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--error);
  }

  .cnp-toast {
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
    animation: cnp-pop 180ms ease-out both;
  }
  @keyframes cnp-pop {
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
