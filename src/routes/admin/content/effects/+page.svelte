<svelte:head><title>Biome — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import type { BiomeSettings } from '$lib/biome/settings';
  import { BIOME_SETTINGS_DEFAULTS } from '$lib/biome/settings';
  import type { BiomeStore } from '$lib/biome/store.svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');
  const biomeStore = getContext<BiomeStore>('biomeStore');

  let settings = $state<BiomeSettings>({ ...BIOME_SETTINGS_DEFAULTS, ...data.settings });
  let saving = $state(false);
  let saveSuccess = $state(false);
  let saveError = $state<string | null>(null);

  $effect(() => {
    if (biomeStore) biomeStore.settings = { ...settings };
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

  interface SettingGroup {
    label: string;
    toggle?: string;
    settings: { key: string; label: string; min: number; max: number; step: number; format: (v: number) => string }[];
  }

  const groups: SettingGroup[] = [
    {
      label: 'Particles',
      settings: [
        { key: 'particleDensity', label: 'Density', min: 0.1, max: 20.0, step: 0.5, format: (v) => v.toFixed(1) + 'x' },
        { key: 'particleSize', label: 'Size', min: 0.1, max: 5.0, step: 0.1, format: (v) => v.toFixed(1) + 'x' },
        { key: 'particleOpacity', label: 'Opacity', min: 0, max: 200, step: 5, format: (v) => v + '%' },
      ],
    },
    { label: 'Heartbeat', toggle: 'pulseEnabled', settings: [{ key: 'pulseIntensity', label: 'Intensity', min: 0, max: 200, step: 5, format: (v) => v + '%' }] },
    { label: 'Fog', toggle: 'fogEnabled', settings: [{ key: 'fogIntensity', label: 'Intensity', min: 0, max: 5.0, step: 0.1, format: (v) => v.toFixed(1) + 'x' }] },
    { label: 'Weather', toggle: 'weatherEnabled', settings: [{ key: 'weatherIntensity', label: 'Intensity', min: 0, max: 200, step: 5, format: (v) => v + '%' }] },
    { label: 'Connection Lines', toggle: 'connectionLinesEnabled', settings: [{ key: 'connectionLineOpacity', label: 'Opacity', min: 0, max: 200, step: 5, format: (v) => v + '%' }] },
    { label: 'Wind', toggle: 'windEnabled', settings: [{ key: 'windMultiplier', label: 'Strength', min: 0, max: 500, step: 10, format: (v) => v + '%' }] },
    {
      label: 'Blood Vessel Flow',
      toggle: 'bloodVesselEnabled',
      settings: [
        { key: 'bloodVesselSpeed', label: 'Flow Speed', min: 0, max: 200, step: 5, format: (v) => v + '%' },
        { key: 'bloodVesselSurge', label: 'Pulse Surge', min: 0, max: 200, step: 5, format: (v) => v + '%' },
      ],
    },
    { label: 'Shudder', toggle: 'shudderEnabled', settings: [{ key: 'shudderIntensity', label: 'Intensity', min: 0, max: 200, step: 5, format: (v) => v + '%' }] },
    { label: 'Combination Amplification', toggle: 'combinationEnabled', settings: [{ key: 'combinationStrength', label: 'Strength', min: 0, max: 200, step: 5, format: (v) => v + '%' }] },
    { label: 'Dream Mode', toggle: 'dreamMode', settings: [] },
  ];

  function getVal(key: string): number { return (settings as any)[key] as number; }
  function setVal(key: string, v: number) { (settings as any)[key] = v; }
  function getBool(key: string | undefined): boolean { if (!key) return true; return (settings as any)[key] as boolean; }
  function toggleBool(key: string | undefined) { if (!key) return; (settings as any)[key] = !(settings as any)[key]; }
</script>

<PageWrap>
  <PageHeader
    kicker="Site"
    title="Biome / Visual Effects"
    sub="Tune the ambient particle layer that powers the homepage and live activity hero. Changes preview live; save to persist."
  >
    {#snippet actions()}
      <button class="nm-btn-ghost" onclick={resetDefaults}>Reset defaults</button>
      <button class="nm-save-btn" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    {/snippet}
  </PageHeader>

  {#if saveSuccess}<div class="banner banner-success">Settings saved.</div>{/if}
  {#if saveError}<div class="banner banner-error">{saveError}</div>{/if}

  <div class="biome-grid">
    {#each groups as group}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">{group.label}</span>
          {#if group.toggle}
            {@const tog = group.toggle}
            <button
              type="button"
              role="switch"
              aria-checked={getBool(tog)}
              onclick={() => toggleBool(tog)}
              class="nm-toggle"
              style="margin-left: auto;"
            ></button>
          {/if}
        </div>

        {#if group.settings.length > 0}
          <div class="sliders" class:dim={group.toggle && !getBool(group.toggle)}>
            {#each group.settings as s}
              <div class="slider-row">
                <div class="slider-hd">
                  <label>{s.label}</label>
                  <span>{s.format(getVal(s.key))}</span>
                </div>
                <input
                  class="nm-range"
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={getVal(s.key)}
                  oninput={(e) => setVal(s.key, parseFloat((e.target as HTMLInputElement).value))}
                />
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
</PageWrap>

<style>
  .biome-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }
  .biome-grid :global(.nm-sec) { margin-bottom: 0; }

  .sliders { display: flex; flex-direction: column; gap: 0.6rem; transition: opacity 200ms ease; }
  .sliders.dim { opacity: 0.35; pointer-events: none; }
  .slider-row { display: flex; flex-direction: column; gap: 4px; }
  .slider-hd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .slider-hd label {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .slider-hd span { color: var(--text-secondary); }
</style>
