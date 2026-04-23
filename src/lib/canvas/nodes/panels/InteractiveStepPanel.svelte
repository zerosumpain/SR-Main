<script lang="ts">
  import type { PanelProps } from './registry';
  import { onMount } from 'svelte';

  let { config, onChange }: PanelProps = $props();

  let mode = $state<'vnc' | 'confirm' | 'both'>((config.mode as 'vnc' | 'confirm' | 'both') ?? 'confirm');
  let profile = $state((config.profile as string) ?? '');
  let stepUrl = $state((config.url as string) ?? '');
  let prompt = $state((config.prompt as string) ?? '');
  let timeoutMinutes = $state((config.timeoutMinutes as number) ?? 60);

  type Field = { name: string; type: 'text' | 'textarea' | 'number' | 'boolean'; label: string; defaultValueTemplate: string };
  function makeField(f?: Partial<Field>): Field {
    return { name: f?.name ?? '', type: f?.type ?? 'text', label: f?.label ?? '', defaultValueTemplate: f?.defaultValueTemplate ?? '' };
  }
  let fields = $state<Field[]>(
    Array.isArray(config.fields)
      ? (config.fields as Array<Record<string, unknown>>).map((f) => makeField(f as Partial<Field>))
      : []
  );

  let profiles = $state<string[]>([]);
  onMount(async () => {
    try {
      const res = await fetch('/api/scraper/profiles');
      if (res.ok) profiles = await res.json();
    } catch { /* non-fatal */ }
  });

  const showVnc = $derived(mode === 'vnc' || mode === 'both');
  const showConfirm = $derived(mode === 'confirm' || mode === 'both');

  function emit() {
    const out: Record<string, unknown> = { mode, prompt, timeoutMinutes };
    if (showVnc) { out.profile = profile; out.url = stepUrl; }
    if (showConfirm) { out.fields = fields; }
    onChange(out);
  }

  function addField() { fields = [...fields, makeField()]; emit(); }
  function removeField(i: number) { fields = fields.filter((_, idx) => idx !== i); emit(); }
  function setField<K extends keyof Field>(i: number, key: K, val: Field[K]) {
    fields = fields.map((f, idx) => idx === i ? { ...f, [key]: val } : f);
    emit();
  }

  $effect(() => {
    mode = (config.mode as 'vnc' | 'confirm' | 'both') ?? 'confirm';
    profile = (config.profile as string) ?? '';
    stepUrl = (config.url as string) ?? '';
    prompt = (config.prompt as string) ?? '';
    timeoutMinutes = (config.timeoutMinutes as number) ?? 60;
  });
</script>

<div class="panel">
  <!-- Mode -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Mode</span></div>
    <select class="ps-select" value={mode}
      onchange={(e) => { mode = (e.target as HTMLSelectElement).value as typeof mode; emit(); }}>
      <option value="confirm">confirm</option>
      <option value="vnc">vnc</option>
      <option value="both">both</option>
    </select>
  </section>

  <!-- VNC fields -->
  {#if showVnc}
    <section class="ps">
      <div class="ps-hd"><span class="ps-label">Profile</span></div>
      <input class="ps-input" type="text" list="interactive-profiles" value={profile}
        oninput={(e) => { profile = (e.target as HTMLInputElement).value; emit(); }}
        placeholder="e.g. civilservicejobs-gov-uk" />
      <datalist id="interactive-profiles">
        {#each profiles as p (p)}
          <option value={p}>{p}</option>
        {/each}
      </datalist>
    </section>

    <section class="ps">
      <div class="ps-hd"><span class="ps-label">URL</span></div>
      <input class="ps-input" type="text" value={stepUrl}
        oninput={(e) => { stepUrl = (e.target as HTMLInputElement).value; emit(); }}
        placeholder="https://example.com/login" />
      <div class="ps-hint">Supports <code>{'{{input.x}}'}</code> templates.</div>
    </section>
  {/if}

  <!-- Prompt -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Prompt</span></div>
    <div class="ps-field">
      <textarea class="ps-textarea" rows="3" value={prompt}
        oninput={(e) => { prompt = (e.target as HTMLTextAreaElement).value; emit(); }}
        placeholder="Please review the job listings and click Apply for the ones that match your criteria."></textarea>
    </div>
  </section>

  <!-- Fields (confirm/both) -->
  {#if showConfirm}
    <section class="ps">
      <div class="ps-hd">
        <span class="ps-label">Fields</span>
        <span class="ps-meta">form fields shown to the user</span>
      </div>
      <div class="ps-fields">
        {#each fields as field, i (i)}
          <div class="ps-field-row">
            <input class="ps-input" type="text" value={field.name}
              oninput={(e) => setField(i, 'name', (e.target as HTMLInputElement).value)}
              placeholder="name" style="width:90px;flex-shrink:0" />
            <select class="ps-select" value={field.type}
              onchange={(e) => setField(i, 'type', (e.target as HTMLSelectElement).value as Field['type'])}>
              <option value="text">text</option>
              <option value="textarea">textarea</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <input class="ps-input" type="text" value={field.label}
              oninput={(e) => setField(i, 'label', (e.target as HTMLInputElement).value)}
              placeholder="Display label" style="flex:1;min-width:0" />
            <input class="ps-input" type="text" value={field.defaultValueTemplate}
              oninput={(e) => setField(i, 'defaultValueTemplate', (e.target as HTMLInputElement).value)}
              placeholder="default / template" style="width:110px;flex-shrink:0" />
            <button class="ps-remove" onclick={() => removeField(i)} title="Remove">×</button>
          </div>
        {/each}
        <button class="ps-add-btn" onclick={addField}>+ Add field</button>
      </div>
    </section>
  {/if}

  <!-- Timeout -->
  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Timeout (minutes)</span>
    </div>
    <input class="ps-input ps-input-narrow" type="number" value={timeoutMinutes}
      oninput={(e) => { timeoutMinutes = Number((e.target as HTMLInputElement).value); emit(); }}
      placeholder="60" min="1" />
  </section>
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 0; }
  .ps { padding: 10px 0; border-bottom: 1px solid var(--divider); display: flex; flex-direction: column; gap: 6px; }
  .ps:last-child { border-bottom: none; }
  .ps-hd { display: flex; align-items: baseline; gap: 8px; }
  .ps-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .ps-meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
  }
  .ps-hint {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
  }
  .ps-hint code {
    color: var(--accent);
    font-family: var(--font-mono);
  }
  .ps-input {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    padding: 4px 7px;
    font-family: var(--font-mono);
    font-size: 11px;
    outline: none;
    box-sizing: border-box;
    width: 100%;
  }
  .ps-input:focus { border-color: var(--accent); }
  .ps-input-narrow { width: 100px; }
  .ps-select {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    padding: 4px 7px;
    font-family: var(--font-mono);
    font-size: 11px;
    outline: none;
  }
  .ps-select:focus { border-color: var(--accent); }
  .ps-field { border: 1px solid var(--card-border); }
  .ps-textarea {
    width: 100%;
    background: var(--bg);
    color: var(--text-primary);
    border: none;
    padding: 6px 8px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    font-family: var(--font-sans, inherit);
    font-size: 12px;
    line-height: 1.5;
  }
  .ps-fields { display: flex; flex-direction: column; gap: 5px; }
  .ps-field-row {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    background: var(--bg-section);
    padding: 5px 6px;
    border: 1px solid var(--divider);
  }
  .ps-remove {
    background: none;
    border: none;
    color: var(--text-ghost);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
  }
  .ps-remove:hover { color: #c44; }
  .ps-add-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 10px;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--card-border);
    cursor: pointer;
    align-self: flex-start;
  }
  .ps-add-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
