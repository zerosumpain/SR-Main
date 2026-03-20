<svelte:head><title>Biome Settings — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import type { BiomeSettings } from '$lib/biome/settings';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');
  const biomeStore = getContext<BiomeStore>('biomeStore');

  let settings = $state<BiomeSettings>({ ...data.settings });

  // Live preview — push settings to the biome store as they change
  $effect(() => {
    if (biomeStore) {
      biomeStore.settings = { ...settings };
    }
  });
  let saving = $state(false);
  let saveSuccess = $state(false);
  let saveError = $state<string | null>(null);

  const booleanFields: { key: keyof BiomeSettings; label: string }[] = [
    { key: 'weatherEffects', label: 'Weather Effects' },
    { key: 'connectionLines', label: 'Connection Lines' },
    { key: 'dreamMode', label: 'Dream Mode' },
    { key: 'bloodVessel', label: 'Blood Vessel' },
    { key: 'shudderEffect', label: 'Shudder Effect' },
    { key: 'combinationEffects', label: 'Combination Effects' },
  ];

  function toggleBool(key: keyof BiomeSettings) {
    const current = settings[key] as unknown as boolean;
    (settings as unknown as Record<string, unknown>)[key] = !current;
  }

  async function save() {
    saving = true;
    saveSuccess = false;
    saveError = null;
    try {
      const res = await fetch(`/api/biome/config?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        saveError = body.error ?? `Error ${res.status}`;
      } else {
        saveSuccess = true;
        setTimeout(() => (saveSuccess = false), 3000);
      }
    } catch {
      saveError = 'Network error';
    } finally {
      saving = false;
    }
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-10">
    <a
      href="/admin?token={adminToken}"
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      &larr; Admin
    </a>
    <h1
      class="text-[10px] uppercase tracking-[0.3em]"
      style="color: var(--text-ghost); font-family: var(--font-mono);"
    >
      Biome Settings
    </h1>
  </div>

  <p class="text-[9px] mb-6" style="color: var(--text-whisper); font-family: var(--font-mono);">
    Changes preview live in the background. Save to persist.
  </p>

  {#if saveSuccess}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    >
      Settings saved.
    </div>
  {/if}

  {#if saveError}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
    >
      {saveError}
    </div>
  {/if}

  <div class="space-y-4">
    <!-- Numeric sliders card -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-[10px] uppercase tracking-[0.25em] mb-5"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Intensity
      </p>

      <div class="space-y-5">
        <!-- Pulse Intensity -->
        <div>
          <div class="flex justify-between mb-1">
            <label
              class="text-[10px] uppercase tracking-[0.2em]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
              for="pulseIntensity"
            >
              Pulse Intensity
            </label>
            <span
              class="text-[10px]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              {settings.pulseIntensity}
            </span>
          </div>
          <input
            id="pulseIntensity"
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={settings.pulseIntensity}
            class="w-full"
          />
        </div>

        <!-- Particle Density -->
        <div>
          <div class="flex justify-between mb-1">
            <label
              class="text-[10px] uppercase tracking-[0.2em]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
              for="particleDensity"
            >
              Particle Density
            </label>
            <span
              class="text-[10px]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              {settings.particleDensity.toFixed(2)}
            </span>
          </div>
          <input
            id="particleDensity"
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            bind:value={settings.particleDensity}
            class="w-full"
          />
        </div>

        <!-- Fog Intensity -->
        <div>
          <div class="flex justify-between mb-1">
            <label
              class="text-[10px] uppercase tracking-[0.2em]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
              for="fogIntensity"
            >
              Fog Intensity
            </label>
            <span
              class="text-[10px]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              {settings.fogIntensity.toFixed(2)}
            </span>
          </div>
          <input
            id="fogIntensity"
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            bind:value={settings.fogIntensity}
            class="w-full"
          />
        </div>

        <!-- Blood Flow Rate -->
        <div>
          <div class="flex justify-between mb-1">
            <label
              class="text-[10px] uppercase tracking-[0.2em]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
              for="bloodFlowRate"
            >
              Blood Flow Rate
            </label>
            <span
              class="text-[10px]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              {settings.bloodFlowRate}
            </span>
          </div>
          <input
            id="bloodFlowRate"
            type="range"
            min="0"
            max="100"
            step="1"
            bind:value={settings.bloodFlowRate}
            class="w-full"
          />
        </div>
      </div>
    </div>

    <!-- Toggles card -->
    <div
      class="p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-[10px] uppercase tracking-[0.25em] mb-5"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        Effects
      </p>

      <div class="space-y-4">
        {#each booleanFields as { key, label }}
          <div class="flex items-center justify-between">
            <span
              class="text-[10px] uppercase tracking-[0.2em]"
              style="color: var(--text-ghost); font-family: var(--font-mono);"
            >
              {label}
            </span>
            <button
              type="button"
              role="switch"
              aria-label={label}
              aria-checked={settings[key] as boolean}
              onclick={() => toggleBool(key)}
              class="relative w-10 h-5 rounded-full transition-colors"
              style="background: {(settings[key] as boolean) ? 'var(--accent)' : 'rgba(0,0,0,0.15)'};"
            >
              <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform"
                style="background: white; transform: translateX({(settings[key] as boolean) ? '20px' : '0'});"
              ></span>
            </button>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Save button -->
  <div class="mt-8 flex justify-end">
    <button
      onclick={save}
      disabled={saving}
      class="text-[10px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg transition-colors disabled:opacity-50"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      {saving ? 'Saving…' : 'Save Settings'}
    </button>
  </div>
</div>
