<svelte:head><title>Admin Login — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  let { form } = $props();
</script>

<div class="min-h-screen flex items-center justify-center p-8">
  <form method="POST" use:enhance class="w-full max-w-xs">
    <h1
      class="text-[10px] uppercase tracking-[0.3em] mb-6"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Admin
    </h1>
    {#if form?.error}
      <p class="text-sm mb-4" style="color: #8b3a1a;">{form.error}</p>
    {/if}
    <input
      type="password"
      name="password"
      placeholder="Password"
      class="w-full p-3 rounded-lg border text-sm"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    />
    <button
      type="submit"
      class="w-full mt-4 p-3 rounded-lg text-[10px] uppercase tracking-[0.2em] transition-colors"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      Login
    </button>
  </form>
</div>
