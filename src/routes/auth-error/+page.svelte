<script lang="ts">
  import { page } from '$app/state';

  const error = page.url.searchParams.get('error') || 'Unknown error';
</script>

<svelte:head>
  <title>Auth Error — Strange Ramblings</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-8" style="background: var(--bg, #ede4d4);">
  <div class="w-full max-w-sm text-center">
    <a href="/" class="brand--mono text-[28px] inline-block mb-8" style="color: var(--text-primary);">sr.</a>

    <h1
      class="text-[10px] uppercase tracking-[0.3em] mb-4"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Access Denied
    </h1>

    <p class="text-sm mb-6" style="color: var(--text-secondary);">
      {#if error === 'AccessDenied'}
        Your account is not authorized to access this site.
      {:else}
        Something went wrong during sign in. Please try again.
      {/if}
    </p>

    <a
      href="/login"
      class="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      Try Again
    </a>
  </div>
</div>
