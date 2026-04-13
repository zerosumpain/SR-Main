<script lang="ts">
  import TemplateInput from './TemplateInput.svelte';
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

  const visibleFields = $derived(
    showAdvanced ? fields : fields.filter((f) => !f.advancedOnly),
  );

  function update(key: string, newValue: unknown) {
    onConfigChange({ ...config, [key]: newValue });
  }

  function getStringValue(key: string): string {
    const v = config[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  }

  function getNumberValue(key: string): number {
    const v = config[key];
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  function getBooleanValue(key: string): boolean {
    return Boolean(config[key]);
  }
</script>

<div class="space-y-3">
  {#each visibleFields as field (field.key)}
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        {field.label}
      </label>

      {#if field.description}
        <p class="text-[10px] mb-1" style="color: var(--text-ghost);">{field.description}</p>
      {/if}

      {#if field.type === 'dropdown'}
        <select
          value={getStringValue(field.key)}
          onchange={(e) => update(field.key, (e.target as HTMLSelectElement).value)}
          class="w-full px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        >
          {#each field.options ?? [] as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>

      {:else if field.type === 'toggle'}
        {@const isOn = getBooleanValue(field.key)}
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={field.label}
          onclick={() => update(field.key, !isOn)}
          class="relative inline-flex items-center w-9 h-5 rounded-full transition-colors"
          style="background: {isOn ? 'var(--accent)' : 'var(--card-border)'};"
        >
          <span
            class="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
            style="transform: translateX({isOn ? '18px' : '3px'});"
          ></span>
        </button>

      {:else if field.type === 'slider'}
        {@const sliderVal = getNumberValue(field.key)}
        <div class="flex items-center gap-2">
          <input
            type="range"
            value={sliderVal}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            oninput={(e) => update(field.key, Number((e.target as HTMLInputElement).value))}
            class="flex-1"
            style="accent-color: var(--accent);"
          />
          <span class="text-[11px] min-w-[2.5rem] text-right" style="color: var(--text-primary); font-family: var(--font-mono);">
            {sliderVal}
          </span>
        </div>

      {:else if field.type === 'number'}
        <input
          type="number"
          value={getNumberValue(field.key)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          placeholder={field.placeholder}
          oninput={(e) => update(field.key, Number((e.target as HTMLInputElement).value))}
          class="w-full px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        />

      {:else if field.type === 'template-textarea'}
        <TemplateInput
          value={getStringValue(field.key)}
          placeholder={field.placeholder}
          {variables}
          onInput={(v) => update(field.key, v)}
        />

      {:else if field.type === 'textarea'}
        <textarea
          value={getStringValue(field.key)}
          placeholder={field.placeholder}
          oninput={(e) => {
            const raw = (e.target as HTMLTextAreaElement).value;
            try {
              update(field.key, JSON.parse(raw));
            } catch {
              update(field.key, raw);
            }
          }}
          class="w-full px-2 py-1.5 rounded text-xs border resize-none"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 72px;"
          rows="4"
        ></textarea>

      {:else if field.type === 'code'}
        <textarea
          value={getStringValue(field.key)}
          placeholder={field.placeholder}
          oninput={(e) => update(field.key, (e.target as HTMLTextAreaElement).value)}
          class="w-full px-2 py-1.5 rounded text-xs border resize-none"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono); min-height: 140px;"
          rows="8"
          spellcheck="false"
        ></textarea>

      {:else}
        <!-- text (default) -->
        <input
          type="text"
          value={getStringValue(field.key)}
          placeholder={field.placeholder}
          oninput={(e) => update(field.key, (e.target as HTMLInputElement).value)}
          class="w-full px-2 py-1.5 rounded text-xs border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
        />
      {/if}
    </div>
  {/each}
</div>
