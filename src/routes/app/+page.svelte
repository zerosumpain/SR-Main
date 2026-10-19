<script lang="ts">
  // strangeramblings.com/app: install, or the newest copy, for a family phone.
  import WelcomeFrame from '$lib/components/welcome/WelcomeFrame.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
</script>

<svelte:head>
  <title>SR for iPhone — Strange Ramblings</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<WelcomeFrame isOwner={false}>
  <header class="w-hero">
    <p class="w-kicker">The iPhone app</p>
    <h1 class="w-title">{data.known ? `SR for ${data.name}` : 'SR for iPhone'}</h1>
    {#if !data.known}
      <p class="w-lede">This is where John's family gets the app. Open the link John sent you on your iPhone, in Safari, and this page will know it's you.</p>
    {/if}
  </header>

  {#if data.known}
    {#if data.added}
      <section class="w-card" data-card="added">
        <p class="w-done" role="status">
          Got it — {data.added} is on the list.
          {#if !data.included}It's being built for your phone now: about half an hour. Come back to this page then.{/if}
        </p>
      </section>
    {/if}

    <section class="w-card" data-card="install">
      {#if data.build === undefined}
        <p class="w-error" role="alert">The app cannot be fetched right now. Try again in a few minutes.</p>
      {:else if data.install && data.build && data.included}
        <div class="w-card-hd"><h2>Ready</h2></div>
        <p>Version {data.build.version}, built {when(data.build.builtAt)}.</p>
        <div class="w-row"><a class="w-btn" href={data.install} data-action="install">Install the app</a></div>
        <p>Tap <strong>Install</strong> when the phone asks; the app appears on your Home Screen. Already have it? This updates it, and keeps you signed in. The app also tells you when a new version is ready.</p>
        <p data-note="wait">
          <strong>Nothing seems to happen?</strong> It is working: iOS installs in the background, with no message here.
          Go to the Home Screen and watch the SR icon — a small progress ring, for up to a minute or two. Open it once the
          ring has gone.
        </p>
        <p data-note="developer-mode">
          <strong>The first time</strong>, the app says <em>Developer Mode required</em>: iOS asks that of any app not from
          the App Store or TestFlight. Open <strong>Settings → Privacy &amp; Security → Developer Mode</strong> (right at the
          bottom), turn it on, let the phone restart, and confirm <strong>Turn On</strong>. Once is enough.
        </p>
      {:else if data.running}
        <div class="w-card-hd"><h2>Being built</h2></div>
        <p>A copy for your phone is being built — about half an hour. Come back to this page then.</p>
      {:else}
        <div class="w-card-hd"><h2>Not ready for your phone</h2></div>
        <p>The newest copy does not include your phone yet. Open the link John sent you again and do the profile step, or ask John.</p>
      {/if}
    </section>
  {/if}
</WelcomeFrame>
