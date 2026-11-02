<script lang="ts">
  // Where the TV's QR lands a phone: type a code if there is none, sit down by
  // name (or as yourself, signed in), then follow the party (`PlayShell`).
  // On iOS the sr. app is tried first; if it is not installed the page stays
  // and the web form carries on.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PlayShell from '$lib/components/games/play/PlayShell.svelte';
  import { STING } from '$lib/games/kelly';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The seat this browser holds: a join just now, else the load's (unless the stream has since refused it).
  let joinedId = $state<string | null>(null);
  let dropped = $state(false);
  const meId = $derived(joinedId ?? (dropped ? null : (data.me?.id ?? null)));
  let name = $state('');
  let asGuest = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let typedCode = $state('');
  let appTried = $state(false);

  const appUrl = $derived(`sr://games/join/${data.code}`);
  const tvName = $derived(data.party?.tvName ?? 'the TV');
  const gameTitle = $derived(data.party?.games.find((g) => g.id === data.party?.game)?.title ?? null);
  const showFamily = $derived(!!data.family && !asGuest);

  onMount(() => {
    if (!data.ios || data.missing || meId) return;
    // Once per code per tab: a reload after the app was not there goes straight to the form.
    const key = `sr.games.join.app.${data.code}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* private window: try once per load */
    }
    location.href = appUrl;
    // Still here after ~1.2 s: no app, or the person said no. Offer it once more and carry on with the form.
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') appTried = true;
    }, 1200);
    return () => clearTimeout(t);
  });

  async function join(guest: boolean) {
    if (busy) return;
    error = null;
    if (guest && !name.trim()) {
      error = 'Type your name first.';
      return;
    }
    busy = true;
    try {
      const res = await fetch(`/api/games/party/${encodeURIComponent(data.code)}/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(guest ? { name: name.trim(), guest: true } : {}),
      });
      const out = (await res.json().catch(() => null)) as { me?: { id: string }; error?: string } | null;
      if (!res.ok || !out?.me) throw new Error(out?.error ?? 'That did not go through. Try again.');
      joinedId = out.me.id;
      dropped = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'That did not go through. Try again.';
    } finally {
      busy = false;
    }
  }

  function onGuest(e: SubmitEvent) {
    e.preventDefault();
    void join(true);
  }

  function onCode(e: SubmitEvent) {
    e.preventDefault();
    const c = typedCode.trim().toUpperCase().replace(/[^A-Z]/gu, '');
    if (c) void goto(`/games/join/${c}`, { invalidateAll: true });
  }

  function unseated(message: string) {
    joinedId = null;
    dropped = true;
    error = message;
  }
</script>

<svelte:head>
  <title>Join {data.party ? tvName : 'a game'} · sr. games</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#0b0806" />
</svelte:head>

<main class="play-page">
  <div class="play-col">
    {#if data.missing}
      <section class="play-step">
        <p class="play-kicker">sr. games</p>
        <h1 class="play-title">Check the code</h1>
        <p class="play-lead">{data.missing}</p>
        <form class="play-form" onsubmit={onCode}>
          <label class="play-label" for="play-code">Code on the TV</label>
          <input
            id="play-code"
            class="play-input play-code-input"
            bind:value={typedCode}
            maxlength="8"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="ABCD"
          />
          <button class="play-btn" type="submit" disabled={!typedCode.trim()}>Go</button>
        </form>
      </section>
    {:else if meId}
      {#key meId}
        <PlayShell code={data.code} {meId} onUnseated={unseated} />
      {/key}
    {:else}
      <section class="play-step">
        <p class="play-kicker">Join the game on {tvName}</p>
        <h1 class="play-title">{gameTitle ?? 'Play on the TV'}</h1>
        {#if data.party?.members.length}
          <p class="play-lead">With {data.party.members.map((m) => m.name).join(', ')}.</p>
        {/if}
        {#if data.party?.locked}
          <p class="play-error">The TV has locked this game. Ask whoever has the remote.</p>
        {/if}

        {#if appTried}
          <a class="play-app" href={appUrl}>Open in the sr. app</a>
        {/if}

        {#if showFamily}
          <button class="play-btn" type="button" disabled={busy} onclick={() => join(false)}>
            Join as {data.family?.name}
          </button>
          <button class="play-link" type="button" onclick={() => (asGuest = true)}>join as a guest instead</button>
        {:else}
          <form class="play-form" onsubmit={onGuest}>
            <label class="play-label" for="play-name">Your name</label>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              id="play-name"
              class="play-input"
              bind:value={name}
              maxlength="16"
              autocomplete="given-name"
              enterkeyhint="go"
              autofocus
            />
            <button class="play-btn" type="submit" disabled={busy || !name.trim()}>{busy ? 'Joining…' : 'Join'}</button>
          </form>
        {/if}

        {#if error}
          <p class="play-error" role="alert">{error}</p>
        {/if}
      </section>
    {/if}

    <footer class="play-foot">
      <span class="play-mark">sr.</span>
      <span>{STING}</span>
    </footer>
  </div>
</main>

<style>
  .play-page {
    min-height: 100dvh;
    background: var(--chrome-bg);
    color: var(--chrome-ink);
    padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom);
  }
  .play-col {
    max-width: 520px;
    min-height: 100dvh;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }
  .play-step {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 40px 0 24px;
  }
  .play-kicker,
  .play-label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--on-ink-55);
  }
  .play-label {
    margin-top: 8px;
  }
  .play-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2.5rem;
    line-height: 1.02;
    letter-spacing: -0.02em;
  }
  .play-lead {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--on-ink-80);
  }
  .play-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .play-input {
    padding: 14px;
    border: 2px solid var(--on-ink-30);
    border-radius: 2px;
    background: transparent;
    color: var(--chrome-ink);
    font-family: var(--font-body);
    font-size: var(--fs-body);
  }
  .play-input:focus {
    outline: none;
    border-color: var(--accent-on-dark);
  }
  .play-code-input {
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 2rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    text-align: center;
  }
  .play-btn {
    padding: 18px;
    border: 0;
    border-radius: 2px;
    background: var(--accent);
    color: var(--chrome-ink);
    font-family: var(--font-display);
    font-weight: var(--font-display-weight);
    font-size: 1.25rem;
  }
  .play-btn:disabled {
    opacity: 0.45;
  }
  .play-link {
    align-self: center;
    padding: 8px;
    border: 0;
    background: none;
    color: var(--on-ink-70);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .play-app {
    align-self: flex-start;
    padding: 10px 16px;
    border: 2px solid var(--accent-ink);
    border-radius: 100px;
    color: var(--chrome-ink);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-decoration: none;
  }
  .play-error {
    margin: 0;
    padding: 10px 12px;
    border-left: 2px solid var(--error);
    background: var(--on-ink-05);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--chrome-ink);
  }
  .play-foot {
    margin-top: auto;
    padding: 24px 0 16px;
    display: flex;
    gap: 10px;
    align-items: baseline;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--on-ink-45);
  }
  .play-mark {
    font-family: var(--font-brand);
    color: var(--accent-on-dark);
  }
</style>
