<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import QRCode from 'qrcode';

  let { channelId }: { channelId: string } = $props();

  type Tab = 'connection' | 'settings' | 'send';
  let activeTab: Tab = $state('connection');

  // Connection state
  let connectionStatus: string = $state('disconnected');
  let qrCode: string | null = $state(null);
  let qrDataUri: string | null = $state(null);
  let connectedNumber: string | null = $state(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let connecting = $state(false);

  // Settings state (channel-scoped)
  let allowedNumbers: string[] = $state([]);
  let defaultRecipient: string = $state('');
  let authDir: string = $state('data/whatsapp-auth');
  let channelName: string = $state('');
  let enabled: boolean = $state(true);
  let newNumber: string = $state('');
  let settingsLoaded = $state(false);
  let settingsSaving = $state(false);

  // Send-test state
  let testTo: string = $state('');
  let testMessage: string = $state('Test message from JKAI');
  let testSending = $state(false);
  let testResult: { sent: boolean; error?: string; messageId?: string } | null = $state(null);

  const statusColors: Record<string, string> = {
    connected: '#22c55e',
    qr_pending: '#f59e0b',
    connecting: '#f59e0b',
    disconnected: '#666',
  };

  const statusLabels: Record<string, string> = {
    connected: 'Connected',
    qr_pending: 'Waiting for QR scan',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
  };

  async function fetchStatus() {
    try {
      const res = await fetch('/api/workflows/whatsapp/status');
      if (!res.ok) return;
      const data = await res.json();
      connectionStatus = data.status;
      connectedNumber = data.connectedNumber;

      if (data.qrCode && data.qrCode !== qrCode) {
        qrCode = data.qrCode;
        qrDataUri = await QRCode.toDataURL(data.qrCode, {
          width: 200,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
        });
      } else if (!data.qrCode) {
        qrCode = null;
        qrDataUri = null;
      }

      if (data.status === 'connected') {
        connecting = false;
        stopPolling();
      }
    } catch {
      // Silently fail — next poll will retry
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(fetchStatus, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function handleConnect() {
    connecting = true;
    try {
      await fetch('/api/workflows/whatsapp/connect', { method: 'POST' });
      startPolling();
      await fetchStatus();
    } catch {
      connecting = false;
    }
  }

  async function handleDisconnect() {
    await fetch('/api/workflows/whatsapp/connect', { method: 'DELETE' });
    connectionStatus = 'disconnected';
    connectedNumber = null;
    qrCode = null;
    qrDataUri = null;
    connecting = false;
    stopPolling();
  }

  async function loadSettings() {
    try {
      const res = await fetch(`/api/channels/${channelId}`);
      if (!res.ok) return;
      const { channel } = await res.json();
      channelName = channel.name || '';
      enabled = Boolean(channel.enabled);
      const cfg = (channel.config || {}) as Record<string, unknown>;
      allowedNumbers = Array.isArray(cfg.allowedNumbers) ? (cfg.allowedNumbers as string[]) : [];
      defaultRecipient = typeof cfg.defaultRecipient === 'string' ? cfg.defaultRecipient : '';
      authDir = typeof cfg.authDir === 'string' ? cfg.authDir : 'data/whatsapp-auth';
      settingsLoaded = true;
    } catch {
      // empty defaults
    }
  }

  async function saveSettings() {
    settingsSaving = true;
    try {
      await fetch(`/api/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: channelName,
          enabled,
          config: { allowedNumbers, defaultRecipient, authDir },
        }),
      });
    } finally {
      settingsSaving = false;
    }
  }

  function addNumber() {
    const cleaned = newNumber.trim();
    if (!cleaned) return;
    const formatted = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
    if (!allowedNumbers.includes(formatted)) {
      allowedNumbers = [...allowedNumbers, formatted];
    }
    newNumber = '';
  }

  function removeNumber(num: string) {
    allowedNumbers = allowedNumbers.filter((n) => n !== num);
  }

  function formatPhone(num: string): string {
    const digits = num.replace(/^\+/, '');
    if (digits.length >= 10) {
      const cc = digits.length > 10 ? digits.slice(0, digits.length - 10) : digits.slice(0, digits.length - 9);
      const rest = digits.slice(cc.length);
      return `+${cc} ${rest.slice(0, 4)} ${rest.slice(4)}`;
    }
    return num;
  }

  async function sendTest() {
    testSending = true;
    testResult = null;
    try {
      const res = await fetch(`/api/channels/${channelId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo, message: testMessage }),
      });
      testResult = await res.json();
    } catch (err) {
      testResult = { sent: false, error: err instanceof Error ? err.message : 'Send failed' };
    } finally {
      testSending = false;
    }
  }

  onMount(() => {
    fetchStatus();
    loadSettings();
    if (connectionStatus === 'qr_pending' || connectionStatus === 'connecting') {
      startPolling();
    }
  });

  onDestroy(() => {
    stopPolling();
  });

  $effect(() => {
    if (activeTab === 'connection' && (connectionStatus === 'qr_pending' || connecting)) {
      startPolling();
    } else if (activeTab !== 'connection') {
      stopPolling();
    }
  });
</script>

<!-- Tabs -->
<div class="flex border-b mb-4" style="border-color: var(--card-border);">
  <button
    onclick={() => { activeTab = 'connection'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'connection' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'connection' ? 'var(--accent)' : 'transparent'};"
  >Connection</button>
  <button
    onclick={() => { activeTab = 'settings'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'settings' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'settings' ? 'var(--accent)' : 'transparent'};"
  >Settings</button>
  <button
    onclick={() => { activeTab = 'send'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'send' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'send' ? 'var(--accent)' : 'transparent'};"
  >Send test</button>
</div>

<!-- Connection Tab -->
{#if activeTab === 'connection'}
  <div class="space-y-4">
    <div class="flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-round)] border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background: {statusColors[connectionStatus] || '#666'};"></div>
      <span class="text-xs font-medium" style="color: {statusColors[connectionStatus] || '#666'};">
        {statusLabels[connectionStatus] || connectionStatus}
      </span>
      {#if connectedNumber}
        <span class="text-xs ml-auto" style="color: var(--text-ghost);">{formatPhone(connectedNumber)}</span>
      {/if}
    </div>

    {#if connectionStatus === 'qr_pending' && qrDataUri}
      <div class="flex flex-col items-center gap-3">
        <div class="rounded-[var(--radius-round)] overflow-hidden" style="background: white; padding: 8px;">
          <img src={qrDataUri} alt="WhatsApp QR Code" width="200" height="200" />
        </div>
        <p class="text-[11px] text-center" style="color: var(--text-ghost);">
          Open WhatsApp &rarr; Linked Devices &rarr; Link a Device
        </p>
      </div>
    {/if}

    {#if connectionStatus === 'disconnected' && !connecting}
      <button
        onclick={handleConnect}
        class="w-full px-3 py-2 rounded text-sm font-medium transition-colors"
        style="background: var(--accent); color: white;"
      >Connect WhatsApp</button>
    {:else if connectionStatus === 'connected'}
      <button
        onclick={handleDisconnect}
        class="w-full px-3 py-2 rounded text-sm transition-colors border"
        style="border-color: #b43232; color: #b43232; background: transparent;"
      >Disconnect</button>
    {:else}
      <button
        onclick={handleDisconnect}
        class="w-full px-3 py-2 rounded text-sm transition-colors border"
        style="border-color: var(--card-border); color: var(--text-ghost); background: transparent;"
      >Cancel</button>
    {/if}
  </div>

{:else if activeTab === 'settings'}
  <div class="space-y-4">
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Channel name
      </label>
      <input
        type="text"
        bind:value={channelName}
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      />
    </div>

    <div class="flex items-center gap-2">
      <input id="ch-enabled" type="checkbox" bind:checked={enabled} />
      <label for="ch-enabled" class="text-xs" style="color: var(--text-secondary);">Enabled</label>
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Allowed Numbers
      </label>
      <p class="text-[10px] mb-2" style="color: var(--text-ghost);">
        {#if allowedNumbers.length === 0}
          No numbers set — all numbers will be accepted.
        {:else}
          Only these numbers can chat with the orchestrator via WhatsApp.
        {/if}
      </p>

      {#if allowedNumbers.length > 0}
        <div class="flex flex-wrap gap-1.5 mb-2">
          {#each allowedNumbers as num}
            <span class="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);">
              {num}
              <button
                onclick={() => removeNumber(num)}
                class="text-xs hover:opacity-70"
                style="color: var(--text-ghost);"
              >&times;</button>
            </span>
          {/each}
        </div>
      {/if}

      <div class="flex gap-2">
        <input
          type="text"
          bind:value={newNumber}
          placeholder="+447359228511"
          onkeydown={(e) => { if (e.key === 'Enter') addNumber(); }}
          class="flex-1 px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        />
        <button
          onclick={addNumber}
          class="px-3 py-1.5 rounded text-xs font-medium"
          style="background: var(--accent); color: white;"
        >Add</button>
      </div>
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Default recipient (optional)
      </label>
      <input
        type="text"
        bind:value={defaultRecipient}
        placeholder="+447359228511"
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      />
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Auth dir
      </label>
      <input
        type="text"
        bind:value={authDir}
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      />
    </div>

    <button
      onclick={saveSettings}
      disabled={settingsSaving || !settingsLoaded}
      class="w-full px-3 py-2 rounded text-sm font-medium transition-colors"
      style="background: var(--accent); color: white; opacity: {settingsSaving || !settingsLoaded ? 0.7 : 1};"
    >{settingsSaving ? 'Saving...' : 'Save Settings'}</button>
  </div>

{:else if activeTab === 'send'}
  <div class="space-y-4">
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        To (phone number)
      </label>
      <input
        type="text"
        bind:value={testTo}
        placeholder="+447359228511"
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      />
    </div>
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Message
      </label>
      <textarea
        bind:value={testMessage}
        rows="4"
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      ></textarea>
    </div>
    <button
      onclick={sendTest}
      disabled={testSending || !testTo.trim() || !testMessage.trim()}
      class="w-full px-3 py-2 rounded text-sm font-medium"
      style="background: var(--accent); color: white; opacity: {testSending || !testTo.trim() || !testMessage.trim() ? 0.6 : 1};"
    >{testSending ? 'Sending...' : 'Send test message'}</button>

    {#if testResult}
      <div
        class="text-xs px-3 py-2 rounded border"
        style="border-color: {testResult.sent ? '#2d7d46' : '#b43232'}; color: {testResult.sent ? '#2d7d46' : '#b43232'};"
      >
        {#if testResult.sent}
          Sent — message id {testResult.messageId || 'unknown'}
        {:else}
          Failed — {testResult.error || 'unknown error'}
        {/if}
      </div>
    {/if}
  </div>
{/if}
