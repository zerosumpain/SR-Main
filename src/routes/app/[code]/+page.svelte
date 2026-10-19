<script lang="ts">
  // The link one person is sent: three steps on their iPhone, or a QR code to
  // get there from anywhere else.
  import WelcomeFrame from '$lib/components/welcome/WelcomeFrame.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Get SR — Strange Ramblings</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<WelcomeFrame isOwner={false}>
  <header class="w-hero">
    <p class="w-kicker">The iPhone app</p>
    <h1 class="w-title">Hi {data.name}.</h1>
    <p class="w-lede">Two taps on your iPhone, then the app is built for it.</p>
  </header>

  {#if data.device === 'elsewhere'}
    <section class="w-card" data-card="scan">
      <div class="w-card-hd"><h2>Open this on your iPhone</h2></div>
      <p>Point the iPhone's camera at this, and open the link in Safari.</p>
      {#if data.qr}<img class="qr" src={data.qr} alt="QR code for this link" width="220" height="220" />{/if}
    </section>
  {:else if data.device === 'ios-other'}
    <section class="w-card" data-card="safari">
      <div class="w-card-hd"><h2>Open this in Safari</h2></div>
      <p>This browser cannot pass the profile to Settings. Copy the address below and open it in Safari.</p>
      <code class="link">{data.link}</code>
    </section>
  {:else}
    <section class="w-card" data-card="steps">
      <ol class="how">
        <li>
          <span class="w-num">01</span>
          <span>Tap the button, then <strong>Allow</strong>.</span>
        </li>
        <li>
          <span class="w-num">02</span>
          <span>Open <strong>Settings</strong> → <strong>Profile Downloaded</strong> → <strong>Install</strong>. It only tells the site this phone's ID; nothing stays installed.</span>
        </li>
        <li>
          <span class="w-num">03</span>
          <span>You come back here. The app takes about half an hour to build for your phone — then install it from <strong>strangeramblings.com/app</strong>. The first time it opens, iOS asks you to turn on Developer Mode; that page says how.</span>
        </li>
      </ol>
      <div class="w-row"><a class="w-btn" href="/app/{data.code}/profile" data-action="profile">Get the profile</a></div>
    </section>
  {/if}
</WelcomeFrame>

<style>
  .how {
    list-style: none;
    margin: 0 0 1rem;
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
  .qr { margin-top: 0.75rem; border: 1px solid var(--line-strong); image-rendering: pixelated; }
  .link {
    display: block;
    margin-top: 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    overflow-wrap: anywhere;
    background: var(--bg-section);
    padding: 0.4rem 0.5rem;
    border-radius: 2px;
  }
</style>
