<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import FilePicker from './shared/FilePicker.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Field readers ------------------------------------------------
  // The executor reads `config.fileName` (template-interpolated) and
  // `config.encoding` ('utf8' | 'base64'). `parseAs` and `maxBytes` are
  // forward-looking knobs the executor may grow into; we surface them in
  // the editor and store them under their canonical keys so the orchestrator
  // can fill them in when generating workflows.

  const fileName = $derived(String(config.fileName ?? ''));
  const encoding = $derived(String(config.encoding ?? 'utf8'));
  const parseAs = $derived(String(config.parseAs ?? 'raw'));
  const maxBytesRaw = config.maxBytes;
  const maxBytes = $derived(
    typeof maxBytesRaw === 'number' && Number.isFinite(maxBytesRaw)
      ? maxBytesRaw
      : (typeof maxBytesRaw === 'string' && maxBytesRaw.trim() && Number.isFinite(Number(maxBytesRaw))
          ? Number(maxBytesRaw)
          : null),
  );

  // base64 returns binary as a string — parsing it as JSON/YAML/CSV doesn't
  // make sense, so we hide the parse-as control unless the encoding produces
  // text the executor can hand to a parser.
  const parseApplicable = $derived(encoding === 'utf8');

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setMaxBytes(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      // Strip the key entirely when cleared so we don't ship `null` into
      // configs that previously omitted it.
      const next = { ...config };
      delete next.maxBytes;
      onChange(next);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return;
    set('maxBytes', Math.floor(n));
  }

  // ---------- Raw JSON ----------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles the "What this does" line so we don't duplicate it here.
  void definition;
</script>

<div class="fr">
  <!-- File path -->
  <section class="fr-sec">
    <header class="fr-sec-hdr"><span class="sr-label-tight">File</span></header>
    <div class="fr-field">
      <span class="fr-label">File name / path</span>
      <FilePicker
        value={fileName}
        mode="read"
        placeholder={'reports/{{input.id}}.csv'}
        onChange={(v) => set('fileName', v)}
        hint={'Pick from the workflow file store, or type a templated name. Templates supported: {{input.field}}.'}
      />
    </div>
  </section>

  <!-- Encoding & parse-as -->
  <section class="fr-sec">
    <header class="fr-sec-hdr"><span class="sr-label-tight">Decoding</span></header>
    <div class="fr-row">
      <label class="fr-field">
        <span class="fr-label">Encoding</span>
        <select value={encoding} onchange={(e) => set('encoding', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="utf8">utf-8 (text)</option>
          <option value="base64">base64 (binary)</option>
          <option value="binary">binary (raw bytes)</option>
        </select>
        <span class="fr-hint">How the executor turns the raw bytes into <code>content</code>.</span>
      </label>
      {#if parseApplicable}
        <label class="fr-field">
          <span class="fr-label">Parse as</span>
          <select value={parseAs} onchange={(e) => set('parseAs', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="raw">raw (string)</option>
            <option value="json">json</option>
            <option value="yaml">yaml</option>
            <option value="csv">csv</option>
          </select>
          <span class="fr-hint">Optional structured parse before passing downstream.</span>
        </label>
      {:else}
        <label class="fr-field fr-field-disabled">
          <span class="fr-label">Parse as</span>
          <select disabled value="raw">
            <option value="raw">raw (string)</option>
          </select>
          <span class="fr-hint">Only available with <code>utf-8</code> encoding.</span>
        </label>
      {/if}
    </div>
  </section>

  <!-- Limits -->
  <section class="fr-sec">
    <header class="fr-sec-hdr"><span class="sr-label-tight">Limits</span></header>
    <label class="fr-field">
      <span class="fr-label">Max bytes</span>
      <input
        type="number"
        min="0"
        step="1024"
        value={maxBytes ?? ''}
        placeholder="leave blank for no limit"
        oninput={(e) => setMaxBytes((e.currentTarget as HTMLInputElement).value)}
      />
      <span class="fr-hint">Refuse to load files larger than this many bytes. Empty = unlimited.</span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="fr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="fr-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .fr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fr-sec { display: flex; flex-direction: column; gap: 8px; }
  .fr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .fr-row { display: flex; gap: 10px; }
  .fr-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fr-field-disabled { opacity: 0.55; }
  .fr-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .fr-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .fr-hint code, .fr-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .fr-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .fr-code:focus { border-color: var(--text-muted); }

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

  .fr-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .fr-raw summary { cursor: pointer; }
</style>
