<script lang="ts">
  // The host's phone: the TV's lobby and strip, so whoever joined first can run
  // the evening without the remote. Pick the game and its options, Start; Go
  // once a game with set-up is ready; Play again or Back to the lobby at the
  // end; take somebody out; lock the door. Every press is a TV verb through
  // `hostAct`, and the party that comes back on the stream redraws this.
  import { onMount } from 'svelte';
  import { hostAct, hostPacks, type PlayParty } from './play-stream';
  import { DIFFICULTY, GAME_OPTIONS, defaultOptions, type TvOption } from '$lib/components/tv/tv-games';

  let {
    code,
    meId,
    party,
    roomPhase = null,
    writing = false,
  }: { code: string; meId: string; party: PlayParty; roomPhase?: string | null; writing?: boolean } = $props();

  let packs = $state<{ id: string; title: string }[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let confirmEnd = $state(false);

  onMount(() => {
    void hostPacks(code).then((p) => (packs = p));
  });

  const kelly = $derived(party.game === 'quiz-night' && typeof party.options.pack === 'string');
  const options = $derived.by((): TvOption[] => {
    if (!party.game) return [];
    if (!kelly) return GAME_OPTIONS[party.game] ?? [];
    const pack: TvOption = { key: 'pack', label: 'Pack', fallback: packs[0]?.id ?? '', choices: packs.map((p) => ({ value: p.id, label: p.title })) };
    return [pack, { ...DIFFICULTY, label: 'Time to answer', choices: [{ value: 'easy', label: 'Relaxed' }, { value: 'medium', label: 'Normal' }, { value: 'hard', label: 'Quick' }] }];
  });
  const others = $derived(party.members.filter((m) => m.id !== meId));

  async function send(body: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await hostAct(code, body);
      confirmEnd = false;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  function pick(game: string) {
    // As on the TV: Quiz Night from its own button is jkai's quiz, so a pack chosen before is dropped.
    const same = party.game === game && !(game === 'quiz-night' && party.options.pack);
    void send({ action: 'pick', game, options: same ? party.options : defaultOptions(game) });
  }

  function pickKelly() {
    if (!packs.length) return;
    const keep = kelly && packs.some((p) => p.id === party.options.pack);
    void send({ action: 'pick', game: 'quiz-night', options: keep ? party.options : { pack: packs[0].id, difficulty: 'medium' } });
  }

  function setOption(key: string, value: string | number) {
    if (party.game) void send({ action: 'pick', game: party.game, options: { ...party.options, [key]: value } });
  }
</script>

<section class="host" aria-label="Host controls">
  <p class="host-kicker">You're the host</p>

  {#if !party.roomId}
    <h2 class="host-label">Game</h2>
    <div class="host-chips">
      {#each party.games as g (g.id)}
        <button type="button" class="host-chip" class:host-on={party.game === g.id && !(g.id === 'quiz-night' && kelly)} disabled={busy} onclick={() => pick(g.id)}>{g.title}</button>
      {/each}
      {#if packs.length}
        <button type="button" class="host-chip" class:host-on={kelly} disabled={busy} onclick={pickKelly}>Kelly’s Quiz Night</button>
      {/if}
    </div>

    {#each options as opt (opt.key)}
      <h2 class="host-label">{opt.label}</h2>
      <div class="host-chips">
        {#each opt.choices as c (c.value)}
          <button type="button" class="host-chip" class:host-on={(party.options[opt.key] ?? opt.fallback) === c.value} disabled={busy} onclick={() => setOption(opt.key, c.value)}>{c.label}</button>
        {/each}
      </div>
    {/each}

    <button type="button" class="host-btn" disabled={busy || !party.game} onclick={() => send({ action: 'start' })}>
      {busy ? 'One moment…' : `Start · ${party.members.length} playing`}
    </button>

    {#if others.length}
      <h2 class="host-label">Take somebody out</h2>
      <div class="host-chips">
        {#each others as m (m.id)}
          <button type="button" class="host-chip" disabled={busy} onclick={() => send({ action: 'kick', memberId: m.id })}>{m.name} ✕</button>
        {/each}
      </div>
    {/if}
    <button type="button" class="host-quiet" disabled={busy} onclick={() => send({ action: party.locked ? 'unlock' : 'lock' })}>
      {party.locked ? 'Unlock — let more people join' : 'Lock — nobody else can join'}
    </button>
  {:else if roomPhase === 'lobby'}
    <button type="button" class="host-btn" disabled={busy || writing} onclick={() => send({ action: 'go' })}>{writing ? 'Writing the questions…' : 'Start the game'}</button>
    <button type="button" class="host-quiet" disabled={busy} onclick={() => send({ action: 'end' })}>Back to the lobby</button>
  {:else if roomPhase === 'finished'}
    <button type="button" class="host-btn" disabled={busy} onclick={() => send({ action: 'again' })}>Play again</button>
    <button type="button" class="host-quiet" disabled={busy} onclick={() => send({ action: 'end' })}>Back to the lobby</button>
  {:else if confirmEnd}
    <div class="host-row">
      <button type="button" class="host-danger" disabled={busy} onclick={() => send({ action: 'end' })}>End the game</button>
      <button type="button" class="host-quiet" onclick={() => (confirmEnd = false)}>Keep playing</button>
    </div>
  {:else}
    <button type="button" class="host-quiet" onclick={() => (confirmEnd = true)}>End the game…</button>
  {/if}

  {#if error}
    <p class="host-error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .host {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 24px 0;
    padding: 16px;
    border-left: 2px solid var(--accent-on-dark);
    background: var(--on-ink-05);
  }
  .host-kicker,
  .host-label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .host-kicker {
    color: var(--accent-on-dark);
  }
  .host-label {
    margin-top: 6px;
  }
  .host-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .host-chip {
    padding: 10px 12px;
    border: 1px solid var(--on-ink-30);
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    cursor: pointer;
  }
  .host-chip.host-on {
    border-color: var(--accent-on-dark);
    background: var(--accent);
    color: var(--chrome-ink);
  }
  .host-btn,
  .host-quiet,
  .host-danger {
    width: 100%;
    padding: 14px 16px;
    border: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.05rem;
    cursor: pointer;
  }
  .host-btn {
    margin-top: 8px;
    background: var(--accent);
    color: var(--chrome-ink);
  }
  .host-quiet {
    background: var(--on-ink-12);
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-weight: 500;
    font-size: var(--fs-body-sm);
  }
  .host-danger {
    background: var(--error);
    color: var(--chrome-ink);
  }
  .host-row {
    display: flex;
    gap: 8px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .host-error {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--error);
  }
</style>
