<script lang="ts">
  // sr. tv on a linked TV: the menu of games, the party's lobby (QR, who is
  // in, the game's options, Start) and, once a game runs, its TV board. One
  // stream (`tv-stream` openTv) carries the party and the room; the TV's
  // verbs are POSTs (`tvParty`). Driven by the remote (`focus` remote).
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import TvStage from './TvStage.svelte';
  import PixelTile from './PixelTile.svelte';
  import { artFor } from './pixel';
  import { castTvItem, fetchTvBacklog, type CastWire, type TvBacklogItem } from '$lib/games/tv-backlog';
  import { focusFirst, remote } from './focus';
  import { openTv, tvParty, type TvState } from './tv-stream';
  import { TvMusic, musicOff, trackFor } from './tv-music';
  import { DIFFICULTY, GAME_OPTIONS, GAME_BLURBS, defaultOptions, type TvOption } from './tv-games';
  import { STING, hostLine } from '$lib/games/kelly';
  import BoggleTable from '$lib/components/games/boggle/BoggleTable.svelte';
  import AzulTable from '$lib/components/games/azul/AzulTable.svelte';
  import QuizTable from '$lib/components/games/quiz/QuizTable.svelte';
  import CodenamesTable from '$lib/components/games/codenames/CodenamesTable.svelte';
  import SnapTable from '$lib/components/games/snap/SnapTable.svelte';
  import BiscuitTable from '$lib/components/games/biscuit/BiscuitTable.svelte';
  import IronTable from '$lib/components/games/iron/IronTable.svelte';
  import type { ScreenRoom as IronRoom } from '$lib/games/iron-roads';
  import type { ScreenRoom as BiscuitRoom } from '$lib/games/biscuit-tower';
  import type { ScreenRoom as SnapRoom } from '$lib/games/snap-happy';
  import type { AzulRoom } from '$lib/components/games/azul/motion';
  import type { WireRoom as QuizRoom } from '$lib/games/quiz-night';
  import type { WireRoom as CodenamesRoom } from '$lib/games/codenames';
  import type { PartyView } from '$lib/games/party';
  import type { PackSummary } from '$lib/games/quiz-packs';
  import type { ScreenRoom as BoggleRoom } from '$lib/games/boggle';

  interface TvProject {
    key: string;
    href: string;
    title: string;
    blurb: string;
  }

  let {
    tvName,
    family = [],
    packs = [],
    projects = [],
  }: { tvName: string; family?: string[]; packs?: PackSummary[]; projects?: TvProject[] } = $props();

  type View = 'menu' | 'lobby' | 'about' | 'backlog';
  /** The video playing over everything, and where getting it ready has got to. */
  type Player = { item: TvBacklogItem; cast: CastWire | null };
  type Sheet = null | { kind: 'end' } | { kind: 'kick'; id: string; name: string };

  let link = $state<TvState>({ kind: 'connecting' });
  let view = $state<View>('menu');
  let sheet = $state<Sheet>(null);
  let qr = $state<string | null>(null);
  let joinUrl = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let musicOn = $state(!musicOff());
  /** The menu tile with the remote's focus, for the line under the heading. */
  let focusedBlurb = $state<string | null>(null);
  let backlog = $state<TvBacklogItem[] | null>(null);
  let backlogError = $state<string | null>(null);
  let player = $state<Player | null>(null);
  let controlsShown = $state(true);

  const music = new TvMusic();

  // Plain handles (svelte5-pitfalls §1).
  let qrFor: string | null = null;
  /** What the menu last saw: somebody joining, or the host picking a game, moves the TV to the lobby. */
  let seenJoined = 0;
  let seenPick = '';
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
  const host = $derived(party?.members.find((m) => m.id === party?.hostId) ?? null);
  const greeting = $derived.by(() => {
    if (!party) return '';
    if (family.length && party.members.length === 0) return `Right then — ${family[seed % family.length]}, grab a phone and scan the code.`;
    if (host) return `${host.name} is the host — pick and start from their phone, or with the remote.`;
    return hostLine('lobby', seed);
  });

  // What is on screen picks the track; TvMusic itself holds no reactive state.
  // A family video plays over silence.
  $effect(() => {
    if (player) music.stop();
    else if (party) music.play(trackFor(view, party.game, playing));
  });

  let video: HTMLVideoElement | null = $state(null);
  // Plain handles (svelte5-pitfalls §1).
  let castTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadBacklog() {
    backlogError = null;
    try {
      backlog = await fetchTvBacklog();
    } catch (err) {
      backlogError = `Could not fetch the list just now (${(err as Error).message}). Try again in a minute.`;
      backlog = backlog ?? [];
    }
  }

  async function openBacklog() {
    await go('backlog');
    await loadBacklog();
    await tick();
    focusFirst(true);
  }

  /** Get a video ready on the server, asking again while it is fetched, then play it. */
  async function play(item: TvBacklogItem) {
    if (castTimer) clearTimeout(castTimer);
    player = { item, cast: null };
    controlsShown = true;
    await tick();
    focusFirst(true);
    const ask = async () => {
      if (player?.item.id !== item.id) return;
      let cast: CastWire;
      try {
        cast = await castTvItem(item.id);
      } catch (err) {
        cast = { state: 'fallback', fallback: 'mirror', reason: (err as Error).message, url: null };
      }
      if (player?.item.id !== item.id) return;
      player = { item, cast };
      if (cast.state === 'preparing') castTimer = setTimeout(ask, cast.retryAfterSeconds * 1000);
      else {
        await tick();
        focusFirst(true);
        if (cast.state === 'ready') showControls();
      }
    };
    await ask();
  }

  function nextItem(): TvBacklogItem | null {
    if (!player || !backlog) return null;
    const i = backlog.findIndex((b) => b.id === player!.item.id);
    return i >= 0 && i + 1 < backlog.length ? backlog[i + 1] : null;
  }

  function playNext() {
    const next = nextItem();
    if (next) void play(next);
    else closePlayer();
  }

  function closePlayer() {
    if (castTimer) clearTimeout(castTimer);
    if (hideTimer) clearTimeout(hideTimer);
    const was = player?.item.id;
    player = null;
    void tick().then(() => {
      const card = was ? document.querySelector<HTMLElement>(`[data-backlog="${was}"]`) : null;
      if (card) card.focus();
      else focusFirst(true);
    });
  }

  function togglePause() {
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }

  function seek(by: number) {
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + by));
  }

  /** The player's controls show on any key and fade after a few quiet seconds while it plays. */
  function showControls() {
    controlsShown = true;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (video && !video.paused) controlsShown = false;
    }, 4_000);
  }

  function onPlayerKey(e: KeyboardEvent) {
    if (!player) return;
    showControls();
    if (e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'MediaFastForward') seek(10);
    else if (e.key === 'MediaRewind') seek(-10);
  }

  function openProject(href: string) {
    music.stop();
    location.assign(href);
  }

  function openMarbler() {
    // Marbler's TV mode: races run by themselves, the remote picks the next one, Back comes home.
    openProject('/projects/marbler/?tv=1');
  }

  function toggleMusic() {
    musicOn = !music.toggle();
  }

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

  /**
   * A strip of controls that appears over a board takes the remote's focus —
   * its first button that can take it (Start waits while the questions are
   * written, so the strip watches for it to be enabled).
   */
  function grabFocus(node: HTMLElement) {
    const take = () => {
      const first = node.querySelector<HTMLElement>('[data-tv-first]:not(:disabled)');
      // The primary button, once it can take focus, takes it back from its neighbours.
      if (first) {
        if (document.activeElement !== first) first.focus();
        return;
      }
      const active = document.activeElement;
      if (active && node.contains(active)) return;
      node.querySelector<HTMLElement>('[data-tv]:not(:disabled)')?.focus();
    };
    queueMicrotask(take);
    const watch = new MutationObserver(take);
    watch.observe(node, { attributes: true, subtree: true, attributeFilter: ['disabled'] });
    return { destroy: () => watch.disconnect() };
  }

  function back(): boolean {
    if (player) {
      closePlayer();
      return true;
    }
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
        const joined = s.party.members.length;
        const pickKey = JSON.stringify([s.party.game, s.party.options]);
        // A phone is driving: a newcomer, or the host choosing a game, brings the TV to the lobby to show it.
        if (!first && view === 'menu' && !player && (joined > seenJoined || (joined > 0 && pickKey !== seenPick))) void go('lobby');
        seenJoined = joined;
        seenPick = pickKey;
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
      music.stop();
      if (castTimer) clearTimeout(castTimer);
      if (hideTimer) clearTimeout(hideTimer);
      if (errorTimer) clearTimeout(errorTimer);
    };
  });
</script>

<!-- A game board gets no painting behind it; the lobby has the kitchen table, everything else the living room. -->
<TvStage art={playing ? null : view === 'lobby' && party ? '/tv-art/lobby.webp' : '/tv-art/menu.webp'}>
  {#if !party}
    <div class="tv-center" in:fade>
      <div class="tv-splash"><PixelTile label="sr." /></div>
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
      {:else if party.game === 'snap-happy'}
        <SnapTable room={room as SnapRoom} {skewMs} />
      {:else if party.game === 'biscuit-tower'}
        <!-- This TV runs the physics and says how each drop landed. -->
        <BiscuitTable room={room as BiscuitRoom} {skewMs} report={(b) => void tvParty({ action: 'report', ...b }).catch(() => {})} />
      {:else if party.game === 'iron-roads'}
        <IronTable room={room as IronRoom} {skewMs} />
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
        <div class="tv-logo"><PixelTile label="sr." /></div>
        <div class="tv-top-text">
          <p class="tv-brand"><span class="tv-mark">sr.</span> tv · {tvName}</p>
          <h1>What are we playing?</h1>
          <p class="tv-lead">{focusedBlurb ?? greeting}</p>
        </div>
        <!-- Join from the menu: the first phone in is the host and can pick the game itself. -->
        <div class="tv-menu-join">
          {#if qr}<img src={qr} alt="Scan to join" />{/if}
          <p>
            <span class="tv-menu-code" aria-label="Code {party.code.split('').join(' ')}">{party.code}</span>
            <span>{host ? `${host.name} is hosting` : 'Scan to play · first in hosts'}</span>
          </p>
        </div>
      </header>

      <div class="tv-rail">
        <span class="tv-label">Games</span>
        <div class="tv-row">
          {#each party.games as g, i (g.id)}
            {@render card({
              art: g.id,
              name: g.title,
              meta: `${g.min === g.max ? g.min : `${g.min}–${g.max}`} players`,
              blurb: GAME_BLURBS[g.id] ?? '',
              first: i === 0,
              onclick: () => pick(g.id),
            })}
          {/each}
          {#if packs.length}
            {@render card({
              art: 'kelly',
              name: 'Kelly’s Quiz Night',
              meta: `${packs.length} ${packs.length === 1 ? 'pack' : 'packs'} · 1–8 players`,
              blurb: 'Questions about us — old photos, holidays and the stories we keep telling.',
              onclick: pickKelly,
            })}
          {/if}
        </div>
      </div>

      <div class="tv-rail">
        <span class="tv-label">Watch</span>
        <div class="tv-row">
          {@render card({
            art: 'backlog',
            name: 'Family backlog',
            meta: 'From your phones',
            blurb: 'The videos everyone shared to SR from their phones, ready to play on the big screen.',
            onclick: openBacklog,
          })}
          {@render card({
            art: 'marbler',
            name: 'Marbler',
            meta: 'Marble races',
            blurb: 'Sit back and watch the marbles race down a machine built for this race alone. Pick a favourite.',
            onclick: openMarbler,
          })}
        </div>
      </div>

      {#if projects.length}
        <div class="tv-rail">
          <span class="tv-label">From the site</span>
          <div class="tv-row">
            {#each projects as p (p.key)}
              {@render card({ art: 'projects', name: p.title, meta: 'On the site', blurb: p.blurb, onclick: () => openProject(p.href) })}
            {/each}
          </div>
        </div>
      {/if}

      <div class="tv-foot">
        <button type="button" class="tv-quiet" data-tv onclick={() => go('about')} onfocus={() => (focusedBlurb = 'What this is, and who made it.')}>About</button>
        <p class="tv-sting">{STING}</p>
        <button type="button" class="tv-quiet" data-tv onclick={toggleMusic} onfocus={() => (focusedBlurb = null)}>Music: {musicOn ? 'on' : 'off'}</button>
      </div>
    </section>
  {:else if view === 'backlog'}
    <section class="tv-backlog" in:fade={{ duration: 250 }} inert={!!player}>
      <header class="tv-top">
        <div class="tv-logo">{@render art('backlog')}</div>
        <div class="tv-top-text">
          <p class="tv-brand"><span class="tv-mark">sr.</span> tv · {tvName}</p>
          <h1>Family backlog</h1>
          <p class="tv-lead">Shared from the app with Share → SR. Pick one and it plays here.</p>
        </div>
      </header>
      {#if backlog === null}
        <p class="tv-empty">Fetching the list…</p>
      {:else if backlog.length === 0}
        <p class="tv-empty">{backlogError ?? 'Nothing to watch yet. Share a YouTube, TikTok or Instagram video to SR from a phone and it turns up here.'}</p>
        <div class="tv-actions"><button type="button" data-tv data-tv-first onclick={() => go('menu')}>Back to the menu</button></div>
      {:else}
        <div class="tv-videos">
          {#each backlog as item, i (item.id)}
            <button type="button" class="tv-video" data-tv data-tv-first={i === 0 ? '' : undefined} data-backlog={item.id} onclick={() => play(item)}>
              <span class="tv-thumb">
                {#if item.thumbnailUrl}<img src={item.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />{/if}
                <span class="tv-provider">{item.provider}</span>
              </span>
              <span class="tv-video-title">{item.title}</span>
              <span class="tv-card-meta">{item.sharedBy ? `Shared by ${item.sharedBy}` : 'Shared from the app'}</span>
            </button>
          {/each}
        </div>
      {/if}
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
                    <span class="tv-dot"></span>{m.name}{#if m.id === party.hostId}<span class="tv-fam">host</span>{:else if m.kind === 'family'}<span class="tv-fam">family</span>{/if}
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
  {#if player}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="tv-player" transition:fade={{ duration: 200 }} onkeydown={onPlayerKey}>
      {#if player.cast?.state === 'ready'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={video}
          src={player.cast.mediaUrl}
          poster={player.cast.posterUrl ?? undefined}
          autoplay
          playsinline
          onended={playNext}
          onpause={() => (controlsShown = true)}
          onplay={showControls}
        ></video>
        <div class="tv-player-bar" class:tv-hidden={!controlsShown}>
          <p class="tv-player-title">{player.item.title}{#if player.item.sharedBy}<span> · {player.item.sharedBy}</span>{/if}</p>
          <div class="tv-actions">
            <button type="button" data-tv onclick={() => seek(-10)}>−10 s</button>
            <button type="button" class="tv-primary" data-tv data-tv-first onclick={togglePause}>Play / pause</button>
            <button type="button" data-tv onclick={() => seek(10)}>+10 s</button>
            <button type="button" data-tv onclick={playNext}>{nextItem() ? 'Next video' : 'Finish'}</button>
            <button type="button" data-tv onclick={closePlayer}>Back to the list</button>
          </div>
        </div>
      {:else}
        <div class="tv-center">
          <p class="tv-brand"><span class="tv-mark">sr.</span> family backlog</p>
          <h2>{player.item.title}</h2>
          {#if player.cast?.state === 'fallback'}
            <p class="tv-lead">This one will not play on the TV: {player.cast.reason}</p>
            <div class="tv-actions tv-actions-centre">
              {#if nextItem()}<button type="button" class="tv-primary" data-tv data-tv-first onclick={playNext}>Next video</button>{/if}
              <button type="button" data-tv data-tv-first={nextItem() ? undefined : ''} onclick={closePlayer}>Back to the list</button>
            </div>
          {:else}
            <p class="tv-lead">Getting it ready — the first play of a video takes a few seconds.</p>
            <div class="tv-actions tv-actions-centre"><button type="button" data-tv data-tv-first onclick={closePlayer}>Cancel</button></div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</TvStage>

{#snippet art(id: string)}
  <PixelTile art={artFor(id)} />
{/snippet}

{#snippet card(c: { art: string; name: string; meta: string; blurb: string; first?: boolean; onclick: () => void })}
  <button
    type="button"
    class="tv-card"
    style="--hue: {artFor(c.art).hue.glow}"
    data-tv
    data-tv-first={c.first ? '' : undefined}
    onclick={c.onclick}
    onfocus={() => (focusedBlurb = c.blurb)}
  >
    <span class="tv-card-art">{@render art(c.art)}</span>
    <span class="tv-card-text">
      <span class="tv-card-name">{c.name}</span>
      <span class="tv-card-meta">{c.meta}</span>
    </span>
  </button>
{/snippet}

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

  /* Menu: the app's logo, then a row of tiles per kind, each tile wearing its own Prism hue. */
  .tv-menu,
  .tv-backlog {
    padding: 2.6cqw 5cqw 2cqw;
    display: flex;
    flex-direction: column;
    gap: 1.3cqw;
  }
  .tv-top {
    display: flex;
    align-items: center;
    gap: 2.2cqw;
  }
  .tv-top-text {
    min-width: 0;
    flex: 1;
  }
  .tv-menu-join {
    flex: none;
    display: flex;
    align-items: center;
    gap: 1cqw;
    padding: 0.6cqw;
    background: var(--tv-surface);
    border: 1px solid var(--on-ink-14);
  }
  .tv-menu-join img {
    width: 7cqw;
    height: 7cqw;
    background: #fff;
    padding: 0.3cqw;
  }
  .tv-menu-join p {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3cqw;
    max-width: 12cqw;
    font-size: 1.1cqw;
    color: var(--on-ink-80);
  }
  .tv-menu-code {
    font-family: var(--font-mono);
    font-size: 2.2cqw;
    letter-spacing: 0.2em;
    color: var(--chrome-ink);
  }
  .tv-logo {
    width: 6.6cqw;
    flex: none;
  }
  .tv-splash {
    width: 12cqw;
    margin: 0 auto 1.4cqw;
  }
  .tv-menu h1,
  .tv-backlog h1 {
    font-size: 3.4cqw;
    margin-top: 0.3cqw;
  }
  .tv-top .tv-lead {
    margin-top: 0.5cqw;
    font-size: 1.5cqw;
    min-height: 2.2cqw;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tv-rail .tv-label {
    margin-bottom: 0.2cqw;
  }
  /* A row scrolls sideways under the remote; the padding leaves room for a focused tile's lift. */
  .tv-row {
    display: flex;
    gap: 1.4cqw;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.7cqw 0.6cqw;
    margin: 0 -0.6cqw;
    scrollbar-width: none;
    scroll-padding: 0 1cqw;
  }
  .tv-row::-webkit-scrollbar {
    display: none;
  }
  /* One height for every tile, so three rows and the footer always fit the screen. */
  .tv-card {
    flex: none;
    width: 20.4cqw;
    height: 7.6cqw;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 1.2cqw;
    padding: 1cqw;
    text-align: left;
    background: var(--tv-surface);
    border-color: var(--on-ink-14);
  }
  .tv-card:focus,
  .tv-card:focus-visible {
    border-color: var(--hue) !important;
    background: color-mix(in srgb, var(--hue) 16%, var(--tv-surface)) !important;
  }
  .tv-card-art {
    width: 5.2cqw;
    flex: none;
  }
  .tv-card-text {
    display: flex;
    flex-direction: column;
    gap: 0.5cqw;
    min-width: 0;
  }
  .tv-card-name {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.6cqw;
    line-height: 1.1;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tv-card .tv-card-meta {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tv-card-meta {
    font-family: var(--font-mono);
    font-size: 1cqw;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--tv-ink-2);
  }
  .tv-foot {
    margin: auto 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 2cqw;
  }
  .tv-quiet {
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.6cqw 1.2cqw;
  }
  .tv-sting {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1.1cqw;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-ink-45);
  }

  /* Family backlog: thumbnails four across, scrolling under the remote. */
  .tv-videos {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.6cqw;
    overflow-y: auto;
    padding: 0.7cqw 0.6cqw;
    margin: 0 -0.6cqw;
    scrollbar-width: none;
    scroll-padding: 1cqw 0;
  }
  .tv-videos::-webkit-scrollbar {
    display: none;
  }
  .tv-video {
    display: flex;
    flex-direction: column;
    gap: 0.6cqw;
    padding: 0.8cqw;
    text-align: left;
    background: var(--tv-surface);
    border-color: var(--on-ink-14);
  }
  .tv-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    background: var(--on-ink-08);
    overflow: hidden;
  }
  .tv-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tv-provider {
    position: absolute;
    left: 0.5cqw;
    bottom: 0.5cqw;
    padding: 0.2cqw 0.6cqw;
    font-family: var(--font-mono);
    font-size: 0.9cqw;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
  }
  .tv-video-title {
    font-size: 1.4cqw;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* The player: the video fills the stage; its controls fade while it plays. */
  .tv-player {
    position: absolute;
    inset: 0;
    background: #000;
  }
  .tv-player video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .tv-player-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 2cqw 4cqw 2.4cqw;
    display: flex;
    flex-direction: column;
    gap: 1cqw;
    background: linear-gradient(transparent, rgba(11, 10, 28, 0.92) 40%);
    transition: opacity 400ms ease;
  }
  .tv-player-bar.tv-hidden {
    opacity: 0;
  }
  .tv-player-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2cqw;
  }
  .tv-player-title span {
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 1.2cqw;
    color: var(--tv-ink-2);
  }
  .tv-player .tv-center {
    position: absolute;
    inset: 0;
    padding: 0 12cqw;
  }
  .tv-actions-centre {
    justify-content: center;
    margin-top: 1.4cqw;
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
    background: rgba(11, 10, 28, 0.82);
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
