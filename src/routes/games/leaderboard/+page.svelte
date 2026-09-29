<script lang="ts">
  // /games/leaderboard — every finished round of every family game, read back
  // as today / this week (Monday on, UK time) / all time: the overall wins
  // table, then a board per game with each person's best score (and what it
  // was set on), wins and games. The app's Leaderboard screen reads the same
  // answer from /api/native/games/leaderboard.
  import GamesFrame from '$lib/components/games/GamesFrame.svelte';
  import GamesCover from '$lib/components/games/GamesCover.svelte';
  import SectionHead from '$lib/components/shell/SectionHead.svelte';
  import type { Window } from '$lib/games/results';

  let { data } = $props();

  let nightChoice = $state<boolean | null>(null);
  const night = $derived(nightChoice ?? data.night);
  const board = $derived(data.board);

  const WINDOWS: { id: Window; label: string; note: string }[] = [
    { id: 'day', label: 'Today', note: 'Since midnight, UK time.' },
    { id: 'week', label: 'This week', note: 'Since Monday midnight, UK time.' },
    { id: 'all', label: 'All time', note: 'Every game ever recorded.' },
  ];
  const current = $derived(WINDOWS.find((w) => w.id === board.window) ?? WINDOWS[1]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const played = $derived(board.overall.reduce((sum, row) => sum + row.played, 0));
  const leader = $derived(board.overall[0] ?? null);
</script>

<svelte:head>
  <title>sr. games — Leaderboard</title>
</svelte:head>

<GamesFrame
  path="/games/leaderboard"
  {night}
  footer={['strangeramblings.com/games/leaderboard', 'every finished game, every game', 'UK time · weeks start Monday']}
>
  <GamesCover
    eyebrow="Family games · leaderboard"
    title={['HIGH SCORES,', 'WINS, GAMES.']}
    standfirst="Every finished game in the app and on the web, today, this week or all time. Solo games count for high scores; nobody wins alone."
    deck={[
      { label: 'Window', value: current.label.toUpperCase(), note: current.note },
      { label: 'Players', value: pad(board.overall.length), note: 'On the board' },
      { label: 'Top wins', value: leader ? pad(leader.wins) : '—', note: leader ? leader.name : 'No games yet' },
    ]}
    {night}
    onnight={(n) => (nightChoice = n)}
  >
    <nav class="windows" aria-label="Leaderboard window">
      {#each WINDOWS as w (w.id)}
        <a
          href="?window={w.id}"
          class="window"
          class:on={w.id === board.window}
          aria-current={w.id === board.window ? 'page' : undefined}
          data-sveltekit-noscroll
        >
          {w.label}
        </a>
      {/each}
      <a class="window back" href="/games">Lobby</a>
    </nav>
  </GamesCover>

  {#if board.overall.length === 0}
    <section class="band">
      <div class="inner">
        <p class="empty">No games finished {current.id === 'all' ? 'yet' : current.id === 'day' ? 'today' : 'this week'} — finish one and it lands here.</p>
      </div>
    </section>
  {:else}
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="01 / Overall"
          title={['EVERY GAME,', 'EVERY WIN']}
          strap={`${plural(played, 'place', 'places')} at a table, ${current.label.toLowerCase()}. Ranked by wins, then by fewer games.`}
        />
        <table class="board">
          <colgroup><col class="c-rank" /><col class="c-name" /><col class="c-num" /><col class="c-num" /></colgroup>
          <thead>
            <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" class="num">Wins</th><th scope="col" class="num">Games</th></tr>
          </thead>
          <tbody>
            {#each board.overall as row (row.playerId)}
              <tr class:me={row.playerId === data.meId}>
                <td class="rank" class:first={row.rank === 1}>{row.rank}</td>
                <td class="name">{row.name}{#if row.playerId === data.meId}<span class="you">you</span>{/if}</td>
                <td class="num big">{row.wins}</td>
                <td class="num">{row.played}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#each board.games as game, i (game.game)}
      <section class="band">
        <div class="inner">
          <SectionHead
            kicker={`${pad(i + 2)} / ${game.title}`}
            title={[game.title.toUpperCase(), game.scored ? 'BEST SCORES' : 'MOST WINS']}
            strap={game.scored
              ? 'Each person’s best score, with the board it was set on. Ties go to whoever got there first.'
              : 'No score to beat in this one: ranked by wins, then by fewer games.'}
          />
          <table class="board">
            {#if game.scored}
              <colgroup><col class="c-rank" /><col class="c-name" /><col class="c-num" /><col class="c-num" /><col class="c-num" /></colgroup>
            {:else}
              <colgroup><col class="c-rank" /><col class="c-name" /><col class="c-num" /><col class="c-num" /></colgroup>
            {/if}
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                {#if game.scored}<th scope="col" class="num">Best</th>{/if}
                <th scope="col" class="num">Wins</th>
                <th scope="col" class="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {#each game.rows as row (row.playerId)}
                <tr class:me={row.playerId === data.meId}>
                  <td class="rank" class:first={row.rank === 1}>{row.rank}</td>
                  <td class="name">
                    {row.name}{#if row.playerId === data.meId}<span class="you">you</span>{/if}
                    {#if game.scored && row.bestLabel}<span class="label">{row.bestLabel}</span>{/if}
                  </td>
                  {#if game.scored}<td class="num big">{row.best ?? '—'}</td>{/if}
                  <td class="num" class:big={!game.scored}>{row.wins}</td>
                  <td class="num">{row.played}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  {/if}
</GamesFrame>

<style>
  .windows {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 18px;
  }
  .window {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    text-decoration: none;
    color: var(--chrome-ink);
    border: 1px solid var(--chrome-line);
  }
  .window:hover {
    border-color: var(--chrome-ink);
  }
  .window.on {
    background: var(--chrome-accent);
    border-color: var(--chrome-accent);
    color: var(--chrome-bg);
  }
  .window.back {
    color: var(--chrome-muted);
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
  .empty {
    margin: 0;
    padding: 18px 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .board {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    border-top: 1px solid var(--line-strong);
  }
  .c-rank {
    width: 3rem;
  }
  .c-num {
    width: 4.5rem;
  }
  th {
    padding: 10px 8px 10px 0;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--line-strong);
  }
  td {
    padding: 14px 8px 14px 0;
    vertical-align: middle;
    border-bottom: 1px solid var(--line-strong);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td.num {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  td.num.big {
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--text-primary);
  }
  .rank {
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--text-ghost);
  }
  .rank.first {
    color: var(--accent);
  }
  .name {
    font-size: var(--fs-body-sm);
    overflow-wrap: anywhere;
  }
  .label {
    display: block;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .you {
    margin-left: 8px;
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
    border: 1px solid var(--accent-ink);
  }
  tr.me td {
    background: var(--card-bg);
  }
  tr.me td:first-child {
    border-left: 3px solid var(--accent-ink);
    padding-left: 8px;
  }
  @media (max-width: 480px) {
    .c-rank {
      width: 2.25rem;
    }
    .c-num {
      width: 3.25rem;
    }
    th,
    td {
      padding-right: 4px;
    }
  }
</style>
