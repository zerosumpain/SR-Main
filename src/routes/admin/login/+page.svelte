<svelte:head><title>Admin Login — Strange Ramblings</title></svelte:head>
<script lang="ts">
  let password = $state('');
  let errorMsg = $state('');
  let loading = $state(false);
  let debugInfo = $state('');

  async function handleLogin() {
    loading = true;
    errorMsg = '';
    debugInfo = 'Sending request...';

    try {
      const res = await window.fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      debugInfo = `Response: ${res.status} ${res.statusText}`;

      const text = await res.text();
      debugInfo += ` | Body: ${text}`;

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        errorMsg = 'Invalid response from server';
        loading = false;
        return;
      }

      if (res.ok && data.success) {
        debugInfo += ' | Redirecting...';
        document.location.href = '/admin';
        return;
      } else {
        errorMsg = data.error || `Login failed (${res.status})`;
        loading = false;
      }
    } catch (e) {
      debugInfo = `Fetch error: ${e}`;
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
    {#if debugInfo}
      <p class="text-[10px] mb-4 break-all" style="color: var(--text-ghost); font-family: var(--font-mono);">{debugInfo}</p>
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
