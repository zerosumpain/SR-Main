<script lang="ts">
  // Snap Happy on a phone at the TV: the target small at the top and one
  // enormous SNAP button. The phone never knows when the target comes (the run
  // stays on the TV), only when the pictures start and when the round shuts.
  // A tap is timed on the server's clock the instant the finger lands, before
  // anything is awaited, so the network never enters the score. Drives the
  // wire from `toWire` in $lib/games/snap-happy and posts
  // `{ action: 'snap', round, at }` through the party's act route.
  import { onMount } from 'svelte';
  import { PICTURES, type WireRoom } from '$lib/games/snap-happy';
  import SnapPicture from '../../snap/SnapPicture.svelte';
  import { playAct } from '../play-stream';

  let { code, room, skewMs = 0 }: { code: string; room: WireRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  /** The round number a snap is on its way for, until the wire shows it. */
  let sentFor = $state<number | null>(null);
  let toast = $state<{ text: string; key: number } | null>(null);

  // Plain handles, never reactive (svelte5-pitfalls §1).
  let ticker: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let toastSeq = 0;

  onMount(() => {
    ticker = setInterval(() => (now = Date.now()), 100);
    return () => {
      if (ticker) clearInterval(ticker);
      if (toastTimer) clearTimeout(toastTimer);
      ticker = null;
      toastTimer = null;
    };
  });

  const serverNow = $derived(now + skewMs);
  const r = $derived(room.round);
  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const myScore = $derived(me?.score ?? 0);
  const mine = $derived(r?.mine ?? null);
  const live = $derived(room.phase === 'armed' && !!r);
  const watching = $derived(live && !!r && serverNow < r.startsAt);
  const shut = $derived(live && !!r && serverNow >= r.closesAt);
  const snappedNow = $derived(!!mine || (!!r && sentFor === r.number));
  const canSnap = $derived(live && !watching && !shut && !snappedNow);
  const remainingMs = $derived(room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - serverNow) : 0);
  const targetLabel = $derived(r ? PICTURES[r.target].label : '');

  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const ordinal = (n: number) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };

  const buttonLabel = $derived.by(() => {
    if (watching) return 'Watch the TV…';
    if (snappedNow) return 'Snapped';
    if (shut) return 'Too late';
    return 'Snap';
  });

  /** This round, once settled: what I did and what it scored. */
  const outcome = $derived.by(() => {
    if (room.phase !== 'result' || !r) return null;
    const s = r.snaps?.find((x) => x.playerId === room.meId) ?? mine;
    if (!s) return { head: 'No snap', points: 0 };
    if (s.early) return { head: 'Too early', points: s.points };
    if (s.reactionMs === null) return { head: 'Too slow', points: s.points };
    return { head: `Snapped — ${seconds(s.reactionMs)}`, points: s.points };
  });

  const myRank = $derived.by(() => {
    const list = room.standings ?? [];
    const at = list.findIndex((s) => s.id === room.meId);
    if (at < 0) return null;
    // Ties share the place of the first of them.
    return list.findIndex((s) => s.score === list[at].score) + 1;
  });

  function say(text: string) {
    toast = { text, key: ++toastSeq };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2400);
  }

  async function onSnap(e: PointerEvent) {
    // The moment of the tap, on the server's clock, before anything else.
    const at = Date.now() + skewMs;
    e.preventDefault();
    if (!canSnap || !r) return;
    const round = r.number;
    sentFor = round;
    navigator.vibrate?.(20);
    try {
      await playAct<WireRoom>(code, { action: 'snap', round, at });
    } catch (err) {
      if (sentFor === round) sentFor = null;
      say(err instanceof Error ? err.message : 'That did not go through.');
    }
  }
</script>

<div class="snp">
  {#if room.phase === 'lobby'}
    <section class="snp-centre">
      <p class="snp-kicker">Snap Happy</p>
      <p class="snp-lead">Waiting for the TV to start…</p>
      <p class="snp-lead snp-quiet">Watch the TV for the picture it names, then snap. Too early costs a point.</p>
    </section>
  {:else if room.phase === 'countdown'}
    <section class="snp-centre">
      <p class="snp-kicker">Get ready</p>
      <p class="snp-count">{Math.max(1, Math.ceil(remainingMs / 1000))}</p>
      <p class="snp-lead">Eyes on the TV.</p>
    </section>
  {:else if room.phase === 'armed' && r}
    <header class="snp-bar">
      <span class="snp-kicker">Round {r.number} of {room.rounds}</span>
      <span class="snp-score">{myScore} pts</span>
    </header>
    <div class="snp-target">
      <SnapPicture pic={r.target} size="64px" />
      <p class="snp-target-text"><span class="snp-kicker">Snap on</span>{targetLabel}</p>
    </div>
    <div class="snp-zone">
      <button
        type="button"
        class="snp-button"
        class:snp-wait={watching}
        class:snp-done={snappedNow}
        disabled={!canSnap}
        onpointerdown={onSnap}
        aria-label={canSnap ? `Snap on ${targetLabel}` : buttonLabel}
      >
        {buttonLabel}
      </button>
    </div>
  {:else if room.phase === 'result' && r}
    <section class="snp-centre">
      <p class="snp-kicker">Round {r.number} of {room.rounds} · it was {targetLabel}</p>
      <SnapPicture pic={r.target} size="96px" />
      {#if outcome}
        <p class="snp-head">{outcome.head}</p>
        <p class="snp-points" class:snp-points-bad={outcome.points < 0}>{signed(outcome.points)}</p>
      {/if}
      <p class="snp-lead">{myScore} points so far</p>
    </section>
  {:else if room.phase === 'finished'}
    <section class="snp-finish">
      <p class="snp-kicker">Game over</p>
      <h1 class="snp-title">
        {#if room.winnerIds.includes(room.meId)}You win{:else if myRank}{ordinal(myRank)}{:else}Finished{/if}
      </h1>
      <p class="snp-lead">{myScore} {myScore === 1 ? 'point' : 'points'}.</p>
      {#if room.standings?.length}
        <h2 class="snp-kicker snp-gap">Standings</h2>
        <ol class="snp-list">
          {#each room.standings as s, i (s.id)}
            <li class:snp-mine={s.id === room.meId}>
              <span>{i + 1}. {s.name}</span>
              <span>{s.bestMs !== null ? `best ${seconds(s.bestMs)} · ` : ''}{s.score}</span>
            </li>
          {/each}
        </ol>
      {/if}
      <p class="snp-lead snp-quiet">The TV takes everyone back to the lobby.</p>
    </section>
  {:else}
    <section class="snp-centre">
      <p class="snp-kicker">Snap Happy</p>
      <p class="snp-lead">This game has ended.</p>
    </section>
  {/if}

  {#if toast}
    {#key toast.key}
      <p class="snp-toast" role="status">{toast.text}</p>
    {/key}
  {/if}
</div>

<style>
  .snp {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: calc(100dvh - 120px);
    padding: 12px 0 24px;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
  }
  .snp-centre,
  .snp-finish {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .snp-centre {
    flex: 1;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .snp-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .snp-gap {
    margin-top: 12px;
  }
  .snp-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3rem;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .snp-count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .snp-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .snp-quiet {
    color: var(--on-ink-55);
  }
  .snp-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .snp-score {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--on-ink-70);
  }
  .snp-target {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .snp-target-text {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.4rem;
    line-height: 1.1;
  }
  .snp-zone {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 0;
  }
  .snp-button {
    width: min(92vw, 62dvh, 520px);
    aspect-ratio: 1;
    border: 0;
    border-radius: 100px;
    background: var(--accent);
    color: var(--chrome-ink);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: clamp(2.4rem, 14vw, 4.5rem);
    letter-spacing: -0.01em;
    text-transform: uppercase;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
    transition:
      transform 80ms ease-out,
      background-color 150ms ease;
  }
  .snp-button:not(:disabled):active {
    transform: scale(0.96);
  }
  .snp-button:disabled {
    cursor: default;
    background: var(--on-ink-08);
    color: var(--on-ink-55);
    font-size: clamp(1.4rem, 7vw, 2.2rem);
    text-transform: none;
  }
  .snp-button.snp-done:disabled {
    background: var(--accent-ink);
    color: var(--chrome-ink);
  }
  .snp-head {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
  }
  .snp-points {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 5rem;
    line-height: 1;
    color: var(--accent-on-dark);
    font-variant-numeric: tabular-nums;
  }
  .snp-points-bad {
    color: var(--on-ink-55);
  }
  .snp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .snp-list li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--on-ink-05);
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
  }
  .snp-list li.snp-mine {
    background: var(--on-ink-12);
  }
  .snp-toast {
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
    animation: snp-pop 180ms ease-out both;
  }
  @keyframes snp-pop {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .snp-button {
      transition: none;
    }
  }
</style>
