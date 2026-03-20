<svelte:head><title>Admin Login — Strange Ramblings</title></svelte:head>
<script lang="ts">
  let password = $state('');
  let errorMsg = $state('');
  let loading = $state(false);

  async function handleLogin() {
    loading = true;
    errorMsg = '';

    try {
      const res = await window.fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.replace('/admin');
      } else {
        errorMsg = data.error || 'Invalid password';
        loading = false;
      }
    } catch (e) {
      errorMsg = 'Request failed';
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center p-8">
  <div class="w-full max-w-xs">
    <h1
      class="text-[10px] uppercase tracking-[0.3em] mb-6"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Admin
    </h1>
    {#if errorMsg}
      <p class="text-sm mb-4" style="color: #8b3a1a;">{errorMsg}</p>
    {/if}
    <input
      type="password"
      bind:value={password}
      placeholder="Password"
      onkeydown={(e) => { if (e.key === 'Enter') handleLogin(); }}
      class="w-full p-3 rounded-lg border text-sm"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    />
    <button
      onclick={handleLogin}
      disabled={loading}
      class="w-full mt-4 p-3 rounded-lg text-[10px] uppercase tracking-[0.2em] transition-colors"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >{loading ? 'Logging in...' : 'Login'}</button>
  </div>
</div>
