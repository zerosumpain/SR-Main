<script lang="ts">
  // /games — the web lobby into the same in-memory rooms the iPhone app plays
  // in. Liar's Dice plays here; every other game in a room you are in or
  // invited to says "Open in the app".
  //
  // It polls `/api/games` every 5 s while the tab is visible, exactly as the
  // app does — that poll is how an invite reaches you, and how the family's
  // lobbies learn you are here to be invited.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import GamesFrame from '$lib/components/games/GamesFrame.svelte';
  import GamesCover from '$lib/components/games/GamesCover.svelte';
  import SectionHead from '$lib/components/shell/SectionHead.svelte';
  import { DICE_COUNTS, DIFFICULTIES, TURN_MS, ruleLine, type Difficulty } from '$lib/games/liars-dice';
  import { GAME_NAMES, playableOnWeb } from '$lib/games/web';

  let { data } = $props();

  let fresh = $state<typeof data.lobby | null>(null);
  const lobby = $derived(fresh ?? data.lobby);
  let nightChoice = $state<boolean | null>(null);
  const night = $derived(nightChoice ?? data.night);

  let difficulty = $state<Difficulty>('medium');
  let dice = $state<number>(5);
  let invited = $state<string[]>([]);
  let busy = $state<string | null>(null);
  let problem = $state<string | null>(null);

  const gameName = (g: string) => GAME_NAMES[g as keyof typeof GAME_NAMES] ?? g;
  const phaseWord: Record<string, string> = {
    lobby: 'In the lobby',
    countdown: 'Starting',
    bidding: 'Playing',
    reveal: 'Playing',
    finished: 'Finished',
  };

  async function refresh() {
    try {
      const res = await fetch('/api/games', { headers: { accept: 'application/json' } });
      if (res.ok) fresh = await res.json();
    } catch {
      /* the next poll tries again */
    }
  }

  onMount(() => {
    // A plain handle, never $state: nothing renders it.
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  });

  async function post(url: string, body: Record<string, unknown>): Promise<{ room?: { id: string } } | null> {
    problem = null;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      problem = out.error ?? 'Something went wrong. Try again.';
      return null;
    }
    return out;
  }

  async function join(roomId: string) {
    busy = roomId;
    const out = await post(`/api/games/${roomId}`, { action: 'join' });
    busy = null;
    if (out) await goto(`/games/${roomId}`);
    else void refresh();
  }

  async function decline(roomId: string) {
    busy = roomId;
    await post(`/api/games/${roomId}`, { action: 'decline' });
    busy = null;
    void refresh();
  }

  async function start(event: SubmitEvent) {
    event.preventDefault();
    busy = 'start';
    const out = await post('/api/games', { game: 'liars-dice', difficulty, dice, invite: invited });
    busy = null;
    if (out?.room) await goto(`/games/${out.room.id}`);
  }

  function toggle(id: string) {
    invited = invited.includes(id) ? invited.filter((x) => x !== id) : [...invited, id];
  }

  const pad = (n: number) => String(n).padStart(2, '0');
</script>

<svelte:head>
  <title>sr. games — Liar's Dice</title>
</svelte:head>

<GamesFrame
  path="/games"
  {night}
  footer={['strangeramblings.com/games · family games', "Liar's Dice on the web · the rest in the app", 'same rooms, same players']}
>
  <GamesCover
    eyebrow="Family games · on the web"
    title={["LIAR'S DICE,", 'AT THE TABLE.']}
    standfirst="Play the family at the same table as the app. Your dice stay under your cup; raise the bid or call it a lie."
    deck={[
      { label: 'Invites', value: pad(lobby.invites.length), note: lobby.invites.length ? 'Waiting on you' : 'None open' },
      { label: 'Your games', value: pad(lobby.rooms.length), note: 'Open now' },
      { label: 'Players', value: pad(lobby.players.length), note: 'You can invite' },
    ]}
    {night}
    onnight={(n) => (nightChoice = n)}
  >
    <a class="board-link" href="/games/leaderboard">Leaderboard — today, this week, all time →</a>
  </GamesCover>

  {#if problem}
    <p class="problem" role="alert">{problem}</p>
  {/if}

  <section class="band">
    <div class="inner">
      <SectionHead kicker="01 / Invites" title={['ASKED', 'TO PLAY']} strap="Invites from the family, the app's and the web's alike. They stay open while the host's lobby does." />
      {#if lobby.invites.length === 0}
        <p class="empty">No invites right now — this page checks every few seconds.</p>
      {:else}
        <ul class="rows">
          {#each lobby.invites as inv (inv.roomId)}
            <li class="row">
              <div class="row-main">
                <span class="row-kicker">{gameName(inv.game)} · {inv.difficulty}{inv.about ? ` · ${inv.about}` : ''}</span>
                <span class="row-title">{inv.hostName} asked you</span>
                <span class="row-sub">{inv.players.join(', ')}</span>
              </div>
              <div class="row-acts">
                {#if playableOnWeb(inv.game)}
                  <button class="btn primary" disabled={busy === inv.roomId} onclick={() => join(inv.roomId)}>Join</button>
                {:else}
                  <span class="app-only">Open in the app</span>
                {/if}
                <button class="btn" disabled={busy === inv.roomId} onclick={() => decline(inv.roomId)}>Decline</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead kicker="02 / Your games" title={['AT A TABLE', 'NOW']} strap="Games you have joined, wherever you started them." />
      {#if lobby.rooms.length === 0}
        <p class="empty">You are not in a game.</p>
      {:else}
        <ul class="rows">
          {#each lobby.rooms as room (room.id)}
            <li class="row">
              <div class="row-main">
                <span class="row-kicker">{phaseWord[room.phase] ?? room.phase}</span>
                <span class="row-title">{gameName(room.game)}</span>
                <span class="row-sub">Hosted by {room.hostName}</span>
              </div>
              <div class="row-acts">
                {#if playableOnWeb(room.game)}
                  <a class="btn primary" href="/games/{room.id}">Open</a>
                {:else}
                  <span class="app-only">Open in the app</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead kicker="03 / New game" title={["START A", "LIAR'S DICE"]} strap="Two to six players. The host opens the first round; the loser of each call opens the next." />
      <form class="start" onsubmit={start}>
        <fieldset>
          <legend>Difficulty</legend>
          <div class="choices">
            {#each DIFFICULTIES as d (d)}
              <label class="choice" class:on={difficulty === d}>
                <input type="radio" name="difficulty" value={d} bind:group={difficulty} />
                <span class="choice-name">{d}</span>
                <span class="choice-note">{ruleLine(d)} {TURN_MS[d] / 1000} s a turn.</span>
              </label>
            {/each}
          </div>
        </fieldset>
        <fieldset>
          <legend>Dice each</legend>
          <div class="choices two">
            {#each DICE_COUNTS as n (n)}
              <label class="choice" class:on={dice === n}>
                <input type="radio" name="dice" value={n} bind:group={dice} />
                <span class="choice-name">{n} dice</span>
                <span class="choice-note">{n === 3 ? 'A quick game.' : 'The full game.'}</span>
              </label>
            {/each}
          </div>
        </fieldset>
        <fieldset>
          <legend>Invite</legend>
          {#if lobby.players.length === 0}
            <p class="empty">Nobody else can be invited yet: they need games access and the app, or this page open.</p>
          {:else}
            <div class="people">
              {#each lobby.players as p (p.id)}
                <label class="person" class:on={invited.includes(p.id)}>
                  <input type="checkbox" checked={invited.includes(p.id)} onchange={() => toggle(p.id)} />
                  {p.name}
                </label>
              {/each}
            </div>
          {/if}
        </fieldset>
        <div class="start-foot">
          <button class="btn primary big" type="submit" disabled={busy === 'start'}>
            {busy === 'start' ? 'Starting…' : 'Open the lobby'}
          </button>
          <span class="hint">You can invite more from the lobby before you start.</span>
        </div>
      </form>
    </div>
  </section>
</GamesFrame>

<style>
  .board-link {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    margin-top: 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--chrome-accent);
    text-decoration: none;
    border-bottom: 1px solid currentColor;
  }
  .band {
    padding: clamp(32px, 4.5vw, 64px) clamp(16px, 3vw, 44px);
    border-bottom: 2px solid var(--line-strong);
  }
  section.band:last-of-type {
    border-bottom: none;
  }
  .inner {
    max-width: 1200px;
    margin: 0 auto;
  }
  .problem {
    margin: 0;
    padding: 12px clamp(16px, 3vw, 44px);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--error);
    border-bottom: 1px solid var(--error);
  }
  .empty {
    margin: 0;
    padding: 18px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-strong);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line-strong);
  }
  .row-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1 1 240px;
  }
  .row-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent);
  }
  .row-title {
    font-family: var(--font-display);
    font-size: 1.25rem;
    line-height: 1.1;
    text-transform: uppercase;
    letter-spacing: -0.01em;
  }
  .row-sub {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .row-acts {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .app-only {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    border: 1px dashed var(--line-strong);
    padding: 8px 10px;
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
  .btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .btn.big {
    min-height: 48px;
    padding: 10px 22px;
  }
  .start {
    display: grid;
    gap: 22px;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend {
    margin-bottom: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: 1px solid var(--line-strong);
    border-left: 1px solid var(--line-strong);
  }
  .choices.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .choice {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
    border-right: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
    cursor: pointer;
    min-width: 0;
  }
  .choice input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .choice.on {
    background: var(--card-bg);
  }
  .choice.on::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
  }
  .choice:focus-within {
    outline: 2px solid var(--accent-ink);
    outline-offset: -2px;
  }
  .choice-name {
    font-family: var(--font-display);
    font-size: 1.1rem;
    text-transform: uppercase;
  }
  .choice-note {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-secondary);
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
    font-size: var(--fs-body-sm);
  }
  .person.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .person input {
    accent-color: var(--accent);
    margin: 0;
  }
  .start-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
  }
  .hint {
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  @media (max-width: 640px) {
    .choices,
    .choices.two {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
