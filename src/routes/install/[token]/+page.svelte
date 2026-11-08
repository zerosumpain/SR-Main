<script lang="ts">
  // The install page a phone without TestFlight is sent to: one button, and
  // what to do when iOS asks whether to trust it.
  import WelcomeFrame from '$lib/components/welcome/WelcomeFrame.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const listed = $derived(data.enrolled ? (data.build?.devices ?? []).includes(data.enrolled) : true);
</script>

<svelte:head>
  <title>Install SR — Strange Ramblings</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<WelcomeFrame isOwner={false}>
  <header class="w-hero">
    <p class="w-kicker">The iPhone app</p>
    <h1 class="w-title">Install SR</h1>
    <p class="w-lede">Open this page on the iPhone itself, in Safari.</p>
  </header>

  {#if data.enrolled}
    <section class="w-card" data-card="enrolled">
      <p class="w-done" role="status">
        Got it — {data.enrolled} is on the list.
        {#if !listed}A copy that installs on it is being built; that takes about half an hour. Come back to this page then.{/if}
      </p>
    </section>
  {/if}

  <section class="w-card" data-card="install">
    <div class="w-card-hd"><h2>{data.install ? 'Install' : 'Not ready yet'}</h2></div>
    {#if data.build === undefined}
      <p class="w-error" role="alert">The app cannot be fetched right now. Try again in a few minutes.</p>
    {:else if data.install && data.build}
      <p>Version {data.build.version}, built {when(data.build.builtAt)}. It installs on: {data.build.devices.join(', ') || 'the listed phones'}.</p>
      <div class="w-row"><a class="w-btn" href={data.install} data-action="install">Install the app</a></div>
      {#if data.running}<p>A newer copy is being built. Installing now is fine; this page will offer the new one when it is ready.</p>{/if}
    {:else}
      <p>{data.running ? 'The first copy is being built — about half an hour. Come back to this page then.' : 'No copy has been built yet. Ask John to start one.'}</p>
    {/if}
  </section>

  <section class="w-card" data-card="trust">
    <div class="w-card-hd"><h2>After you tap Install</h2></div>
    <ol class="how">
      <li><span class="w-num">01</span><span>Tap Install when the phone asks. Nothing happens here — iOS installs in the background. Go to the Home Screen and wait for the SR icon's progress ring to finish, up to a minute or two. An update replaces the app you have.</span></li>
      <li><span class="w-num">02</span><span>If it says “Unable to install”, this phone is not in this copy yet — wait for the next one.</span></li>
      <li><span class="w-num">03</span><span>The first time, it says “Developer Mode required”: Settings → Privacy &amp; Security → Developer Mode (at the bottom) → on, restart, then confirm Turn On.</span></li>
      <li><span class="w-num">04</span><span>Open it and sign in with your Apple ID. That is how the app knows it is yours.</span></li>
    </ol>
  </section>
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
</style>
