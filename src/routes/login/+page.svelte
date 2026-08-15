<script lang="ts">
  import { signIn } from '@auth/sveltekit/client';
  import { page } from '$app/stores';
  import SiteFooter from '$lib/components/SiteFooter.svelte';

  let loading = $state(false);

  function handleSignIn() {
    loading = true;
    const callbackUrl = $page.url.searchParams.get('callbackUrl') || '/';
    signIn('google', { callbackUrl });
  }
</script>

<svelte:head>
  <title>Sign In — Strange Ramblings</title>
</svelte:head>

<div class="min-h-screen flex flex-col" style="background: var(--bg);">
  <div class="flex-1 flex items-center justify-center p-8">
    <div class="w-full max-w-xs text-center">
      <a href="/" class="brand text-[22px] inline-flex mb-8 justify-center">strange ramblings</a>

      <h1
        class="text-[10px] uppercase tracking-[0.3em] mb-8"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Sign In
      </h1>

      <button
        onclick={handleSignIn}
        disabled={loading}
        class="w-full p-3 text-sm font-medium transition-colors flex items-center justify-center gap-3 border"
        style="background: var(--card-bg); border-color: var(--line-strong); color: var(--text-primary); border-radius: var(--radius-sharp);"
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {loading ? 'Redirecting...' : 'Continue with Google'}
      </button>

      <p class="mt-6 text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Access restricted to authorized accounts
      </p>
    </div>
  </div>

  <SiteFooter variant="compact" />
</div>
