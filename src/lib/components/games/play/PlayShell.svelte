<script lang="ts">
  // A seated phone at a party: follows the player's stream (`play-stream.ts`)
  // and shows the lobby, the running game's controller, or why it ended.
  // A game is picked by `room.game`; one without a web controller yet says so.
  import { onMount } from 'svelte';
  import { openPlay, type PlayParty, type PlayState } from './play-stream';
  import BogglePad from './boggle/BogglePad.svelte';
  import type { WireRoom as BoggleRoom } from '$lib/games/boggle';
  import QuizPad from './quiz/QuizPad.svelte';
  import CodenamesPad from './codenames/CodenamesPad.svelte';
  import AzulPad from './azul/AzulPad.svelte';
  import SnapPad from './snap/SnapPad.svelte';
  import type { WireRoom as SnapRoom } from '$lib/games/snap-happy';
  import type { WireRoom as QuizRoom } from '$lib/games/quiz-night';
  import type { WireRoom as CodenamesRoom } from '$lib/games/codenames';
  import type { WireRoom as AzulRoom } from '$lib/games/azul';

  let {
    code,
    meId,
    onUnseated,
  }: {
    code: string;
    meId: string;
    onUnseated: (message: string) => void;
  } = $props();

  let view = $state<PlayState>({ kind: 'connecting' });

  // Plain handle, never reactive (svelte5-pitfalls §1).
  let close: (() => void) | null = null;

  onMount(() => {
    close = openPlay(code, (s) => {
      view = s;
      if (s.kind === 'unseated') onUnseated(s.message);
    });
    return () => {
      close?.();
      close = null;
    };
  });

  const gameTitle = (p: PlayParty) => p.games.find((g) => g.id === p.game)?.title ?? 'a game';

  interface Standing {
    id: string;
    name: string;
    score: number;
  }
  const standingsOf = (room: Record<string, unknown>): Standing[] =>
    Array.isArray(room.standings) ? (room.standings as Standing[]).filter((s) => s && typeof s.name === 'string') : [];
</script>

{#if view.kind === 'connecting'}
  <section class="play-centre">
    <p class="play-lead">Connecting…</p>
  </section>
{:else if view.kind === 'party'}
  {@const party = view.party}
  <section class="play-lobby">
    <p class="play-kicker">At {party.tvName}</p>
    <h1 class="play-title">{party.game ? gameTitle(party) : 'Pick a game on the TV'}</h1>
    <p class="play-lead">
      {party.phase === 'playing' ? 'Joining the game…' : 'Waiting for the TV to start…'}
    </p>
    {#if party.notice}
      <p class="play-notice">{party.notice}</p>
    {/if}
    <h2 class="play-label">Who is in · {party.members.length}</h2>
    <ul class="play-members">
      {#each party.members as m (m.id)}
        <li class:play-me={m.id === meId}>
          <span class="play-dot" class:play-on={m.online} aria-hidden="true"></span>
          {m.name}{m.id === meId ? ' (you)' : ''}
        </li>
      {/each}
    </ul>
  </section>
{:else if view.kind === 'room'}
  {#if view.room.game === 'boggle'}
    <BogglePad {code} room={view.room as unknown as BoggleRoom} skewMs={view.skewMs} />
  {:else if view.room.game === 'quiz-night'}
    <QuizPad {code} room={view.room as unknown as QuizRoom} skewMs={view.skewMs} />
  {:else if view.room.game === 'codenames'}
    <CodenamesPad {code} room={view.room as unknown as CodenamesRoom} skewMs={view.skewMs} />
  {:else if view.room.game === 'azul'}
    <AzulPad {code} room={view.room as unknown as AzulRoom} skewMs={view.skewMs} />
  {:else if view.room.game === 'snap-happy'}
    <SnapPad {code} room={view.room as unknown as SnapRoom} skewMs={view.skewMs} />
  {:else if view.room.phase === 'finished'}
    {@const table = standingsOf(view.room)}
    <section class="play-centre">
      <p class="play-kicker">Game over</p>
      <h1 class="play-title">{gameTitle(view.party)}</h1>
      {#if table.length}
        <ol class="play-standings">
          {#each table as s, i (s.id)}
            <li class:play-me={s.id === meId}><span>{i + 1}. {s.name}</span><span>{s.score}</span></li>
          {/each}
        </ol>
      {:else}
        <p class="play-lead">The scores are on the TV.</p>
      {/if}
    </section>
  {:else}
    <section class="play-centre">
      <p class="play-kicker">{gameTitle(view.party)}</p>
      <p class="play-lead">This game's controls are coming soon — watch the TV.</p>
    </section>
  {/if}
{:else if view.kind === 'kicked'}
  <section class="play-centre">
    <h1 class="play-title">You're out</h1>
    <p class="play-lead">You were taken out of this game on the TV.</p>
  </section>
{:else if view.kind === 'closed'}
  <section class="play-centre">
    <h1 class="play-title">That's the end</h1>
    <p class="play-lead">This game has ended. Scan the code on the TV again to rejoin.</p>
  </section>
{/if}

<style>
  .play-centre,
  .play-lobby {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 32px 0;
  }
  .play-centre {
    align-items: center;
    text-align: center;
    justify-content: center;
    min-height: 50vh;
  }
  .play-kicker,
  .play-label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .play-label {
    margin-top: 16px;
  }
  .play-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.25rem;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--chrome-ink);
  }
  .play-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .play-notice {
    margin: 0;
    padding: 10px 12px;
    border-left: 2px solid var(--accent-on-dark);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
    background: var(--on-ink-05);
  }
  .play-members,
  .play-standings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
  }
  .play-members li,
  .play-standings li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--chrome-ink);
  }
  .play-standings li {
    justify-content: space-between;
  }
  .play-standings li span:last-child {
    font-family: var(--font-mono);
  }
  li.play-me {
    background: var(--on-ink-12);
  }
  .play-dot {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--on-ink-30);
  }
  .play-dot.play-on {
    background: var(--success);
  }
</style>
