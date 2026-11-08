<script lang="ts">
  // Quiz Night on a phone at the TV: the four answers to tap, the clock, then
  // whether I was right and, at the finish, where I came and every question
  // again. Drives the same wire the app reads (`toWire` in
  // $lib/games/quiz-night) and posts the same move
  // (`{ action: 'answer', question, choice }`) through the party's act route.
  //
  // The TV shows the question in full, so the prompt here is small and the
  // answers are the point. The phone never knows which answer is right until
  // the reveal: the wire holds `answerIndex` back while a question is open.
  import { onMount } from 'svelte';
  import type { WireRoom } from '$lib/games/quiz-night';
  import { playAct } from '../play-stream';

  let { code, room, skewMs }: { code: string; room: WireRoom; skewMs: number } = $props();

  let now = $state(Date.now());
  // The tap in flight, until the wire's `myChoice` catches up. Not server state:
  // it only bridges the round trip so the button answers at once.
  let sending = $state<{ question: number; choice: number } | null>(null);
  let toast = $state<{ text: string; key: number } | null>(null);

  // Plain handles, never reactive (svelte5-pitfalls §1).
  let ticker: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let toastSeq = 0;

  onMount(() => {
    ticker = setInterval(() => (now = Date.now()), 200);
    return () => {
      if (ticker) clearInterval(ticker);
      if (toastTimer) clearTimeout(toastTimer);
      ticker = null;
      toastTimer = null;
    };
  });

  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const letter = (i: number) => LETTERS[i] ?? String(i + 1);
  const ordinal = (n: number) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const playing = $derived(me?.status === 'joined');
  const joinedCount = $derived(room.players.filter((p) => p.status === 'joined').length);
  const q = $derived(room.question);
  const remainingMs = $derived(room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - (now + skewMs)) : 0);
  const secondsLeft = $derived(Math.ceil(remainingMs / 1000));
  const barFill = $derived(room.timeMs > 0 ? Math.min(1, remainingMs / room.timeMs) : 0);

  /** My answer to the open question: the server's, or the tap still on its way. */
  const locked = $derived.by(() => {
    if (!q) return null;
    if (q.myChoice !== null && q.myChoice !== undefined) return q.myChoice;
    if (sending && sending.question === q.index) return sending.choice;
    return null;
  });
  const myPick = $derived(q?.picks.find((p) => p.playerId === room.meId) ?? null);
  const answerLine = $derived(
    q && q.answerIndex !== null && q.options[q.answerIndex] !== undefined
      ? `It was ${letter(q.answerIndex)}: ${q.options[q.answerIndex]}`
      : null,
  );
  /** The quickest right answer in the room was mine. */
  const fastest = $derived.by(() => {
    if (!q || !myPick || myPick.points <= 0) return false;
    const others = q.picks.filter((p) => p.playerId !== room.meId && p.points > 0);
    return others.length > 0 && others.every((p) => p.points < myPick.points);
  });

  const header = $derived.by(() => {
    if (room.gcse) return [room.gcse.subjectLabel, room.gcse.boardLabel, room.gcse.tier].filter(Boolean).join(' · ');
    return room.title ?? room.topic ?? 'Quiz Night';
  });

  const myRank = $derived.by(() => {
    const list = room.standings ?? [];
    const at = list.findIndex((s) => s.id === room.meId);
    if (at < 0) return null;
    // Ties share the place of the first of them.
    return list.findIndex((s) => s.score === list[at].score) + 1;
  });
  const myStanding = $derived(room.standings?.find((s) => s.id === room.meId) ?? null);
  const iWon = $derived(room.winnerIds.includes(room.meId));

  function say(text: string) {
    toast = { text, key: ++toastSeq };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2600);
  }

  async function pick(choice: number) {
    if (!q || room.phase !== 'question' || !playing || locked !== null) return;
    const question = q.index;
    sending = { question, choice };
    navigator.vibrate?.(15);
    try {
      await playAct<WireRoom>(code, { action: 'answer', question, choice });
    } catch (err) {
      if (sending && sending.question === question) sending = null;
      say(err instanceof Error ? err.message : 'That did not go through. Try again.');
    }
  }

  /** How an option looks at the reveal: the right one, my wrong one, or neither. */
  function revealTone(i: number): 'right' | 'wrong' | null {
    if (!q || q.answerIndex === null) return null;
    if (i === q.answerIndex) return 'right';
    if (myPick && myPick.choice === i) return 'wrong';
    return null;
  }
</script>

<div class="qzp">
  {#if room.phase === 'lobby'}
    <section class="qzp-centre">
      <p class="qzp-kicker">Quiz Night</p>
      <h1 class="qzp-title">{header}</h1>
      {#if room.prep === 'writing'}
        <p class="qzp-lead">jkai is writing the questions…</p>
        <span class="qzp-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      {:else if room.prep === 'failed'}
        <p class="qzp-lead">{room.prepError ?? 'The questions could not be written.'}</p>
        <p class="qzp-lead qzp-quiet">Pick another quiz on the TV.</p>
      {:else}
        <p class="qzp-lead">Ready — the TV starts it.</p>
        <p class="qzp-lead qzp-quiet">
          {plural(room.questionCount, 'question', 'questions')}, {Math.round(room.timeMs / 1000)} seconds each.
        </p>
      {/if}
      {#if me && !playing}
        <p class="qzp-lead qzp-quiet">You are watching this one.</p>
      {/if}
    </section>
  {:else if room.phase === 'countdown'}
    <section class="qzp-centre">
      <p class="qzp-kicker">Get ready</p>
      <p class="qzp-count">{Math.max(1, secondsLeft)}</p>
      <p class="qzp-lead">Answer fast. Quicker right answers score more.</p>
    </section>
  {:else if (room.phase === 'question' || room.phase === 'reveal') && q}
    <header class="qzp-bar">
      <span class="qzp-kicker">Question {q.index + 1} of {room.questionCount}</span>
      <span class="qzp-score">{me?.score ?? 0} pts</span>
    </header>

    {#if room.phase === 'question'}
      <div class="qzp-time" class:qzp-late={secondsLeft <= 3} role="timer" aria-label="{secondsLeft} seconds left">
        <span class="qzp-time-fill" style:transform="scaleX({barFill})"></span>
      </div>
    {/if}

    {#if q.photo}
      <!-- Kelly's Quiz Night: the photo the question is about (a signed URL; also big on the TV). -->
      <img class="qzp-photo" src={q.photo} alt="" />
    {/if}
    <p class="qzp-prompt">{q.prompt}</p>

    {#if room.phase === 'question'}
      <div class="qzp-options">
        {#each q.options as option, i (i)}
          <button
            class="qzp-opt"
            class:qzp-picked={locked === i}
            class:qzp-dim={locked !== null && locked !== i}
            type="button"
            disabled={!playing || locked !== null}
            onclick={() => pick(i)}
          >
            <span class="qzp-letter">{letter(i)}</span>
            <span class="qzp-text">{option}</span>
          </button>
        {/each}
      </div>
      <p class="qzp-status" aria-live="polite">
        {#if !playing}
          You are watching this one.
        {:else if locked !== null}
          <strong>Locked in — {letter(locked)}</strong>
        {:else}
          {secondsLeft} seconds left.
        {/if}
        <span class="qzp-quiet">{q.answeredIds.length} of {joinedCount} answered</span>
      </p>
    {:else}
      {#if playing}
        <section
          class="qzp-verdict"
          class:qzp-right={!!myPick && myPick.points > 0}
          class:qzp-wrong={!!myPick && myPick.points === 0}
          aria-live="polite"
        >
          <div>
            <p class="qzp-verdict-head">
              {#if !myPick}No answer this time{:else if myPick.points > 0}Right{:else}Not this time{/if}
            </p>
            <p class="qzp-lead qzp-quiet">
              {#if myPick && myPick.points > 0}{fastest ? 'The quickest right answer.' : 'Nicely done.'}{:else}{answerLine ?? ''}{/if}
            </p>
          </div>
          {#if myPick && myPick.points > 0}
            <span class="qzp-gain">+{myPick.points}</span>
          {/if}
        </section>
      {:else if answerLine}
        <p class="qzp-verdict-head">{answerLine}</p>
      {/if}

      <ol class="qzp-reveal">
        {#each q.options as option, i (i)}
          {@const tone = revealTone(i)}
          <li class:qzp-is-right={tone === 'right'} class:qzp-is-wrong={tone === 'wrong'}>
            <span class="qzp-letter qzp-letter-sm">{letter(i)}</span>
            <span class="qzp-text">{option}</span>
            <span class="qzp-tag">
              {#if tone === 'right'}Answer{:else if tone === 'wrong'}Yours{/if}
            </span>
          </li>
        {/each}
      </ol>

      {#if q.explain}
        <p class="qzp-explain">{q.explain}</p>
      {/if}
      <p class="qzp-lead qzp-quiet">
        {q.index + 1 >= room.questionCount ? 'Final scores next.' : 'Next question in a moment.'}
      </p>
    {/if}
  {:else if room.phase === 'finished'}
    <section class="qzp-finish">
      <p class="qzp-kicker">Quiz over</p>
      <h1 class="qzp-title">
        {#if iWon}You win{:else if myRank}{ordinal(myRank)}{:else}Finished{/if}
      </h1>
      {#if myStanding}
        <p class="qzp-lead">
          {myStanding.score} points. {myStanding.correct} of {room.questionCount} right{#if room.standings && room.standings.length > 1}, {ordinal(myRank ?? 1)} of {room.standings.length}{/if}.
        </p>
      {/if}

      {#if room.standings?.length}
        <h2 class="qzp-kicker qzp-gap">Standings</h2>
        <ol class="qzp-rows">
          {#each room.standings as s, i (s.id)}
            <li class:qzp-mine={s.id === room.meId}>
              <span>{i + 1}. {s.name}</span>
              <span>{s.score} · {s.correct}/{room.questionCount}</span>
            </li>
          {/each}
        </ol>
      {/if}

      {#if room.review?.length}
        <h2 class="qzp-kicker qzp-gap">The questions</h2>
        <ol class="qzp-review">
          {#each room.review as item (item.index)}
            {@const right = item.myChoice !== null && item.myChoice === item.answerIndex}
            <li class:qzp-is-right={right} class:qzp-is-wrong={item.myChoice !== null && !right}>
              <p class="qzp-review-q">Q{item.index + 1}. {item.prompt}</p>
              <p class="qzp-review-a">Answer: {letter(item.answerIndex)}. {item.options[item.answerIndex] ?? ''}</p>
              {#if item.myChoice !== null && !right}
                <p class="qzp-review-me">You said {letter(item.myChoice)}. {item.options[item.myChoice] ?? ''}</p>
              {:else if item.myChoice === null && playing}
                <p class="qzp-review-me">No answer.</p>
              {/if}
              {#if item.explain}
                <p class="qzp-review-why">{item.explain}</p>
              {/if}
              <p class="qzp-review-count">
                {item.rightCount} of {item.playerCount} got it{#if item.topic} · {item.topic}{/if}
              </p>
            </li>
          {/each}
        </ol>
      {/if}
      <p class="qzp-lead qzp-quiet">The TV takes everyone back to the lobby.</p>
    </section>
  {:else}
    <section class="qzp-centre">
      <p class="qzp-kicker">Quiz Night</p>
      <p class="qzp-lead">This quiz has ended. Watch the TV.</p>
    </section>
  {/if}

  {#if toast}
    {#key toast.key}
      <p class="qzp-toast" role="status">{toast.text}</p>
    {/key}
  {/if}
</div>

<style>
  .qzp {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 0 32px;
  }
  .qzp-centre,
  .qzp-finish {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .qzp-centre {
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
  }
  .qzp-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .qzp-gap {
    margin-top: 12px;
  }
  .qzp-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.5rem;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--chrome-ink);
    overflow-wrap: anywhere;
  }
  .qzp-count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .qzp-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .qzp-quiet {
    color: var(--on-ink-55);
  }
  .qzp-dots {
    display: inline-flex;
    gap: 8px;
  }
  .qzp-dots i {
    width: 10px;
    height: 10px;
    border-radius: 100px;
    background: var(--accent-on-dark);
    animation: qzp-blink 1.2s ease-in-out infinite both;
  }
  .qzp-dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .qzp-dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes qzp-blink {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
    }
  }
  .qzp-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .qzp-score {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--on-ink-70);
    font-variant-numeric: tabular-nums;
  }
  .qzp-time {
    height: 8px;
    border-radius: 100px;
    background: var(--on-ink-12);
    overflow: hidden;
  }
  .qzp-time-fill {
    display: block;
    height: 100%;
    background: var(--accent-on-dark);
    transform-origin: left center;
    transition: transform 200ms linear;
  }
  .qzp-time.qzp-late .qzp-time-fill {
    background: var(--error);
  }
  .qzp-photo {
    width: 100%;
    max-height: 30vh;
    object-fit: contain;
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .qzp-prompt {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 1.4;
    color: var(--on-ink-80);
  }
  .qzp-options {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .qzp-opt {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 84px;
    padding: 12px 16px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
    color: var(--chrome-ink);
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      opacity 150ms ease,
      background 150ms ease;
  }
  .qzp-opt:active:not(:disabled) {
    background: var(--on-ink-16);
  }
  .qzp-opt:disabled {
    cursor: default;
  }
  .qzp-opt.qzp-picked {
    border-color: var(--accent);
    background: var(--accent);
  }
  .qzp-opt.qzp-dim {
    opacity: 0.35;
  }
  .qzp-letter {
    flex: none;
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 2px;
    background: var(--on-ink-12);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
    line-height: 1;
    color: var(--chrome-ink);
  }
  .qzp-picked .qzp-letter {
    background: var(--chrome-ink);
    color: var(--accent);
  }
  .qzp-letter-sm {
    width: 36px;
    height: 36px;
    font-size: 1.125rem;
  }
  .qzp-text {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .qzp-status {
    margin: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--on-ink-80);
  }
  .qzp-status strong {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.125rem;
    color: var(--accent-on-dark);
  }
  .qzp-verdict {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .qzp-verdict.qzp-right {
    border-color: var(--success);
  }
  .qzp-verdict.qzp-wrong {
    border-color: var(--error);
  }
  .qzp-verdict > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .qzp-verdict-head {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
    line-height: 1.1;
    color: var(--chrome-ink);
  }
  .qzp-gain {
    flex: none;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
    color: var(--success);
    font-variant-numeric: tabular-nums;
  }
  .qzp-reveal {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .qzp-reveal li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-left: 2px solid transparent;
    background: var(--on-ink-05);
    color: var(--on-ink-55);
  }
  .qzp-reveal li .qzp-text {
    font-size: var(--fs-body);
  }
  .qzp-reveal li.qzp-is-right {
    border-left-color: var(--success);
    background: var(--on-ink-12);
    color: var(--chrome-ink);
  }
  .qzp-reveal li.qzp-is-wrong {
    border-left-color: var(--error);
    color: var(--on-ink-80);
  }
  .qzp-tag {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .qzp-is-right .qzp-tag {
    color: var(--success);
  }
  .qzp-is-wrong .qzp-tag {
    color: var(--error);
  }
  .qzp-explain {
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--chrome-ink);
  }
  .qzp-rows,
  .qzp-review {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .qzp-rows li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--on-ink-05);
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .qzp-rows li.qzp-mine {
    background: var(--on-ink-12);
  }
  .qzp-review li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-left: 2px solid var(--on-ink-30);
    background: var(--on-ink-05);
  }
  .qzp-review li.qzp-is-right {
    border-left-color: var(--success);
  }
  .qzp-review li.qzp-is-wrong {
    border-left-color: var(--error);
  }
  .qzp-review p {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.4;
  }
  .qzp-review-q {
    color: var(--chrome-ink);
  }
  .qzp-review-a {
    color: var(--chrome-ink);
    font-weight: 600;
  }
  .qzp-review-me {
    color: var(--on-ink-80);
  }
  .qzp-review-why {
    color: var(--on-ink-70);
  }
  .qzp-review .qzp-review-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--on-ink-55);
  }
  .qzp-toast {
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
    animation: qzp-pop 180ms ease-out both;
  }
  @keyframes qzp-pop {
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
    .qzp-time-fill,
    .qzp-opt {
      transition: none;
    }
    .qzp-dots i,
    .qzp-toast {
      animation: none;
    }
  }
</style>
