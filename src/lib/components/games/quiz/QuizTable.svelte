<script lang="ts">
  // Quiz Night on the TV: the question large with its four answers in a
  // two-by-two of lettered blocks, the clock draining under it, and the
  // scoreboard beside it — each name ticking as they answer (never what), the
  // reveal lifting the right answer, naming who picked each, and re-ordering
  // the scores. Drawn from the room's `toScreen` wire alone.
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import QuizScoreRow from './QuizScoreRow.svelte';
  import type { WireRoom } from '$lib/games/quiz-night';

  let { room, skewMs = 0 }: { room: WireRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(t);
  });

  const LETTERS = ['A', 'B', 'C', 'D'];
  const serverNow = $derived(now + skewMs);
  const q = $derived(room.question);
  const open = $derived(room.phase === 'question');
  const revealed = $derived(room.phase === 'reveal' && !!q && q.answerIndex !== null);
  const playing = $derived(room.players.filter((p) => p.status === 'joined'));
  const answered = $derived(new Set(q?.answeredIds ?? []));
  const gained = $derived(new Map((revealed ? q?.picks ?? [] : []).map((p) => [p.playerId, p.points])));
  const board = $derived([...playing].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)));
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? '?';
  const pickersOf = (choice: number) => (revealed ? (q?.picks ?? []).filter((p) => p.choice === choice) : []);

  const left = $derived.by(() => {
    if (!open || room.phaseEndsAt === null) return null;
    return Math.max(0, Math.min(1, (room.phaseEndsAt - serverNow) / room.timeMs));
  });
  const secondsLeft = $derived(room.phaseEndsAt === null ? null : Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)));

  const heading = $derived(room.gcse ? `${room.gcse.subjectLabel}${room.gcse.boardLabel ? ` · ${room.gcse.boardLabel}` : ''}` : (room.title ?? 'Quiz Night'));
  const headline = $derived.by(() => {
    switch (room.phase) {
      case 'lobby':
        return room.prep === 'writing' ? 'jkai is writing the questions' : room.prep === 'failed' ? 'The questions could not be written' : 'Ready when the host is';
      case 'countdown':
        return 'Get ready';
      case 'question':
        return `Question ${room.question ? room.question.index + 1 : ''} of ${room.questionCount}`;
      case 'reveal':
        return revealed && q ? `${q.options[q.answerIndex!]}` : 'The answer';
      case 'finished': {
        const names = room.winnerIds.map(nameOf);
        return names.length > 1 ? `${names.join(' and ')} share it` : names.length ? `${names[0]} wins` : 'Game over';
      }
      default:
        return 'This quiz has ended';
    }
  });
  const podium = $derived(room.standings?.slice(0, 3) ?? []);
</script>

<div class="quiz">
  <header class="top">
    <span class="gb-brand"><span class="mark">sr.</span> {room.pack ? 'kelly’s quiz night' : 'quiz night'}</span>
    <span class="about">{heading}</span>
    {#key headline}
      <h1 in:fly={{ y: -12, duration: 380 }}>{headline}</h1>
    {/key}
    <span class="meta">
      {#if room.gcse}<span>{room.gcse.band}</span>{/if}
      {#if open && secondsLeft !== null}<span class="tabnum">{secondsLeft}s</span>{/if}
    </span>
  </header>

  <div class="body">
    <main class="stagearea">
      {#if room.phase === 'lobby'}
        <div class="lobby" in:fade>
          <p class="kicker">Tonight’s quiz</p>
          <p class="title">{room.title ?? (room.topic ? room.topic : 'jkai picks the topic')}</p>
          {#if room.prep === 'writing'}
            <div class="writing" aria-label="Writing">
              {#each [0, 1, 2] as i (i)}<span style:animation-delay="{i * 180}ms"></span>{/each}
            </div>
            <p class="note">The questions are being written. The host starts once they are ready.</p>
          {:else if room.prep === 'failed'}
            <p class="note bad">{room.prepError ?? 'Try another topic from a phone.'}</p>
          {:else}
            <p class="note">{room.questionCount} questions, {Math.round(room.timeMs / 1000)} seconds each. Faster right answers score more.</p>
          {/if}
        </div>
      {:else if room.phase === 'countdown'}
        <div class="countdown">
          {#key secondsLeft}
            <span in:scale={{ start: 1.6, duration: 600, easing: cubicOut }}>{secondsLeft ?? ''}</span>
          {/key}
        </div>
      {:else if (room.phase === 'question' || room.phase === 'reveal') && q}
        {#key q.index}
          <div class="question" class:qn-has-photo={!!q.photo} in:fly={{ y: 40, duration: 520, easing: cubicOut }}>
            {#if q.photo}
              <!-- Kelly's Quiz Night: the pack photo the question is about (a signed URL). -->
              <img class="qn-photo" src={q.photo} alt="" in:fade={{ duration: 500 }} />
            {/if}
            <div class="qn-main">
            <p class="prompt">{q.prompt}</p>
            <div class="clock" aria-hidden="true">
              <span class="drain" class:low={left !== null && left < 0.25} style:transform="scaleX({open ? (left ?? 0) : 0})"></span>
            </div>
            <div class="options">
              {#each q.options as option, i (i)}
                <div
                  class="option o{i}"
                  class:right={revealed && q.answerIndex === i}
                  class:wrong={revealed && q.answerIndex !== i}
                  in:fly={{ y: 24, duration: 420, delay: 160 + i * 90, easing: cubicOut }}
                >
                  <span class="letter">{LETTERS[i]}</span>
                  <span class="text">{option}</span>
                  {#if revealed}
                    <span class="pickers">
                      {#each pickersOf(i) as p (p.playerId)}
                        <span class="picker" in:fly={{ y: 10, duration: 300, delay: 500 }}>{nameOf(p.playerId)}</span>
                      {/each}
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
            {#if revealed && q.explain}
              <p class="explain" in:fade={{ delay: 700, duration: 400 }}>{q.explain}</p>
            {/if}
            </div>
          </div>
        {/key}
      {:else if room.phase === 'finished'}
        <div class="final" in:fade>
          <div class="podium">
            {#each podium as s, i (s.id)}
              <div class="step p{i + 1}" in:fly={{ y: 60, duration: 640, delay: (podium.length - i) * 260, easing: cubicOut }}>
                <span class="pname">{s.name}</span>
                <span class="pscore">{s.score}</span>
                <span class="pblock"><span>{i + 1}</span></span>
              </div>
            {/each}
          </div>
          <p class="note">The host can start a new quiz from their phone.</p>
        </div>
      {/if}
    </main>

    <aside class="scores">
      <p class="kicker">{room.phase === 'lobby' ? 'At the table' : 'Scores'}</p>
      <div class="list">
        {#each board as p, i (p.id)}
          <div animate:flip={{ duration: 600, easing: cubicOut }} in:fly={{ x: 30, duration: 360 }}>
            <QuizScoreRow
              name={p.name}
              score={p.score}
              place={i + 1}
              ticking={open}
              answered={open && answered.has(p.id)}
              gained={revealed ? (gained.get(p.id) ?? 0) : null}
              leading={room.phase !== 'lobby' && i === 0 && p.score > 0}
            />
          </div>
        {/each}
        {#each room.players.filter((p) => p.status === 'invited') as p (p.id)}
          <p class="asked">{p.name} · asked</p>
        {/each}
      </div>
      {#if open}
        <p class="tally">{answered.size} of {playing.length} answered</p>
      {/if}
    </aside>
  </div>
</div>

<style>
  .quiz {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 1.6cqw 2cqw 1.6cqw;
    gap: 1.4cqw;
    font-family: var(--font-body);
  }
  .top {
    display: flex;
    align-items: baseline;
    gap: 1.6cqw;
    border-bottom: 1px solid var(--on-ink-14);
    padding-bottom: 0.9cqw;
    min-width: 0;
  }
  .gb-brand,
  .about {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    white-space: nowrap;
  }
  .about {
    max-width: 22cqw;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--on-ink-80);
  }
  .mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    flex: 1;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.3cqw;
    letter-spacing: -0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    gap: 1.2cqw;
    font-family: var(--font-mono);
    font-size: 1cqw;
    color: var(--on-ink-55);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .tabnum {
    text-transform: none;
    font-variant-numeric: tabular-nums;
    font-size: 1.8cqw;
    color: var(--chrome-ink);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 26cqw;
    gap: 2.2cqw;
    min-height: 0;
  }
  .stagearea {
    position: relative;
    display: grid;
    align-items: center;
    min-width: 0;
  }
  .kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .lobby .title {
    margin: 1cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 5cqw;
    line-height: 1.02;
    letter-spacing: -0.02em;
  }
  .note {
    margin: 1.6cqw 0 0;
    font-size: 1.5cqw;
    color: var(--on-ink-80);
    max-width: 50cqw;
  }
  .note.bad {
    color: var(--error);
  }
  .writing {
    display: flex;
    gap: 0.8cqw;
    margin-top: 2cqw;
  }
  .writing span {
    width: 1.2cqw;
    height: 1.2cqw;
    border-radius: 100px;
    background: var(--accent-on-dark);
    animation: bob 1.1s ease-in-out infinite;
  }
  .countdown {
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 18cqw;
    color: var(--accent-on-dark);
  }
  .question {
    display: grid;
    gap: 1.4cqw;
  }
  .prompt {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3.1cqw;
    line-height: 1.12;
    letter-spacing: -0.012em;
    text-wrap: balance;
  }
  .clock {
    height: 0.5cqw;
    border-radius: 100px;
    background: var(--on-ink-08);
    overflow: hidden;
  }
  .drain {
    display: block;
    height: 100%;
    background: var(--accent-on-dark);
    transform-origin: left center;
    transition: transform 250ms linear, background-color 300ms ease;
  }
  .drain.low {
    background: var(--error);
  }
  .options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.1cqw;
  }
  .option {
    --face: #1f4f8f;
    position: relative;
    display: grid;
    grid-template-columns: 3.6cqw minmax(0, 1fr) auto;
    align-items: center;
    gap: 1.2cqw;
    min-height: 7.4cqw;
    padding: 1cqw 1.4cqw;
    border-radius: 4px;
    background: var(--face);
    color: #f6efe3;
    transition:
      opacity 500ms ease,
      transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1.2),
      filter 500ms ease;
  }
  /* Azul's glazes: the family's colours are the same everywhere on the TV. */
  .o1 {
    --face: #b07d14;
  }
  .o2 {
    --face: #b4472c;
  }
  .o3 {
    --face: #4f6b33;
  }
  .letter {
    display: grid;
    place-items: center;
    width: 3.6cqw;
    height: 3.6cqw;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.22);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
  }
  .text {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.1cqw;
    line-height: 1.12;
  }
  .option.wrong {
    opacity: 0.28;
    filter: saturate(0.4);
    transform: scale(0.97);
  }
  .option.right {
    transform: scale(1.03);
    outline: 0.3cqw solid var(--chrome-ink);
    outline-offset: 0.3cqw;
  }
  .pickers {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.4cqw;
    max-width: 16cqw;
  }
  .picker {
    padding: 0.15cqw 0.6cqw;
    border-radius: 2px;
    background: var(--chrome-ink);
    color: var(--chrome-bg);
    font-family: var(--font-mono);
    font-size: 0.95cqw;
  }
  .explain {
    margin: 1cqw 0 0;
    font-size: 1.5cqw;
    line-height: 1.4;
    color: var(--on-ink-80);
  }
  .scores {
    display: flex;
    flex-direction: column;
    gap: 1cqw;
    min-height: 0;
  }
  .list {
    display: grid;
    gap: 0.8cqw;
  }
  .asked {
    margin: 0;
    font-size: 1.3cqw;
    color: var(--on-ink-45);
  }
  .tally {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .final {
    display: grid;
    gap: 2cqw;
    justify-items: center;
  }
  .podium {
    display: flex;
    align-items: flex-end;
    gap: 1.4cqw;
  }
  .step {
    display: grid;
    justify-items: center;
    gap: 0.6cqw;
    width: 14cqw;
  }
  .p1 {
    order: 2;
  }
  .p2 {
    order: 1;
  }
  .p3 {
    order: 3;
  }
  .pname {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.2cqw;
    text-align: center;
  }
  .pscore {
    font-family: var(--font-mono);
    font-size: 1.3cqw;
    color: var(--on-ink-80);
  }
  .pblock {
    display: grid;
    place-items: start center;
    width: 100%;
    padding-top: 1cqw;
    border-radius: 4px 4px 0 0;
    background: var(--on-ink-08);
    border: 1px solid var(--on-ink-16);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3cqw;
    color: var(--on-ink-55);
  }
  .p1 .pblock {
    height: 16cqw;
    border-color: var(--accent-on-dark);
    color: var(--accent-on-dark);
  }
  .p2 .pblock {
    height: 11cqw;
  }
  .p3 .pblock {
    height: 7cqw;
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    50% {
      transform: translateY(-0.8cqw);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .writing span {
      animation: none;
    }
    .drain {
      transition: none;
    }
  }
  /* Kelly's Quiz Night: a photo beside the question. */
  .qn-has-photo {
    display: grid;
    grid-template-columns: 40% 1fr;
    gap: 2.4cqw;
    align-items: center;
  }
  .qn-photo {
    width: 100%;
    max-height: 30cqw;
    object-fit: contain;
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .qn-main {
    min-width: 0;
    display: grid;
    gap: 1.4cqw;
  }
</style>
