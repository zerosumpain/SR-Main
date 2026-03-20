<svelte:head><title>Biome Settings — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import type { BiomeSettings } from '$lib/biome/settings';
  import { BIOME_SETTINGS_DEFAULTS } from '$lib/biome/settings';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');
  const biomeStore = getContext<BiomeStore>('biomeStore');

  let settings = $state<BiomeSettings>({ ...BIOME_SETTINGS_DEFAULTS, ...data.settings });
  let saving = $state(false);
  let saveSuccess = $state(false);
  let saveError = $state<string | null>(null);

  // Live preview
  $effect(() => {
    if (biomeStore) {
      biomeStore.settings = { ...settings };
    }
  });

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

  function resetDefaults() {
    settings = { ...BIOME_SETTINGS_DEFAULTS };
  }

  // Setting groups for the UI
  const groups = [
    {
      label: 'Particles',
      settings: [
        { key: 'particleDensity', label: 'Density', min: 0.1, max: 5.0, step: 0.1, format: (v: number) => v.toFixed(1) + 'x' },
        { key: 'particleSize', label: 'Size', min: 0.1, max: 5.0, step: 0.1, format: (v: number) => v.toFixed(1) + 'x' },
        { key: 'particleOpacity', label: 'Opacity', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Heartbeat',
      toggle: 'pulseEnabled',
      settings: [
        { key: 'pulseIntensity', label: 'Intensity', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Fog',
      toggle: 'fogEnabled',
      settings: [
        { key: 'fogIntensity', label: 'Intensity', min: 0, max: 5.0, step: 0.1, format: (v: number) => v.toFixed(1) + 'x' },
      ],
    },
    {
      label: 'Weather',
      toggle: 'weatherEnabled',
      settings: [
        { key: 'weatherIntensity', label: 'Intensity', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Connection Lines',
      toggle: 'connectionLinesEnabled',
      settings: [
        { key: 'connectionLineOpacity', label: 'Opacity', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Wind',
      toggle: 'windEnabled',
      settings: [
        { key: 'windMultiplier', label: 'Strength', min: 0, max: 500, step: 10, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Blood Vessel Flow',
      toggle: 'bloodVesselEnabled',
      settings: [
        { key: 'bloodVesselSpeed', label: 'Flow Speed', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
        { key: 'bloodVesselSurge', label: 'Pulse Surge', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Shudder',
      toggle: 'shudderEnabled',
      settings: [
        { key: 'shudderIntensity', label: 'Intensity', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Combination Amplification',
      toggle: 'combinationEnabled',
      settings: [
        { key: 'combinationStrength', label: 'Strength', min: 0, max: 200, step: 5, format: (v: number) => v + '%' },
      ],
    },
    {
      label: 'Dream Mode',
      toggle: 'dreamMode',
      settings: [],
    },
  ] as const;

  function getVal(key: string): number {
    return (settings as any)[key] as number;
  }
  function setVal(key: string, v: number) {
    (settings as any)[key] = v;
  }
  function getBool(key: string): boolean {
    return (settings as any)[key] as boolean;
  }
  function toggleBool(key: string) {
    (settings as any)[key] = !(settings as any)[key];
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4">
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
    <div class="mb-4 p-3 rounded-lg text-[10px]" style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--accent); font-family: var(--font-mono);">
      Settings saved.
    </div>
  {/if}

  {#if saveError}
    <div class="mb-4 p-3 rounded-lg text-[10px]" style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);">
      {saveError}
    </div>
  {/if}

  <div class="space-y-3">
    {#each groups as group}
      <div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
        <!-- Group header with optional toggle -->
        <div class="flex items-center justify-between mb-3">
          <span class="text-[10px] uppercase tracking-[0.25em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            {group.label}
          </span>
          {#if group.toggle}
            <button
              type="button"
              role="switch"
              aria-checked={getBool(group.toggle)}
              onclick={() => toggleBool(group.toggle)}
              class="relative w-9 h-[18px] rounded-full transition-colors"
              style="background: {getBool(group.toggle) ? 'var(--accent)' : 'rgba(0,0,0,0.12)'};"
            >
              <span
                class="absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full transition-transform"
                style="background: white; transform: translateX({getBool(group.toggle) ? '18px' : '0'});"
              ></span>
            </button>
          {/if}
        </div>

        <!-- Sliders (dimmed if toggle is off) -->
        {#if group.settings.length > 0}
          <div
            class="space-y-3 transition-opacity"
            style="opacity: {group.toggle && !getBool(group.toggle) ? '0.3' : '1'}; pointer-events: {group.toggle && !getBool(group.toggle) ? 'none' : 'auto'};"
          >
            {#each group.settings as s}
              <div>
                <div class="flex justify-between mb-0.5">
                  <label class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                    {s.label}
                  </label>
                  <span class="text-[9px]" style="color: var(--text-secondary); font-family: var(--font-mono);">
                    {s.format(getVal(s.key))}
                  </span>
                </div>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={getVal(s.key)}
                  oninput={(e) => setVal(s.key, parseFloat((e.target as HTMLInputElement).value))}
                  class="w-full h-1 rounded-full appearance-none cursor-pointer"
                  style="accent-color: var(--accent);"
                />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Actions -->
  <div class="mt-6 flex justify-between">
    <button
      onclick={resetDefaults}
      class="text-[10px] uppercase tracking-[0.2em] px-4 py-2.5 rounded-lg transition-colors"
      style="color: var(--text-ghost); font-family: var(--font-mono); border: 1px solid var(--card-border);"
    >
      Reset Defaults
    </button>
    <button
      onclick={save}
      disabled={saving}
      class="text-[10px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
</div>
