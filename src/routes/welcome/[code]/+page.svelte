<script lang="ts">
  import type { PageData } from './$types';
  import WelcomeFrame from '$lib/components/welcome/WelcomeFrame.svelte';
  import GoogleButton from '$lib/components/welcome/GoogleButton.svelte';

  let { data }: { data: PageData } = $props();

  const until = $derived(
    data.valid
      ? new Date(data.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
      : '',
  );
</script>

<svelte:head>
  <title>You're invited — Strange Ramblings</title>
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<WelcomeFrame isOwner={data.isOwner} reach={data.navReach}>
  {#if data.valid}
    <header class="w-hero">
      <p class="w-kicker">An invitation</p>
      <h1 class="w-title">{data.name ? `Hello, ${data.name.split(/\s+/)[0]}.` : 'Hello.'}</h1>
      <p class="w-lede">{data.inviter} has invited you to strange ramblings.</p>
    </header>

    {#if data.gets.length}
      <section class="w-card" data-card="gets">
        <div class="w-card-hd"><h2>What you get</h2></div>
        <ul class="gets">
          {#each data.gets as g}
            <li>
              <strong>{g.label}</strong>
              {#if g.description}<span>{g.description}</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="w-card" data-card="accept">
      <div class="w-card-hd"><span class="w-num">01</span><h2>Sign in with Google</h2></div>
      <p>
        {#if data.forEmail}
          This invite is for <strong>{data.forEmail}</strong> — sign in with that Google account.
        {:else}
          Use whichever Google account you'd like to sign in with from now on.
        {/if}
        After that you'll set up the iPhone app.
      </p>
      <GoogleButton callbackUrl="/welcome" label="Accept with Google" />
      <p class="w-note">The link works once and expires on {until}.</p>
    </section>
  {:else}
    <header class="w-hero">
      <p class="w-kicker">Invitation</p>
      <h1 class="w-title">This link has run out.</h1>
      <p class="w-lede">
        It may have been used already, or expired. If you've already accepted it, just sign in. Otherwise ask John
        for a new one — or ask for access below.
      </p>
    </header>

    <section class="w-card" data-card="signin">
      <div class="w-card-hd"><h2>Already accepted?</h2></div>
      <GoogleButton callbackUrl="/welcome" />
    </section>

    <div class="w-row">
      <a class="w-btn ghost" href="/welcome#request">Ask for access</a>
    </div>
  {/if}
</WelcomeFrame>

<style>
  .gets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .gets li { display: flex; flex-direction: column; gap: 0.15rem; font-size: var(--fs-body); }
  .gets strong { color: var(--text-primary); }
  .gets span { color: var(--text-secondary); font-size: var(--fs-body-sm); }
</style>
