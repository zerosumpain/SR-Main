<script lang="ts">
  // /games/[id] — one table, live. The first paint is the load's room; after
  // that the page follows `/api/games/[id]/stream` (the same SSE frames the
  // phone reads) and every move is a POST to `/api/games/[id]`.
  import { onMount } from 'svelte';
  import GamesFrame from '$lib/components/games/GamesFrame.svelte';
  import GamesCover from '$lib/components/games/GamesCover.svelte';
  import LiarsDiceTable from '$lib/components/games/LiarsDiceTable.svelte';
  import type { WireRoom } from '$lib/games/liars-dice';
  import { GAME_NAMES, playableOnWeb } from '$lib/games/web';
  import { nameOf } from '$lib/games/liars-dice-view';

  type Room = Omit<WireRoom, 'players'> & { players: (WireRoom['players'][number] & { sawInvite?: boolean })[] };

  let { data } = $props();

  let live = $state<Room | null>(null);
  const room = $derived(live ?? (data.room as unknown as Room | null));
  let gone = $state(false);
  let nightChoice = $state<boolean | null>(null);
  const night = $derived(nightChoice ?? data.night);
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let invitable = $state<{ id: string; name: string }[]>([]);

  // Server clock minus ours, from the last frame; and a ticking "now" for the
  // turn bar. Both plain numbers the template reads.
  let skew = $state(0);
  let tick = $state(Date.now());
  const now = $derived(tick + skew);

  const playable = $derived(!!room && playableOnWeb(room.game));
  const gameName = $derived(room ? (GAME_NAMES[room.game as keyof typeof GAME_NAMES] ?? room.game) : 'Game');

  function take(next: Room) {
    skew = next.serverNow - Date.now();
    live = next;
  }

  onMount(() => {
    if (!data.room) {
      gone = true;
      return;
    }
    skew = (data.room as unknown as Room).serverNow - Date.now();
    // Handles, not $state: nothing renders them (svelte5-pitfalls §1).
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const clock = setInterval(() => (tick = Date.now()), 250);

    const open = () => {
      if (stopped || !playable) return;
      source = new EventSource(`/api/games/${data.id}/stream`);
      source.onmessage = (e) => {
        let msg: { type: string; room?: Room };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'room' && msg.room) take(msg.room);
        if (msg.type === 'gone') {
          gone = true;
          source?.close();
        }
      };
      source.onerror = async () => {
        // A 403/404 closes the EventSource for good; a dropped connection
        // retries by itself. Ask once which it was.
        if (!source || source.readyState !== EventSource.CLOSED) return;
        source = null;
        const res = await fetch(`/api/games/${data.id}`).catch(() => null);
        if (res && (res.status === 404 || res.status === 403)) {
          gone = true;
          return;
        }
        if (res?.ok) take((await res.json()).room);
        retry = setTimeout(open, 2000);
      };
    };
    open();

    return () => {
      stopped = true;
      clearInterval(clock);
      if (retry) clearTimeout(retry);
      source?.close();
    };
  });

  // The host's "invite more" list: who the lobby could invite, fetched once
  // the host is looking at an open lobby.
  let askedRoster = false;
  $effect(() => {
    if (askedRoster || !room || room.phase !== 'lobby' || room.hostId !== room.meId) return;
    askedRoster = true;
    fetch('/api/games')
      .then((r) => (r.ok ? r.json() : null))
      .then((lobby) => {
        if (lobby) invitable = lobby.players;
      })
      .catch(() => {});
  });

  async function act(action: string, body: Record<string, unknown> = {}) {
    busy = true;
    problem = null;
    try {
      const res = await fetch(`/api/games/${data.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) problem = out.error ?? 'Something went wrong. Try again.';
      else if (out.room) take(out.room);
    } catch {
      problem = 'Could not reach the table. Try again.';
    } finally {
      busy = false;
    }
  }

  const title = $derived.by((): [string, string] => {
    if (!room || gone) return ['THAT GAME', 'HAS FINISHED.'];
    if (room.phase === 'lobby') return [gameName + ',', 'THE LOBBY.'];
    if (room.phase === 'finished') return [gameName + ',', 'THE RESULT.'];
    return [gameName + ',', `ROUND ${Math.max(1, room.round)}.`];
  });
  const standfirst = $derived.by(() => {
    if (!room || gone) return data.refusal ?? 'The table was cleared. Start another from the lobby.';
    if (!playable) return 'This game plays in the iPhone app — open it there.';
    if (room.phase === 'lobby') return `Hosted by ${nameOf(room, room.hostId)}. Everyone in the lobby is dealt in when the host starts.`;
    return room.rule;
  });
  const deck = $derived.by(() => {
    if (!room || gone || !playable) return [];
    if (room.phase === 'lobby' || room.phase === 'countdown') {
      const n = (s: string) => String(room.players.filter((p) => p.status === s).length).padStart(2, '0');
      return [
        { label: 'In', value: n('joined'), note: `${room.dicePerPlayer} dice each` },
        { label: 'Invited', value: n('invited'), note: 'Not answered yet' },
      ];
    }
    const me = room.players.find((p) => p.id === room.meId);
    const alive = room.players.filter((p) => p.seated && !p.out).length;
    return [
      { label: 'Your dice', value: String(me?.diceCount ?? 0).padStart(2, '0'), note: me?.out ? 'Out' : 'Under your cup' },
      { label: 'In play', value: String(room.totalDice).padStart(2, '0'), note: `${alive} ${alive === 1 ? 'player' : 'players'}` },
    ];
  });
</script>

<svelte:head>
  <title>sr. games — {gameName}</title>
</svelte:head>

<GamesFrame path="/games" {night} footer={['strangeramblings.com/games · family games', 'same room as the app', 'moves are checked by the server']}>
  <GamesCover eyebrow="Family games · {gameName}" {title} {standfirst} {deck} {night} onnight={(n) => (nightChoice = n)} />

  {#if problem}
    <p class="problem" role="alert">{problem}</p>
  {/if}

  <section class="band">
    <div class="inner">
      {#if !room || gone}
        <a class="btn" href="/games">Back to the lobby</a>
      {:else if !playable}
        <p class="app-only">Open {gameName} in the app.</p>
        <a class="btn" href="/games">Back to the lobby</a>
      {:else}
        <LiarsDiceTable {room} {now} {busy} {invitable} onact={act} />
      {/if}
    </div>
  </section>
</GamesFrame>

<style>
  .band {
    padding: clamp(24px, 4vw, 56px) clamp(16px, 3vw, 44px);
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
  .app-only {
    margin: 0 0 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 8px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    text-decoration: none;
    color: var(--text-primary);
    border: 1px solid var(--text-primary);
  }
  .btn:hover {
    background: var(--text-primary);
    color: var(--bg);
  }
</style>
