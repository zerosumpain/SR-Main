<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';
  import WelcomeFrame from '$lib/components/welcome/WelcomeFrame.svelte';
  import GoogleButton from '$lib/components/welcome/GoogleButton.svelte';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // ── Signed out: the request form ─────────────────────────────────────────
  let sending = $state(false);
  const requestError = $derived(form && 'requestError' in form ? form.requestError : '');
  const badField = $derived(form && 'field' in form ? form.field : null);
  const values = $derived(form && 'values' in form ? form.values : null);
  const requested = $derived(!!(form && 'requested' in form && form.requested));

  // ── Signed in: pairing and sharing ───────────────────────────────────────
  type Pair = { qr: string; code: string; expiresAt: number };
  let pairLocal = $state<Pair | null>(null);
  let pairError = $state('');
  let pairing = $state(false);
  // Without JavaScript the action's result arrives as `form`; with it, the
  // enhance callback keeps it here so a later sharing toggle cannot wipe it.
  const pair = $derived<Pair | null>(pairLocal ?? (form && 'pair' in form ? (form.pair as Pair) : null));

  let sharingLocal = $state<boolean | null>(null);
  let sharingError = $state('');
  let saving = $state(false);
  const sharing = $derived<boolean | null>(
    sharingLocal ?? (form && 'sharing' in form ? (form.sharing as boolean) : data.signedIn ? data.sharing : null),
  );

  // Ticking clock for the code's countdown. The interval handle is a plain
  // `let`, never $state (svelte5-pitfalls §1).
  let now = $state(Date.now());
  $effect(() => {
    if (!pair) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  const left = $derived(pair ? Math.max(0, Math.round((pair.expiresAt - now) / 1000)) : 0);
  const clock = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);

  // Owner-only fourth card: chat & news, through the existing endpoint.
  let sitePair = $state<{ qr: string; code: string; expiresAt: string } | null>(null);
  let sitePairError = $state('');
  let sitePairing = $state(false);
  async function mintSiteCode() {
    sitePairing = true;
    sitePairError = '';
    try {
      const res = await fetch('/api/admin/native-devices', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) sitePairError = body.error ?? 'Could not make a code';
      else sitePair = { qr: body.qr, code: body.code, expiresAt: body.expiresAt };
    } catch {
      sitePairError = 'Network error';
    } finally {
      sitePairing = false;
    }
  }

  const firstName = $derived(data.signedIn ? data.name.split(/\s+/)[0] : '');
</script>

<svelte:head>
  <title>Welcome — Strange Ramblings</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<WelcomeFrame isOwner={data.isOwner} reach={data.navReach}>
  {#if !data.signedIn}
    <header class="w-hero">
      <p class="w-kicker">Welcome</p>
      <h1 class="w-title">Come on in.</h1>
      <p class="w-lede">
        strange ramblings is John's corner of the internet — and, for family and friends, the home of the SR iPhone
        app and the family map. Getting in takes a couple of minutes.
      </p>
    </header>

    <ol class="how" aria-label="How it works">
      <li><span class="w-num">01</span><span>Ask for access, or open the invite link John sent you.</span></li>
      <li><span class="w-num">02</span><span>Sign in with Google, using the same address.</span></li>
      <li><span class="w-num">03</span><span>Come back here to set up the app.</span></li>
    </ol>

    <section class="w-card" data-card="signin">
      <div class="w-card-hd"><h2>Invited or approved?</h2></div>
      <p>Sign in with the Google account John knows about, and you'll land back here to get set up.</p>
      <GoogleButton callbackUrl="/welcome" />
    </section>

    <section class="w-card" data-card="request" id="request">
      <div class="w-card-hd"><h2>Ask for access</h2></div>
      {#if requested}
        <p class="w-done" role="status">
          Thanks — John has your request. When he says yes, come back to this page and sign in with Google.
        </p>
      {:else}
        <p>John reads every one. Use the Google address you'll sign in with.</p>
        <form
          method="POST"
          action="?/request"
          class="request"
          use:enhance={() => {
            sending = true;
            return async ({ update }) => {
              await update({ reset: false });
              sending = false;
            };
          }}
        >
          <label class="w-field">
            <span>Your name</span>
            <input
              class="w-input"
              name="name"
              autocomplete="name"
              required
              maxlength="80"
              value={values?.name ?? ''}
              aria-invalid={badField === 'name'}
            />
          </label>
          <label class="w-field">
            <span>Google email</span>
            <input
              class="w-input"
              type="email"
              name="email"
              autocomplete="email"
              inputmode="email"
              required
              maxlength="254"
              value={values?.email ?? ''}
              aria-invalid={badField === 'email'}
            />
          </label>
          <label class="w-field">
            <span>What's it for? (optional)</span>
            <textarea class="w-input" name="message" maxlength="1000" aria-invalid={badField === 'message'}
              >{values?.message ?? ''}</textarea
            >
          </label>
          <label class="w-check">
            <input type="checkbox" name="app" checked />
            I'd like the iPhone app
          </label>
          <!-- A field no person sees; a bot that fills it is thanked and ignored. -->
          <label class="hp" aria-hidden="true">
            Website <input name="website" tabindex="-1" autocomplete="off" />
          </label>
          {#if requestError}<p class="w-error" role="alert">{requestError}</p>{/if}
          <div class="w-row">
            <button class="w-btn" disabled={sending}>{sending ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      {/if}
    </section>
  {:else}
    <header class="w-hero">
      <p class="w-kicker">Welcome, {firstName}</p>
      <h1 class="w-title">Let's get you set up.</h1>
      <p class="w-lede">Three steps, about five minutes. Your phone does the rest.</p>
    </header>

    <!-- 01 Install -->
    <section class="w-card" data-step="install">
      <div class="w-card-hd"><span class="w-num">01</span><h2>Install the app</h2></div>
      <p>SR is in beta, so it comes through Apple's TestFlight app rather than the App Store.</p>
      {#if data.testflightUrl}
        <div class="w-row">
          <a class="w-btn" href={data.testflightUrl} target="_blank" rel="noopener">Open TestFlight</a>
        </div>
        <p class="w-note">On your iPhone: install TestFlight first if it asks, then tap Install.</p>
      {:else}
        <p class="w-note">Ask John for a TestFlight invite — it goes to {data.email}.</p>
      {/if}
    </section>

    <!-- 02 Pair -->
    <section class="w-card" class:is-locked={!data.canPair} data-step="pair">
      <div class="w-card-hd"><span class="w-num">02</span><h2>Pair your phone</h2></div>
      {#if !data.canPair}
        <p>Ask John to add you to Family Circle — this step unlocks as soon as he does.</p>
      {:else}
        <p>Open the app, tap <strong>Pair</strong>, and point your camera at the code.</p>
        {#if pair && left > 0}
          <div class="qr">
            <img src={pair.qr} alt="Pairing code for the SR app" width="260" height="260" />
          </div>
          <div class="code-row">
            <span class="w-note">Or type</span>
            <code class="code">{pair.code}</code>
          </div>
          <p class="w-note" aria-live="polite">Good for {clock}</p>
        {:else if pair}
          <p class="w-note">That code has expired.</p>
        {/if}
        {#if pairError}<p class="w-error" role="alert">{pairError}</p>{/if}
        <form
          method="POST"
          action="?/pair"
          use:enhance={() => {
            pairing = true;
            pairError = '';
            return async ({ result }) => {
              if (result.type === 'success' && result.data?.pair) {
                pairLocal = result.data.pair as Pair;
                now = Date.now();
              } else if (result.type === 'failure') {
                pairError = String(result.data?.pairError ?? 'That did not work.');
              } else if (result.type === 'error') {
                pairError = 'That did not work.';
              }
              pairing = false;
            };
          }}
        >
          <div class="w-row">
            <button class={pair ? 'w-btn ghost' : 'w-btn'} disabled={pairing}>
              {pairing ? 'Making a code…' : pair ? 'New code' : 'Show my pairing code'}
            </button>
          </div>
        </form>
      {/if}
    </section>

    <!-- 03 Location sharing -->
    <section class="w-card" class:is-locked={!data.canPair} data-step="sharing">
      <div class="w-card-hd"><span class="w-num">03</span><h2>Location sharing</h2></div>
      {#if !data.canPair}
        <p>Once you're in Family Circle, you can choose whether the family map shows where you are.</p>
      {:else}
        <p>
          When it's on, the family map shows where you are and your journeys land in your own history. When it's
          off, your phone sends nothing. Change it here or in the app, any time.
        </p>
        <p class="w-note" data-sharing={sharing === null ? 'unknown' : sharing ? 'on' : 'off'}>
          {sharing === null ? 'Not set yet' : sharing ? 'Sharing is on' : 'Sharing is off'}
        </p>
        {#if sharingError}<p class="w-error" role="alert">{sharingError}</p>{/if}
        <form
          method="POST"
          action="?/sharing"
          use:enhance={() => {
            saving = true;
            sharingError = '';
            return async ({ result }) => {
              if (result.type === 'success' && typeof result.data?.sharing === 'boolean') {
                sharingLocal = result.data.sharing;
              } else if (result.type === 'failure') {
                sharingError = String(result.data?.sharingError ?? 'That did not work.');
              } else if (result.type === 'error') {
                sharingError = 'That did not work.';
              }
              saving = false;
            };
          }}
        >
          <input type="hidden" name="enabled" value={sharing ? 'false' : 'true'} />
          <div class="w-row">
            <button class={sharing ? 'w-btn ghost' : 'w-btn'} disabled={saving}>
              {saving ? 'Saving…' : sharing ? 'Turn sharing off' : 'Turn sharing on'}
            </button>
          </div>
        </form>
      {/if}
    </section>

    {#if data.isOwner}
      <!-- 04 Chat & news (owners) -->
      <section class="w-card" data-step="chat">
        <div class="w-card-hd"><span class="w-num">04</span><h2>Chat &amp; news</h2></div>
        <p>
          A second pairing, with this site, for the app's chat and news tabs. In the app: Settings → Pair with the
          site.
        </p>
        {#if sitePair}
          <div class="qr"><img src={sitePair.qr} alt="Chat and news pairing code" width="260" height="260" /></div>
          <div class="code-row">
            <span class="w-note">Or type</span>
            <code class="code">{sitePair.code}</code>
          </div>
        {/if}
        {#if sitePairError}<p class="w-error" role="alert">{sitePairError}</p>{/if}
        <div class="w-row">
          <button class={sitePair ? 'w-btn ghost' : 'w-btn'} onclick={mintSiteCode} disabled={sitePairing}>
            {sitePairing ? 'Making a code…' : sitePair ? 'New code' : 'Show a code'}
          </button>
          <a class="w-note" href="/admin/access/devices">All paired devices →</a>
        </div>
      </section>
    {/if}
  {/if}
</WelcomeFrame>

<style>
  .how {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .how li {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    font-size: var(--fs-body);
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .request { display: flex; flex-direction: column; gap: 0.9rem; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .qr {
    align-self: center;
    border: 1px solid var(--line-strong);
    padding: 0.5rem;
    background: var(--bg);
    line-height: 0;
  }
  .qr img { width: min(260px, 70vw); height: auto; image-rendering: pixelated; }
  .code-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.6rem; justify-content: center; }
  .code {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    letter-spacing: 0.08em;
    padding: 0.3rem 0.55rem;
    background: var(--bg);
    border: 1px solid var(--divider);
    border-radius: var(--radius-sharp);
    overflow-wrap: anywhere;
    user-select: all;
  }
</style>
