<svelte:head><title>Admin Login — Strange Ramblings</title></svelte:head>
<script lang="ts">
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    loading = true;
    error = '';

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = '/admin';
    } else {
      const data = await res.json();
      error = data.error || 'Invalid password';
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-8">
  <form onsubmit={handleLogin} class="w-full max-w-xs">
    <h1
      class="text-[10px] uppercase tracking-[0.3em] mb-6"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Admin
    </h1>
    {#if error}
      <p class="text-sm mb-4" style="color: #8b3a1a;">{error}</p>
    {/if}
    <input
      type="password"
      bind:value={password}
      placeholder="Password"
      class="w-full p-3 rounded-lg border text-sm"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    />
    <button
      type="submit"
      disabled={loading}
      class="w-full mt-4 p-3 rounded-lg text-[10px] uppercase tracking-[0.2em] transition-colors"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >{loading ? 'Logging in...' : 'Login'}</button>
  </form>
</div>
