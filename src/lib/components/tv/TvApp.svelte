<script lang="ts">
  // sr. tv on a linked TV: the menu of games, the party's lobby (QR, who is
  // in, the game's options, Start) and, once a game runs, its TV board. One
  // stream (`tv-stream` openTv) carries the party and the room; the TV's
  // verbs are POSTs (`tvParty`). Driven by the remote (`focus` remote).
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import TvStage from './TvStage.svelte';
  import { focusFirst, remote } from './focus';
  import { openTv, tvParty, type TvState } from './tv-stream';
  import { DIFFICULTY, GAME_OPTIONS, GAME_BLURBS, defaultOptions, type TvOption } from './tv-games';
  import { STING, hostLine } from '$lib/games/kelly';
  import BoggleTable from '$lib/components/games/boggle/BoggleTable.svelte';
  import AzulTable from '$lib/components/games/azul/AzulTable.svelte';
  import QuizTable from '$lib/components/games/quiz/QuizTable.svelte';
  import CodenamesTable from '$lib/components/games/codenames/CodenamesTable.svelte';
  import type { AzulRoom } from '$lib/components/games/azul/motion';
  import type { WireRoom as QuizRoom } from '$lib/games/quiz-night';
  import type { WireRoom as CodenamesRoom } from '$lib/games/codenames';
  import type { PartyView } from '$lib/games/party';
  import type { PackSummary } from '$lib/games/quiz-packs';
  import type { ScreenRoom as BoggleRoom } from '$lib/games/boggle';

  let { tvName, family = [], packs = [] }: { tvName: string; family?: string[]; packs?: PackSummary[] } = $props();

  type View = 'menu' | 'lobby' | 'about';
  type Sheet = null | { kind: 'end' } | { kind: 'kick'; id: string; name: string };

  let link = $state<TvState>({ kind: 'connecting' });
  let view = $state<View>('menu');
  let sheet = $state<Sheet>(null);
  let qr = $state<string | null>(null);
  let joinUrl = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  // Plain handles (svelte5-pitfalls §1).
  let qrFor: string | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  const party = $derived<PartyView | null>(link.kind === 'party' ? link.party : null);
  const room = $derived(link.kind === 'party' ? link.room : null);
  const skewMs = $derived(link.kind === 'party' ? link.skewMs : 0);
  const playing = $derived(!!party?.roomId && !!room);
  const roomPhase = $derived((room as { phase?: string } | null)?.phase ?? null);
  // Quiz Night's questions are still being written: Go waits for them.
  const writing = $derived((room as { prep?: string } | null)?.prep === 'writing');
  const current = $derived(party?.games.find((g) => g.id === party?.game) ?? null);
  const seed = $derived(party ? party.code.charCodeAt(0) + party.code.charCodeAt(3) : 0);
  const greeting = $derived.by(() => {
    if (!party) return '';
    if (family.length && party.members.length === 0) return `Right then — ${family[seed % family.length]}, grab a phone and scan the code.`;
    return hostLine('lobby', seed);
  });

  function say(message: string) {
    error = message;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => (error = null), 5_000);
  }

  async function send(body: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      const out = await tvParty(body);
      qr = out.qr;
      joinUrl = out.joinUrl;
      qrFor = out.party.code;
      return true;
    } catch (err) {
      say((err as Error).message);
      return false;
    } finally {
      busy = false;
    }
  }

  async function refreshQr(code: string) {
    if (qrFor === code) return;
    qrFor = code;
    try {
      const out = await tvParty();
      qr = out.qr;
      joinUrl = out.joinUrl;
    } catch {
      qrFor = null;
    }
  }

  async function go(next: View) {
    view = next;
    sheet = null;
    await tick();
    focusFirst(true);
  }

  async function pick(game: string) {
    // Quiz Night from its own tile is jkai's quiz: a pack chosen before is dropped.
    const same = party?.game === game && !(game === 'quiz-night' && party.options.pack);
    if (await send({ action: 'pick', game, options: same ? party!.options : defaultOptions(game) })) void go('lobby');
  }

  /** Kelly's Quiz Night: Quiz Night playing one of John's approved packs. */
  async function pickKelly() {
    const keep = party?.game === 'quiz-night' && packs.some((p) => p.id === party?.options.pack);
    const options = keep ? party!.options : { pack: packs[0].id, difficulty: 'medium' };
    if (await send({ action: 'pick', game: 'quiz-night', options })) void go('lobby');
  }

  const kelly = $derived(party?.game === 'quiz-night' && typeof party.options.pack === 'string');
  const lobbyTitle = $derived(kelly ? 'Kelly’s Quiz Night' : (current?.title ?? 'Pick a game'));
  /** The lobby's choices: a pack and the pace for Kelly's Quiz Night, else the game's own. */
  const lobbyOptions = $derived.by((): TvOption[] => {
    if (!party?.game) return [];
    if (!kelly) return GAME_OPTIONS[party.game] ?? [];
    const pack: TvOption = { key: 'pack', label: 'Pack', fallback: packs[0]?.id ?? '', choices: packs.map((p) => ({ value: p.id, label: p.title })) };
    return [pack, { ...DIFFICULTY, label: 'Time to answer', choices: [{ value: 'easy', label: 'Relaxed' }, { value: 'medium', label: 'Normal' }, { value: 'hard', label: 'Quick' }] }];
  });

  function setOption(key: string, value: string | number) {
    if (!party?.game) return;
    void send({ action: 'pick', game: party.game, options: { ...party.options, [key]: value } });
  }

  async function startGame() {
    await send({ action: 'start' });
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    sheet = null;
    await send({ action, ...extra });
    await tick();
    focusFirst(true);
  }

  async function openSheet(next: Sheet) {
    sheet = next;
    await tick();
    focusFirst(true);
  }

  /** A strip of controls that appears over a board takes the remote's focus. */
  function grabFocus(node: HTMLElement) {
    queueMicrotask(() => node.querySelector<HTMLElement>('[data-tv]')?.focus());
  }

  function back(): boolean {
    if (sheet) {
      sheet = null;
      void tick().then(() => focusFirst(true));
      return true;
    }
    if (playing) {
      void openSheet({ kind: 'end' });
      return true;
    }
    if (view !== 'menu') {
      void go('menu');
      return true;
    }
    return false;
  }

  onMount(() => {
    const close = openTv((s) => {
      const wasPlaying = link.kind === 'party' && !!link.party.roomId;
      const first = link.kind !== 'party';
      link = s;
      // The menu's first tile takes focus as soon as there is a menu, so the remote's first OK picks it.
      if (first && s.kind === 'party') void tick().then(() => focusFirst(true));
      if (s.kind === 'unlinked') location.reload();
      if (s.kind === 'party') {
        void refreshQr(s.party.code);
        const nowPlaying = !!s.party.roomId;
        // A game ending (or one started elsewhere) moves focus to whatever is now on screen.
        if (wasPlaying !== nowPlaying) {
          if (!nowPlaying) view = 'lobby';
          void tick().then(() => focusFirst(true));
        }
      }
    });
    const stopRemote = remote(back);
    return () => {
      close();
      stopRemote();
      if (errorTimer) clearTimeout(errorTimer);
    };
  });
</script>

<TvStage>
  {#if !party}
    <div class="tv-center" in:fade>
      <p class="tv-brand"><span class="tv-mark">sr.</span> tv</p>
      <p class="tv-lead">Opening the games…</p>
    </div>
  {:else if playing}
    <div class="tv-fill" in:fade={{ duration: 300 }}>
      {#if party.game === 'boggle'}
        <BoggleTable room={room as BoggleRoom} {skewMs} />
      {:else if party.game === 'quiz-night'}
        <QuizTable room={room as QuizRoom} {skewMs} />
      {:else if party.game === 'codenames'}
        <CodenamesTable room={room as CodenamesRoom} {skewMs} />
      {:else if party.game === 'azul'}
        <AzulTable room={room as AzulRoom} {skewMs} />
      {/if}
    </div>
    {#if roomPhase === 'lobby' && !sheet}
      <div class="tv-strip" in:fly={{ y: 40, duration: 300 }} use:grabFocus>
        <button type="button" class="tv-primary" data-tv data-tv-first onclick={() => act('go')} disabled={writing}>{writing ? 'Writing the questions…' : 'Start the game'}</button>
        <button type="button" data-tv onclick={() => act('end')}>Back to the lobby</button>
      </div>
    {:else if roomPhase === 'finished' && !sheet}
      <div class="tv-strip" in:fly={{ y: 40, duration: 300 }} use:grabFocus>
        <button type="button" data-tv data-tv-first onclick={() => act('again')}>Play again</button>
        <button type="button" data-tv onclick={() => act('end')}>Back to the lobby</button>
      </div>
    {/if}
  {:else if view === 'menu'}
    <section class="tv-menu" in:fade={{ duration: 250 }}>
      <header class="tv-top">
        <p class="tv-brand"><span class="tv-mark">sr.</span> tv · {tvName}</p>
        <h1>What are we playing?</h1>
        <p class="tv-lead">{greeting}</p>
      </header>
      <div class="tv-tiles">
        {#each party.games as g, i (g.id)}
          <button type="button" class="tv-tile" data-tv data-tv-first={i === 0 ? '' : undefined} onclick={() => pick(g.id)}>
            <span class="tv-tile-name">{g.title}</span>
            <span class="tv-tile-blurb">{GAME_BLURBS[g.id] ?? ''}</span>
            <span class="tv-tile-meta">{g.min === g.max ? g.min : `${g.min}–${g.max}`} players</span>
          </button>
        {/each}
        {#if packs.length}
          <button type="button" class="tv-tile tv-tile-kelly" data-tv onclick={pickKelly}>
            <span class="tv-tile-name">Kelly’s Quiz Night</span>
            <span class="tv-tile-blurb">Questions about us — old photos, holidays and the stories we keep telling.</span>
            <span class="tv-tile-meta">{packs.length} {packs.length === 1 ? 'pack' : 'packs'} · 1–8 players</span>
          </button>
        {/if}
        <button type="button" class="tv-tile tv-tile-quiet" data-tv onclick={() => go('about')}>
          <span class="tv-tile-name">About</span>
          <span class="tv-tile-blurb">What this is, and who made it.</span>
          <span class="tv-tile-meta">strangeramblings.com</span>
        </button>
      </div>
      <p class="tv-sting">{STING}</p>
    </section>
  {:else if view === 'about'}
    <section class="tv-about" in:fade={{ duration: 250 }}>
      <p class="tv-brand"><span class="tv-mark">sr.</span> strangeramblings.com</p>
      <h1>I built a games console. Sort of.</h1>
      <p class="tv-prose">
        strangeramblings.com is my site - I write on it, build things on it and occasionally break things on it, and
        these games are the part the family actually asked for. The idea is simple enough, one big screen in the
        living room and everybody's phone as the controller, so nobody has to install anything to join in.
      </p>
      <p class="tv-prose">
        Scan the code on the lobby screen and you're in. If you've got the sr. app on your iPhone it opens there,
        and if you haven't your phone's browser does the job just as well - I made them all in Darlington, for the Kellys and
        whoever turns up.
      </p>
      <button type="button" data-tv data-tv-first onclick={() => go('menu')}>Back to the games</button>
    </section>
  {:else}
    <section class="tv-lobby" in:fade={{ duration: 250 }}>
      <div class="tv-join">
        {#if qr}
          <img class="tv-qr" src={qr} alt="Scan to join" />
        {:else}
          <div class="tv-qr tv-qr-wait"></div>
        {/if}
        <p class="tv-join-code" aria-label="Code {party.code.split('').join(' ')}">{party.code}</p>
        <p class="tv-join-url">{joinUrl.replace(/^https?:\/\//u, '') || `strangeramblings.com${party.joinPath}`}</p>
        {#if party.locked}<p class="tv-locked">Locked — nobody new can join</p>{/if}
      </div>

      <div class="tv-side">
        <p class="tv-brand"><span class="tv-mark">sr.</span> tv · {tvName}</p>
        <h1>{lobbyTitle}</h1>
        <p class="tv-lead">{greeting}</p>

        {#if lobbyOptions.length}
          <div class="tv-options">
            {#each lobbyOptions as opt (opt.key)}
              <div class="tv-option">
                <span class="tv-label">{opt.label}</span>
                <div class="tv-choices">
                  {#each opt.choices as c (c.value)}
                    <button
                      type="button"
                      class="tv-choice"
                      class:tv-on={(party.options[opt.key] ?? opt.fallback) === c.value}
                      data-tv
                      onclick={() => setOption(opt.key, c.value)}>{c.label}</button
                    >
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div class="tv-members">
          <span class="tv-label">At the table · {party.members.length}{current ? ` of ${current.max}` : ''}</span>
          {#if party.members.length === 0}
            <p class="tv-empty">Nobody yet — scan the code with a phone.</p>
          {:else}
            <ul>
              {#each party.members as m (m.id)}
                <li animate:flip={{ duration: 250 }} in:fly={{ y: 16, duration: 250 }}>
                  <button type="button" class="tv-member" class:tv-off={!m.online} data-tv onclick={() => openSheet({ kind: 'kick', id: m.id, name: m.name })}>
                    <span class="tv-dot"></span>{m.name}{#if m.kind === 'family'}<span class="tv-fam">family</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        {#if party.notice}<p class="tv-notice" role="status">{party.notice}</p>{/if}
        {#if error}<p class="tv-notice" role="alert">{error}</p>{/if}

        <div class="tv-actions">
          <button type="button" class="tv-primary" data-tv data-tv-first onclick={startGame} disabled={busy}>Start</button>
          <button type="button" data-tv onclick={() => act(party.locked ? 'unlock' : 'lock')}>{party.locked ? 'Unlock' : 'Lock'}</button>
          <button type="button" data-tv onclick={() => go('menu')}>Change game</button>
        </div>
      </div>
    </section>
  {/if}

  {#if sheet}
    <div class="tv-veil" transition:fade={{ duration: 150 }}>
      <div class="tv-sheet">
        {#if sheet.kind === 'end'}
          <h2>End this game?</h2>
          <p class="tv-lead">Everybody goes back to the lobby. Nobody has to scan again.</p>
          <div class="tv-actions">
            <button type="button" data-tv data-tv-first onclick={() => (sheet = null)}>Keep playing</button>
            <button type="button" class="tv-danger" data-tv onclick={() => act('end')}>End game</button>
          </div>
        {:else}
          <h2>{sheet.name}</h2>
          <p class="tv-lead">Take {sheet.name} out of the game? They will not be able to rejoin this party.</p>
          <div class="tv-actions">
            <button type="button" data-tv data-tv-first onclick={() => (sheet = null)}>Keep them</button>
            <button type="button" class="tv-danger" data-tv onclick={() => sheet?.kind === 'kick' && act('kick', { memberId: sheet.id })}>Take out</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</TvStage>

<style>
  .tv-fill,
  .tv-center,
  .tv-menu,
  .tv-about,
  .tv-lobby {
    position: absolute;
    inset: 0;
  }
  .tv-center {
    display: grid;
    place-content: center;
    text-align: center;
    gap: 1cqw;
  }
  .tv-brand {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.3cqw;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .tv-mark {
    font-family: var(--font-brand);
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0.6cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 4.6cqw;
    line-height: 1.02;
    letter-spacing: -0.02em;
  }
  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 3cqw;
  }
  .tv-lead {
    margin: 0.8cqw 0 0;
    font-size: 1.7cqw;
    color: var(--on-ink-80);
  }
  .tv-label {
    display: block;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-55);
    margin-bottom: 0.6cqw;
  }
  button {
    font: inherit;
    font-size: 1.6cqw;
    padding: 0.9cqw 1.8cqw;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: var(--on-ink-05);
    color: var(--chrome-ink);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .tv-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--chrome-bg);
    font-weight: 700;
    min-width: 12cqw;
  }
  /* Focused, the primary keeps its fill: the stage's focus wash would hide its ink label. */
  .tv-primary:focus,
  .tv-primary:focus-visible {
    background: var(--accent-hover) !important;
    color: var(--chrome-bg);
  }
  .tv-danger {
    border-color: var(--error);
    color: var(--error);
  }

  /* Menu */
  .tv-menu {
    padding: 5cqw 6cqw;
    display: flex;
    flex-direction: column;
    gap: 3cqw;
  }
  .tv-tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 2cqw;
  }
  .tv-tile {
    width: 26cqw;
    min-height: 12.5cqw;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 0.8cqw;
    padding: 2cqw;
  }
  .tv-tile-name {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.6cqw;
  }
  .tv-tile-blurb {
    font-size: 1.4cqw;
    color: var(--on-ink-70);
    flex: 1;
  }
  .tv-tile-meta {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .tv-tile-kelly {
    border-color: var(--accent);
  }
  .tv-tile-quiet .tv-tile-meta {
    color: var(--on-ink-55);
  }
  .tv-sting {
    margin: auto 0 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-ink-45);
  }

  /* About */
  .tv-about {
    padding: 6cqw 10cqw;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1.6cqw;
  }
  .tv-prose {
    margin: 0;
    max-width: 62cqw;
    font-size: 1.8cqw;
    line-height: 1.55;
    color: var(--on-ink-80);
  }

  /* Lobby */
  .tv-lobby {
    display: grid;
    grid-template-columns: 38cqw 1fr;
    gap: 4cqw;
    padding: 4.5cqw 5cqw;
  }
  .tv-join {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1cqw;
  }
  .tv-qr {
    width: 30cqw;
    height: 30cqw;
    background: var(--chrome-ink);
    border-radius: 2px;
    image-rendering: pixelated;
  }
  .tv-qr-wait {
    background: var(--on-ink-08);
  }
  .tv-join-code {
    margin: 0.6cqw 0 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 5cqw;
    letter-spacing: 0.3em;
    padding-left: 0.3em;
  }
  .tv-join-url {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.3cqw;
    color: var(--on-ink-70);
  }
  .tv-locked {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.2cqw;
    color: var(--accent-on-dark);
  }
  .tv-side {
    display: flex;
    flex-direction: column;
    gap: 1.4cqw;
    min-width: 0;
  }
  .tv-options {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2cqw 3cqw;
    margin-top: 0.6cqw;
  }
  .tv-choices {
    display: flex;
    gap: 0.6cqw;
  }
  .tv-choice {
    font-size: 1.4cqw;
    padding: 0.6cqw 1.2cqw;
  }
  .tv-choice.tv-on {
    border-color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent-ink) 30%, transparent);
  }
  .tv-members ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.8cqw;
  }
  .tv-member {
    display: inline-flex;
    align-items: center;
    gap: 0.7cqw;
    font-size: 1.6cqw;
    padding: 0.6cqw 1.4cqw;
    border-radius: 100px;
  }
  .tv-dot {
    width: 0.8cqw;
    height: 0.8cqw;
    border-radius: 100px;
    background: var(--success);
  }
  .tv-off .tv-dot {
    background: var(--on-ink-30);
  }
  .tv-fam {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .tv-empty {
    margin: 0;
    font-size: 1.5cqw;
    color: var(--on-ink-55);
  }
  .tv-notice {
    margin: 0;
    font-size: 1.5cqw;
    color: var(--accent-on-dark);
  }
  .tv-actions {
    display: flex;
    gap: 1.2cqw;
    margin-top: auto;
  }

  /* Over a board */
  .tv-strip {
    position: absolute;
    left: 50%;
    bottom: 2cqw;
    transform: translateX(-50%);
    display: flex;
    gap: 1.2cqw;
    padding: 1cqw;
    background: var(--chrome-bg);
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
  }
  .tv-veil {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(11, 8, 6, 0.78);
  }
  .tv-sheet {
    width: 52cqw;
    padding: 3cqw;
    display: flex;
    flex-direction: column;
    gap: 1.2cqw;
    background: var(--chrome-bg);
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
  }
  .tv-sheet .tv-actions {
    margin-top: 1cqw;
  }
</style>
