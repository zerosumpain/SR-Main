<script lang="ts">
  // Inside the iPhone app's sign-in sheet: straight on to Google, with the
  // button as the fallback if the hand-off does not start by itself.
  import { onMount } from 'svelte';
  import { signIn } from '@auth/sveltekit/client';
  import WelcomeFrame from '$lib/components/welcome/WelcomeFrame.svelte';
  import GoogleButton from '$lib/components/welcome/GoogleButton.svelte';

  const callbackUrl = '/welcome/app/finish';
  // Google's account chooser, always: a registration never completes silently
  // on an account the browser happens to be signed in to.
  const chooser = { prompt: 'select_account' };
  onMount(() => {
    signIn('google', { callbackUrl }, chooser);
  });
</script>

<svelte:head><title>Sign in — Strange Ramblings</title></svelte:head>

<WelcomeFrame isOwner={false}>
  <header class="w-hero">
    <p class="w-kicker">From the app</p>
    <h1 class="w-title">Ask for an account</h1>
  </header>
  <section class="w-card" data-card="signin">
    <p>Sign in with Google so John knows who you are. You go straight back to the app afterwards.</p>
    <GoogleButton {callbackUrl} authorizationParams={chooser} />
  </section>
</WelcomeFrame>
