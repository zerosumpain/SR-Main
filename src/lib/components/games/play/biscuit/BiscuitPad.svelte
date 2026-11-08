<script lang="ts">
  // Biscuit Tower on a phone at the TV: on your turn, the item and one big
  // DROP button (with a little crane swinging so you can time it without
  // looking up); otherwise whose turn it is and the scores. The drop is timed
  // on the server's clock the instant the finger lands, before any await —
  // the crane's swing is a function of that time (`craneX`), so the TV lets go
  // where the crane was. Posts `{ action: 'drop', turn, at }`.
  import { onMount } from 'svelte';
  import { craneX, type WireRoom } from '$lib/games/biscuit-tower';
  import { playAct } from '../play-stream';

  let { code, room, skewMs = 0 }: { code: string; room: WireRoom; skewMs?: number } = $props();

  let now = $state(Date.now());
  let sentFor = $state<number | null>(null);
  let toast = $state<string | null>(null);

  // Plain handles (svelte5-pitfalls §1).
  let frame = 0;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    const loop = () => {
      now = Date.now();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      if (toastTimer) clearTimeout(toastTimer);
    };
  });

  const serverNow = $derived(now + skewMs);
  const t = $derived(room.turn);
  const me = $derived(room.players.find((p) => p.id === room.meId) ?? null);
  const nameOf = (id: string | null | undefined) => room.players.find((p) => p.id === id)?.name ?? '';
  const mine = $derived(room.myTurn && !!t && sentFor !== t.number);
  const x = $derived(t && room.phase === 'aiming' ? craneX(serverNow, t.startsAt, room.periodMs) : 0);
  const left = $derived(room.phaseEndsAt ? Math.max(0, Math.ceil((room.phaseEndsAt - serverNow) / 1000)) : 0);
  const last = $derived(room.drops.length ? room.drops[room.drops.length - 1] : null);

  function say(text: string) {
    toast = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3_000);
  }

  async function drop() {
    // The moment, before anything else happens.
    const at = Date.now() + skewMs;
    if (!t || !mine) return;
    const turn = t.number;
    sentFor = turn;
    navigator.vibrate?.(25);
    try {
      await playAct(code, { action: 'drop', turn, at });
    } catch (err) {
      sentFor = null;
      say((err as Error).message);
    }
  }
</script>

<div class="btp">
  <header class="btp-bar">
    <span class="btp-kicker">{room.round ? `Round ${room.round} of ${room.rounds}` : 'Biscuit Tower'}</span>
    <span class="btp-score">{me?.score ?? 0} landed</span>
  </header>

  {#if room.phase === 'lobby'}
    <section class="btp-centre">
      <p class="btp-title">Biscuit Tower</p>
      <p class="btp-lead">Waiting for the TV to start. On your turn, tap DROP when the crane is over the tower.</p>
    </section>
  {:else if room.phase === 'countdown'}
    <section class="btp-centre"><p class="btp-title">Steady hands</p></section>
  {:else if room.phase === 'aiming' && t && mine}
    <section class="btp-turn">
      <p class="btp-lead">Your turn — drop {t.itemLabel}</p>
      <div class="btp-crane" aria-hidden="true">
        <span class="btp-rail"></span>
        <span class="btp-trolley" style:left="{50 + x * 40}%"></span>
        <span class="btp-target"></span>
      </div>
      <button type="button" class="btp-drop" onpointerdown={drop}>DROP</button>
      <p class="btp-lead btp-quiet">{left}s — it drops by itself when time runs out</p>
    </section>
  {:else if room.phase === 'aiming' && t}
    <section class="btp-centre">
      <p class="btp-title">{t.playerId === room.meId ? 'Dropped' : `${nameOf(t.playerId)} to drop`}</p>
      <p class="btp-lead">{t.itemLabel} · {left}s</p>
    </section>
  {:else if room.phase === 'falling'}
    <section class="btp-centre">
      <p class="btp-title">Will it hold?</p>
      <p class="btp-lead">Watch the TV.</p>
    </section>
  {:else if room.phase === 'toppled'}
    <section class="btp-centre">
      <p class="btp-title">Down it goes</p>
      <p class="btp-lead">{last?.playerId === room.meId ? 'You knocked it over.' : `${nameOf(last?.playerId)} knocked it over.`} Next round in a moment.</p>
    </section>
  {:else if room.phase === 'finished'}
    <section class="btp-centre">
      <p class="btp-title">{room.winnerIds.includes(room.meId) ? 'You win' : 'Game over'}</p>
      <ol class="btp-list">
        {#each room.standings ?? [] as s, i (s.id)}
          <li class:btp-me={s.id === room.meId}><span>{i + 1}. {s.name}</span><span>{s.score}</span></li>
        {/each}
      </ol>
      <p class="btp-lead btp-quiet">The TV takes everyone back to the lobby.</p>
    </section>
  {:else}
    <section class="btp-centre"><p class="btp-lead">That game has ended. Watch the TV.</p></section>
  {/if}

  {#if toast}<p class="btp-toast" role="alert">{toast}</p>{/if}
</div>

<style>
  .btp {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 16px;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
    font-family: var(--font-body);
  }
  .btp-bar {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .btp-kicker {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .btp-score {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent-on-dark);
  }
  .btp-centre,
  .btp-turn {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
  }
  .btp-turn {
    align-items: stretch;
  }
  .btp-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 34px;
    line-height: 1.1;
  }
  .btp-lead {
    margin: 0;
    font-size: 17px;
    color: var(--on-ink-80);
  }
  .btp-quiet {
    color: var(--on-ink-55);
    font-size: 14px;
  }
  .btp-crane {
    position: relative;
    height: 64px;
  }
  .btp-rail {
    position: absolute;
    left: 6%;
    right: 6%;
    top: 10px;
    height: 3px;
    background: var(--on-ink-30);
  }
  .btp-trolley {
    position: absolute;
    top: 2px;
    width: 34px;
    height: 34px;
    margin-left: -17px;
    border-radius: 2px;
    background: var(--accent);
  }
  .btp-target {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 60px;
    margin-left: -30px;
    height: 8px;
    background: var(--on-ink-30);
  }
  .btp-drop {
    min-height: 46vh;
    border: none;
    border-radius: 100px;
    background: var(--accent);
    color: var(--chrome-bg);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 56px;
    letter-spacing: 0.04em;
    touch-action: manipulation;
    cursor: pointer;
  }
  .btp-drop:active {
    background: var(--accent-hover);
  }
  .btp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .btp-list li {
    display: flex;
    justify-content: space-between;
    padding: 10px 12px;
    border: 1px solid var(--on-ink-14);
    border-radius: 2px;
    font-size: 16px;
  }
  .btp-list li.btp-me {
    border-color: var(--accent);
  }
  .btp-toast {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 20px;
    margin: 0;
    padding: 12px 14px;
    border-radius: 2px;
    background: var(--chrome-ink);
    color: var(--chrome-bg);
    font-size: 15px;
  }
</style>
