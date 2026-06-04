<script lang="ts">
  import type { BasicConfigField, NodeDefinition } from '$lib/workflows/types';
  import SchemaFieldTable from './widgets/SchemaFieldTable.svelte';
  import KeyValueTableField from './widgets/KeyValueTableField.svelte';
  import ChipInputField from './widgets/ChipInputField.svelte';
  import PhoneField from './widgets/PhoneField.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';

  let {
    config,
    onChange,
    definition,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition: NodeDefinition;
    /**
     * Upstream output field paths, plumbed by the canvas via getPanel().
     * Drives the `{{` autocomplete in TemplatedTextarea for `template-textarea`
     * fields. The canvas already passes this prop to every panel, but this form
     * previously dropped it from the destructure — silently downgrading every
     * schema-driven node's template fields to a dead plain textarea with no
     * field discovery. (nodeId/workflowId are also passed by the canvas; thread
     * them through here when a node-scoped picker — credential/store-key — lands.)
     */
    upstreamFields?: string[];
  } = $props();

  let showAdvanced = $state(false);
  let showRawJson = $state(false);
  const fields = $derived(definition.basicConfig ?? []);
  // Keys the node's JSON-Schema marks as required — rendered with a red * so
  // the user can see what must be filled before the node will work.
  const requiredKeys = $derived(
    new Set((definition.configSchema?.required as string[] | undefined) ?? []),
  );

  // Dynamic dropdown options (e.g. live OpenRouter model catalog). Populated
  // on first paint per key, cached in memory for the panel's lifetime — the
  // server route does its own 5-min cache, so a panel re-open is cheap.
  const dynamicOptions = $state<Record<string, { value: string; label: string }[]>>({});
  const dynamicLoading = $state<Record<string, boolean>>({});

  async function loadDynamicOptions(key: string) {
    if (dynamicOptions[key] || dynamicLoading[key]) return;
    dynamicLoading[key] = true;
    try {
      const url =
        key === 'openrouter-models' ? '/api/openrouter/models' :
        key === 'scraper-profiles' ? '/api/scraper/profiles' :
        '';
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body?.options)) dynamicOptions[key] = body.options;
    } finally {
      dynamicLoading[key] = false;
    }
  }

  $effect(() => {
    for (const f of fields) {
      if (f.dynamicOptionsKey) void loadDynamicOptions(f.dynamicOptionsKey);
    }
  });

  function optionsFor(field: BasicConfigField): { value: string; label: string }[] {
    const dyn = field.dynamicOptionsKey ? dynamicOptions[field.dynamicOptionsKey] ?? [] : [];
    const baked = field.options ?? [];
    if (dyn.length === 0) return baked;
    // Merge: baked entries first (default/site-setting placeholder), then any
    // dyn ids not already present. Dedup by value so a hand-picked alias
    // doesn't get overwritten by the catalog row.
    const seen = new Set(baked.map((o) => o.value));
    return [...baked, ...dyn.filter((o) => !seen.has(o.value))];
  }

  function isVisible(field: BasicConfigField): boolean {
    if (field.advancedOnly && !showAdvanced) return false;
    const v = field.visibleWhen;
    if (!v) return true;
    const other = config[v.key];
    if (v.equals !== undefined) return other === v.equals;
    if (v.in) return v.in.includes(other);
    if (v.not !== undefined) return other !== v.not;
    return true;
  }

  function update(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const sections = $derived.by(() => {
    const order: string[] = [];
    const map = new Map<string, BasicConfigField[]>();
    for (const f of fields) {
      const sec = f.section ?? '';
      if (!map.has(sec)) {
        map.set(sec, []);
        order.push(sec);
      }
      map.get(sec)!.push(f);
    }
    return order.map((s) => ({ name: s, fields: map.get(s)! }));
  });

  function toggleAdvanced() { showAdvanced = !showAdvanced; }
</script>

<div class="bcf">
  {#each sections as sec (sec.name)}
    {#if sec.name}<h4 class="bcf-section">{sec.name}</h4>{/if}
    {#each sec.fields as f (f.key)}
      {#if isVisible(f)}
        <label class="bcf-field" class:bcf-field-wide={f.type === 'textarea' || f.type === 'template-textarea' || f.type === 'code' || f.type === 'schema-builder' || f.type === 'key-value-table'}>
          <span class="bcf-label">{f.label}{#if requiredKeys.has(f.key)} <span class="bcf-req" title="Required">*</span>{/if}</span>
          {#if f.description}<span class="bcf-desc">{f.description}</span>{/if}

          {#if f.type === 'dropdown'}
            <select value={config[f.key] ?? ''} onchange={(e) => update(f.key, (e.currentTarget as HTMLSelectElement).value)}>
              {#each optionsFor(f) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            {#if f.dynamicOptionsKey && dynamicLoading[f.dynamicOptionsKey]}
              <span class="bcf-desc">Loading models…</span>
            {/if}
          {:else if f.type === 'toggle'}
            <input type="checkbox" checked={Boolean(config[f.key])} onchange={(e) => update(f.key, (e.currentTarget as HTMLInputElement).checked)} />
          {:else if f.type === 'slider'}
            <div class="bcf-slider">
              <input type="range" min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={Number(config[f.key] ?? f.min ?? 0)} oninput={(e) => update(f.key, Number((e.currentTarget as HTMLInputElement).value))} />
              <span>{config[f.key] ?? f.min ?? 0}</span>
            </div>
          {:else if f.type === 'number'}
            <input type="number" min={f.min} max={f.max} step={f.step ?? 1} value={Number(config[f.key] ?? 0)} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, Number((e.currentTarget as HTMLInputElement).value))} />
          {:else if f.type === 'text'}
            <input type="text" value={String(config[f.key] ?? '')} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, (e.currentTarget as HTMLInputElement).value)} />
          {:else if f.type === 'template-textarea'}
            <TemplatedTextarea
              value={String(config[f.key] ?? '')}
              upstreamFields={upstreamFields}
              placeholder={f.placeholder ?? ''}
              rows={4}
              onChange={(v) => update(f.key, v)}
            />
          {:else if f.type === 'textarea'}
            <textarea rows="4" value={String(config[f.key] ?? '')} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
          {:else if f.type === 'code'}
            <textarea class="bcf-code" rows="8" spellcheck="false" value={String(config[f.key] ?? '')} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
            {#if f.cheatsheet && f.cheatsheet.length > 0}
              <details class="bcf-cheatsheet">
                <summary>Variables in scope</summary>
                <ul>
                  {#each f.cheatsheet as line}
                    <li><code>{line}</code></li>
                  {/each}
                </ul>
              </details>
            {/if}
          {:else if f.type === 'schema-builder'}
            <SchemaFieldTable value={(config[f.key] as unknown[]) ?? []} onChange={(v) => update(f.key, v)} />
          {:else if f.type === 'key-value-table'}
            <KeyValueTableField value={(config[f.key] as Record<string, string>) ?? {}} onChange={(v) => update(f.key, v)} />
          {:else if f.type === 'chip-input'}
            <ChipInputField value={(config[f.key] as string[]) ?? []} placeholder={f.placeholder} onChange={(v) => update(f.key, v)} />
          {:else if f.type === 'phone'}
            <PhoneField value={String(config[f.key] ?? '')} onChange={(v) => update(f.key, v)} />
          {/if}
        </label>
      {/if}
    {/each}
  {/each}

  <button type="button" class="bcf-advanced-toggle" onclick={toggleAdvanced}>
    {showAdvanced ? 'Hide advanced fields' : 'Show advanced fields'}
  </button>

  <details class="bcf-raw" bind:open={showRawJson}>
    <summary>Advanced — raw JSON config</summary>
    <textarea
      class="bcf-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next);
        } catch { /* invalid JSON — ignore until valid */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .bcf { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
  .bcf-preview {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bcf-preview-hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .bcf-preview-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    font-weight: 600;
  }
  .bcf-preview-kind {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    padding: 2px 6px;
    border-radius: 2px;
  }
  .bcf-preview-line {
    margin: 0;
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .bcf-preview-grid {
    display: grid;
    grid-template-columns: minmax(0, max-content) 1fr;
    gap: 4px 12px;
    margin: 4px 0 0 0;
    font-size: 11px;
  }
  .bcf-preview-grid dt {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    align-self: center;
  }
  .bcf-preview-grid dd {
    margin: 0;
    color: var(--text-primary);
    word-break: break-all;
  }
  .bcf-section {
    margin: 8px 0 0 0;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .bcf-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .bcf-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .bcf-req { color: var(--status-error, #c0392b); font-weight: 700; }
  .bcf-desc { font-size: 11px; color: var(--text-ghost); }
  .bcf-slider { display: flex; gap: 8px; align-items: center; color: var(--text-primary); }
  .bcf-code { font-family: var(--font-mono); font-size: 11px; }
  .bcf-cheatsheet {
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .bcf-cheatsheet summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .bcf-cheatsheet ul { margin: 4px 0 0 12px; padding: 0; }
  .bcf-cheatsheet code { font-size: 11px; }
  .bcf-advanced-toggle {
    margin-top: 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .bcf-advanced-toggle:hover { color: var(--text-primary); }
  .bcf-raw {
    margin-top: 8px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bcf-raw summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bcf-raw summary:hover { color: var(--text-primary); }
  .bcf-raw textarea { margin-top: 8px; }
  input[type='text'], input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus {
    border-color: var(--text-muted);
  }
  /* TemplatedTextarea renders its own <textarea class="tt-textarea"> in a child
     component, so this form's scoped `textarea` rule above can't reach it.
     Re-apply the same chrome via :global so template-textarea fields match. */
  :global(.bcf .tt-textarea) {
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    box-sizing: border-box;
    outline: none;
  }
  :global(.bcf .tt-textarea:focus) { border-color: var(--text-muted); }
</style>
