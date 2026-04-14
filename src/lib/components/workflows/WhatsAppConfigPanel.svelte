<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import BasicConfigRenderer from './BasicConfigRenderer.svelte';
  import type { BasicConfigField } from '$lib/workflows/types';

  let {
    fields,
    config,
    variables = [],
    showAdvanced = false,
    onConfigChange,
  }: {
    fields: BasicConfigField[];
    config: Record<string, unknown>;
    variables: { path: string; type: string; description?: string }[];
    showAdvanced: boolean;
    onConfigChange: (config: Record<string, unknown>) => void;
  } = $props();

  type Tab = 'connection' | 'settings' | 'send';
  let activeTab: Tab = $state('connection');

  // Connection state
  let connectionStatus: string = $state('disconnected');
  let qrCode: string | null = $state(null);
  let qrDataUri: string | null = $state(null);
  let connectedNumber: string | null = $state(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let connecting = $state(false);

  // Settings state
  let allowedNumbers: string[] = $state([]);
  let soulMd: string = $state('');
  let newNumber: string = $state('');
  let settingsLoaded = $state(false);
  let settingsSaving = $state(false);

  // Status indicator colors
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
      const res = await fetch('/api/workflows/whatsapp/config');
      if (!res.ok) return;
      const data = await res.json();
      allowedNumbers = Array.isArray(data.allowedNumbers) ? data.allowedNumbers : [];
      soulMd = data.soulMd || '';
      settingsLoaded = true;
    } catch {
      // Will show empty defaults
    }
  }

  async function saveSettings() {
    settingsSaving = true;
    try {
      await fetch('/api/workflows/whatsapp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedNumbers, soulMd }),
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

  onMount(() => {
    fetchStatus();
    if (connectionStatus === 'qr_pending' || connectionStatus === 'connecting') {
      startPolling();
    }
  });

  onDestroy(() => {
    stopPolling();
  });

  $effect(() => {
    if (activeTab === 'settings' && !settingsLoaded) {
      loadSettings();
    }
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
<div class="flex border-b -mx-5 -mt-1 mb-4" style="border-color: var(--card-border);">
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
  >Send</button>
</div>

<!-- Connection Tab -->
{#if activeTab === 'connection'}
  <div class="space-y-4">
    <!-- Status Banner -->
    <div class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
      <div class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background: {statusColors[connectionStatus] || '#666'};"></div>
      <span class="text-xs font-medium" style="color: {statusColors[connectionStatus] || '#666'};">
        {statusLabels[connectionStatus] || connectionStatus}
      </span>
      {#if connectedNumber}
        <span class="text-xs ml-auto" style="color: var(--text-ghost);">{formatPhone(connectedNumber)}</span>
      {/if}
    </div>

    <!-- QR Code (when qr_pending) -->
    {#if connectionStatus === 'qr_pending' && qrDataUri}
      <div class="flex flex-col items-center gap-3">
        <div class="rounded-lg overflow-hidden" style="background: white; padding: 8px;">
          <img src={qrDataUri} alt="WhatsApp QR Code" width="200" height="200" />
        </div>
        <p class="text-[11px] text-center" style="color: var(--text-ghost);">
          Open WhatsApp &rarr; Linked Devices &rarr; Link a Device
        </p>
      </div>
    {/if}

    <!-- Action Button -->
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

<!-- Settings Tab -->
{:else if activeTab === 'settings'}
  <div class="space-y-4">
    <!-- Allowed Numbers -->
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

      <!-- Number pills -->
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

      <!-- Add number input -->
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

    <!-- Soul.md -->
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Soul.md
      </label>
      <p class="text-[10px] mb-2" style="color: var(--text-ghost);">
        Personality and style guide appended to the orchestrator's system prompt for WhatsApp conversations.
      </p>
      <textarea
        bind:value={soulMd}
        class="w-full px-2 py-1.5 rounded text-xs border resize-vertical"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 120px;"
        rows="8"
      ></textarea>
    </div>

    <!-- Save Button -->
    <button
      onclick={saveSettings}
      disabled={settingsSaving}
      class="w-full px-3 py-2 rounded text-sm font-medium transition-colors"
      style="background: var(--accent); color: white; opacity: {settingsSaving ? 0.7 : 1};"
    >{settingsSaving ? 'Saving...' : 'Save Settings'}</button>
  </div>

<!-- Send Tab -->
{:else if activeTab === 'send'}
  <BasicConfigRenderer
    {fields}
    {config}
    {variables}
    {showAdvanced}
    {onConfigChange}
  />
{/if}
