<script lang="ts">
  // Boggle on a phone at the TV: the board to trace, the clock, my words, and
  // at the finish where I came. Drives the same wire the app reads
  // (`toWire` in $lib/games/boggle) and posts the same move
  // (`{ action: 'word', word, path }`) through the party's act route.
  //
  // Tracing: press a tile and drag through touching tiles; dragging back onto
  // the tile before un-extends; lifting sends the word. Hit-testing is
  // `elementFromPoint` against a circle inside each tile, so a diagonal can
  // pass the corners of its neighbours without picking them up.
  import { onMount } from 'svelte';
  import type { WireRoom } from '$lib/games/boggle';
  import { playAct } from '../play-stream';

  let { code, room, skewMs }: { code: string; room: WireRoom; skewMs: number } = $props();

  let now = $state(Date.now());
  let path = $state<number[]>([]);
  let typed = $state('');
  let toast = $state<{ text: string; good: boolean; key: number } | null>(null);

  // Plain handles, never reactive (svelte5-pitfalls §1).
  let ticker: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let tracing = false;
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

  /** The tiles touching `i` — boggle.ts's `neighbours`, re-stated so its word lists stay out of the browser. */
  function touching(a: number, b: number, size: number): boolean {
    if (a === b) return false;
    const dr = Math.abs(Math.floor(a / size) - Math.floor(b / size));
    const dc = Math.abs((a % size) - (b % size));
    return dr <= 1 && dc <= 1;
  }

  const face = (f: string) => (f ? f[0].toUpperCase() + f.slice(1) : '');
  const grid = $derived(room.grid ?? []);
  const size = $derived(room.size);
  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const myWords = $derived([...(me?.words ?? [])].reverse());
  const myScore = $derived(me?.score ?? 0);
  const current = $derived(path.map((i) => grid[i] ?? '').join(''));
  const remainingMs = $derived(room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - (now + skewMs)) : 0);
  const clock = $derived.by(() => {
    const s = Math.ceil(remainingMs / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  const myRank = $derived.by(() => {
    const list = room.standings ?? [];
    const at = list.findIndex((s) => s.id === room.meId);
    if (at < 0) return null;
    // Ties share the place of the first of them.
    const first = list.findIndex((s) => s.score === list[at].score);
    return first + 1;
  });
  const ordinal = (n: number) => {
    const t = n % 100;
    if (t >= 11 && t <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };
  const centre = (i: number) => ({ x: (i % size) + 0.5, y: Math.floor(i / size) + 0.5 });
  const line = $derived(path.map((i) => centre(i)).map((p) => `${p.x},${p.y}`).join(' '));

  function say(text: string, good: boolean) {
    toast = { text, good, key: ++toastSeq };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), good ? 1200 : 2400);
  }

  async function send(word: string, tiles: number[] | null) {
    const w = word.trim().toLowerCase();
    if (!w) return;
    try {
      const out = await playAct<WireRoom>(code, tiles ? { action: 'word', word: w, path: tiles } : { action: 'word', word: w });
      const mine = out.players.find((p) => p.id === out.meId)?.words?.find((f) => f.word === w);
      say(`+${mine?.points ?? 0} ${w.toUpperCase()}`, true);
      navigator.vibrate?.(15);
    } catch (err) {
      say(err instanceof Error ? err.message : 'That did not go through.', false);
    }
  }

  /** The tile index under a point: the circle inside a tile (`strict`), or anywhere on it. */
  function tileAt(x: number, y: number, strict: boolean): number | null {
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest<HTMLElement>(strict ? '[data-hit]' : '[data-i]');
    if (!hit) return null;
    const raw = hit.dataset.hit ?? hit.dataset.i;
    const i = Number(raw);
    return Number.isInteger(i) ? i : null;
  }

  function onDown(e: PointerEvent) {
    if (room.phase !== 'playing' || !grid.length) return;
    const i = tileAt(e.clientX, e.clientY, false);
    if (i === null) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    tracing = true;
    path = [i];
  }

  function onMove(e: PointerEvent) {
    if (!tracing) return;
    const i = tileAt(e.clientX, e.clientY, true);
    if (i === null) return;
    const last = path[path.length - 1];
    if (i === last) return;
    if (path.length > 1 && i === path[path.length - 2]) {
      path = path.slice(0, -1);
      return;
    }
    if (!path.includes(i) && touching(last, i, size)) path = [...path, i];
  }

  function onUp() {
    if (!tracing) return;
    tracing = false;
    const tiles = path;
    const word = tiles.map((i) => grid[i] ?? '').join('');
    path = [];
    if (word.length >= room.minLength) void send(word, tiles);
    else if (tiles.length > 1) say(`Words need at least ${room.minLength} letters.`, false);
  }

  function onType(e: SubmitEvent) {
    e.preventDefault();
    const w = typed;
    typed = '';
    void send(w, null);
  }
</script>

<div class="bog">
  {#if room.phase === 'lobby'}
    <section class="bog-centre">
      <p class="bog-kicker">Kelloggle</p>
      <p class="bog-lead">Waiting for the TV to start…</p>
    </section>
  {:else if room.phase === 'countdown'}
    <section class="bog-centre">
      <p class="bog-kicker">Get ready</p>
      <p class="bog-count">{Math.max(1, Math.ceil(remainingMs / 1000))}</p>
      <p class="bog-lead">Trace words through touching tiles. {room.minLength}+ letters.</p>
    </section>
  {:else if room.phase === 'playing'}
    <header class="bog-bar">
      <span class="bog-clock" class:bog-late={remainingMs < 10_000}>{clock}</span>
      <span class="bog-score">{myScore} pts · {me?.wordCount ?? 0} words</span>
    </header>

    {#if room.kellyHint}
      <p class="bog-hint">
        Kelly word: {room.kellyHint.length} letters, starts with {room.kellyHint.first.toUpperCase()} — worth double
      </p>
    {/if}

    <p class="bog-current" aria-live="polite">{current ? current.toUpperCase() : ' '}</p>

    <div
      class="bog-board"
      style:--bog-size={size}
      role="application"
      aria-label="Letter grid: press and drag through touching tiles"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
    >
      {#each grid as f, i (i)}
        <div class="bog-tile" class:bog-on={path.includes(i)} class:bog-last={path[path.length - 1] === i} data-i={i}>
          <span class="bog-hit" data-hit={i}>{face(f)}</span>
        </div>
      {/each}
      {#if path.length > 1}
        <svg class="bog-path" viewBox="0 0 {size} {size}" aria-hidden="true">
          <polyline points={line} />
        </svg>
      {/if}
    </div>

    <form class="bog-type" onsubmit={onType}>
      <input
        class="bog-input"
        type="text"
        bind:value={typed}
        placeholder="Or type a word"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        enterkeyhint="send"
        maxlength="16"
      />
      <button class="bog-send" type="submit" disabled={!typed.trim()}>Send</button>
    </form>

    <h2 class="bog-kicker bog-gap">My words</h2>
    {#if myWords.length}
      <ul class="bog-words">
        {#each myWords as w (w.word)}
          <li><span>{w.word.toUpperCase()}</span><span>+{w.points}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="bog-lead bog-quiet">None yet.</p>
    {/if}
  {:else}
    <section class="bog-finish">
      <p class="bog-kicker">Time's up</p>
      <h1 class="bog-title">
        {#if room.winnerIds.includes(room.meId)}You win{:else if myRank}{ordinal(myRank)}{:else}Finished{/if}
      </h1>
      <p class="bog-lead">{myScore} points from {me?.words?.length ?? 0} words.</p>
      {#if room.kellyWord}
        <p class="bog-hint">The Kelly word was {room.kellyWord.toUpperCase()}.</p>
      {/if}

      {#if room.standings?.length}
        <h2 class="bog-kicker bog-gap">Standings</h2>
        <ol class="bog-words">
          {#each room.standings as s, i (s.id)}
            <li class:bog-mine={s.id === room.meId}>
              <span>{i + 1}. {s.name}</span><span>{s.score}</span>
            </li>
          {/each}
        </ol>
      {/if}

      {#if me?.words?.length}
        <h2 class="bog-kicker bog-gap">My words</h2>
        <ul class="bog-words">
          {#each me.words as w (w.word)}
            <li class:bog-crossed={w.points === 0}><span>{w.word.toUpperCase()}</span><span>{w.points ? `+${w.points}` : 'shared'}</span></li>
          {/each}
        </ul>
      {/if}
      <p class="bog-lead bog-quiet">The TV takes everyone back to the lobby.</p>
    </section>
  {/if}

  {#if toast}
    {#key toast.key}
      <p class="bog-toast" class:bog-good={toast.good} role="status">{toast.text}</p>
    {/key}
  {/if}
</div>

<style>
  .bog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 0 32px;
  }
  .bog-centre,
  .bog-finish {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .bog-centre {
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    text-align: center;
  }
  .bog-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .bog-gap {
    margin-top: 12px;
  }
  .bog-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3rem;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--chrome-ink);
  }
  .bog-count {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 6rem;
    line-height: 1;
    color: var(--accent-on-dark);
  }
  .bog-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .bog-quiet {
    color: var(--on-ink-55);
  }
  .bog-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .bog-clock {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2rem;
    color: var(--chrome-ink);
    font-variant-numeric: tabular-nums;
  }
  .bog-clock.bog-late {
    color: var(--accent-on-dark);
  }
  .bog-score {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--on-ink-70);
  }
  .bog-hint {
    margin: 0;
    padding: 8px 12px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .bog-current {
    margin: 0;
    min-height: 1.3em;
    text-align: center;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.75rem;
    letter-spacing: 0.04em;
    color: var(--accent-on-dark);
    white-space: pre;
  }
  .bog-board {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--bog-size), 1fr);
    gap: 6px;
    width: 100%;
    aspect-ratio: 1;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .bog-tile {
    display: grid;
    place-items: center;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
  }
  .bog-tile.bog-on {
    border-color: var(--accent-on-dark);
    background: var(--on-ink-16);
  }
  .bog-tile.bog-last {
    background: var(--accent);
    border-color: var(--accent);
  }
  .bog-hit {
    display: grid;
    place-items: center;
    width: 72%;
    aspect-ratio: 1;
    border-radius: 100px;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: calc(min(100vw, 520px) / var(--bog-size) * 0.42);
    color: var(--chrome-ink);
  }
  .bog-path {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .bog-path polyline {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 0.12;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.6;
  }
  .bog-type {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .bog-input {
    flex: 1;
    min-width: 0;
    padding: 12px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-size: var(--fs-body);
  }
  .bog-input:focus {
    outline: none;
    border-color: var(--accent-on-dark);
  }
  .bog-send {
    padding: 0 20px;
    border: 0;
    border-radius: 2px;
    background: var(--accent);
    color: var(--chrome-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .bog-send:disabled {
    opacity: 0.45;
  }
  .bog-words {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bog-words li {
    display: flex;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--on-ink-05);
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .bog-words li.bog-mine {
    background: var(--on-ink-12);
  }
  .bog-words li.bog-crossed span:first-child {
    text-decoration: line-through;
    color: var(--on-ink-55);
  }
  .bog-toast {
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
    animation: bog-pop 180ms ease-out both;
  }
  .bog-toast.bog-good {
    background: var(--accent-ink);
    color: var(--chrome-ink);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.25rem;
  }
  @keyframes bog-pop {
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
