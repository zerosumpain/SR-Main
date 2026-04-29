<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ChipInputField from './widgets/ChipInputField.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Helpers ----------------------------------------------------

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // The orchestrator may serialise to/cc/bcc as either a comma-separated
  // string or an array of strings. We accept both shapes when reading; we
  // always write back as a single comma-separated string because the email
  // executor reads `to` verbatim as a string and runs template
  // interpolation on it. cc/bcc aren't consumed today but we preserve them
  // in the same shape for forward compatibility.
  function readRecipientRaw(raw: unknown): string {
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
    }
    return String(raw ?? '');
  }

  function rawToChips(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function chipsToRaw(chips: string[]): string {
    return chips.join(', ');
  }

  function detectMode(raw: string): 'chips' | 'template' {
    return raw.includes('{{') ? 'template' : 'chips';
  }

  // ---------- Recipient state -------------------------------------------

  const initialTo = readRecipientRaw(config.to);
  const initialCc = readRecipientRaw(config.cc);
  const initialBcc = readRecipientRaw(config.bcc);

  let toMode = $state<'chips' | 'template'>(detectMode(initialTo));
  let ccMode = $state<'chips' | 'template'>(detectMode(initialCc));
  let bccMode = $state<'chips' | 'template'>(detectMode(initialBcc));

  const toRaw = $derived(readRecipientRaw(config.to));
  const ccRaw = $derived(readRecipientRaw(config.cc));
  const bccRaw = $derived(readRecipientRaw(config.bcc));

  const toChips = $derived(rawToChips(toRaw));
  const ccChips = $derived(rawToChips(ccRaw));
  const bccChips = $derived(rawToChips(bccRaw));

  function setRecipient(key: 'to' | 'cc' | 'bcc', raw: string) {
    set(key, raw);
  }

  // ---------- Body --------------------------------------------------------
  // The executor reads a single `body` string and auto-detects HTML when
  // the trimmed value starts with `<`. We surface a hint so users know.

  const bodyVal = $derived(String(config.body ?? ''));
  const isHtml = $derived(bodyVal.trimStart().startsWith('<'));

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="em">
  <!-- From -->
  <section class="em-sec">
    <header class="em-sec-hdr"><span class="sr-label-tight">From</span></header>
    <label class="em-field">
      <span class="em-label">Sender address</span>
      <input
        type="text"
        spellcheck="false"
        placeholder="noreply@example.com"
        value={String(config.from ?? '')}
        oninput={(e) => set('from', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="em-hint">
        Sender email — must be authorised on the SMTP server. Leave blank to
        fall back to the server default (<code>SMTP_FROM</code> env var).
        Templates supported: <code>{`{{input.field}}`}</code>.
      </span>
    </label>
  </section>

  <!-- To -->
  <section class="em-sec">
    <header class="em-sec-hdr">
      <span class="sr-label-tight">To</span>
      <div class="em-mode-toggle" role="tablist" aria-label="To input mode">
        <button
          type="button"
          class="em-mode-btn"
          class:em-mode-btn-active={toMode === 'chips'}
          role="tab"
          aria-selected={toMode === 'chips'}
          onclick={() => (toMode = 'chips')}
        >Chips</button>
        <button
          type="button"
          class="em-mode-btn"
          class:em-mode-btn-active={toMode === 'template'}
          role="tab"
          aria-selected={toMode === 'template'}
          onclick={() => (toMode = 'template')}
        >Template</button>
      </div>
    </header>
    {#if toMode === 'chips'}
      <ChipInputField
        value={toChips}
        placeholder="alice@example.com — Enter or , to add"
        onChange={(v) => setRecipient('to', chipsToRaw(v))}
      />
      <span class="em-hint">One or more recipients. Use Template mode for <code>{`{{input.x}}`}</code> values.</span>
    {:else}
      <textarea
        class="em-code"
        rows="2"
        spellcheck="false"
        placeholder={`{{input.recipient}} or {{trigger.output.from}}`}
        value={toRaw}
        oninput={(e) => setRecipient('to', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="em-hint">Templates supported: <code>{`{{input.field}}`}</code>. Comma-separate for multiple.</span>
    {/if}
  </section>

  <!-- Cc / Bcc (collapsed) -->
  <details class="em-cc">
    <summary><span class="sr-label-tight">Cc / Bcc</span></summary>

    <section class="em-sec">
      <header class="em-sec-hdr">
        <span class="sr-label-tight">Cc</span>
        <div class="em-mode-toggle" role="tablist" aria-label="Cc input mode">
          <button
            type="button"
            class="em-mode-btn"
            class:em-mode-btn-active={ccMode === 'chips'}
            role="tab"
            aria-selected={ccMode === 'chips'}
            onclick={() => (ccMode = 'chips')}
          >Chips</button>
          <button
            type="button"
            class="em-mode-btn"
            class:em-mode-btn-active={ccMode === 'template'}
            role="tab"
            aria-selected={ccMode === 'template'}
            onclick={() => (ccMode = 'template')}
          >Template</button>
        </div>
      </header>
      {#if ccMode === 'chips'}
        <ChipInputField
          value={ccChips}
          placeholder="cc@example.com"
          onChange={(v) => setRecipient('cc', chipsToRaw(v))}
        />
      {:else}
        <textarea
          class="em-code"
          rows="2"
          spellcheck="false"
          placeholder={`{{input.cc}}`}
          value={ccRaw}
          oninput={(e) => setRecipient('cc', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      {/if}
    </section>

    <section class="em-sec">
      <header class="em-sec-hdr">
        <span class="sr-label-tight">Bcc</span>
        <div class="em-mode-toggle" role="tablist" aria-label="Bcc input mode">
          <button
            type="button"
            class="em-mode-btn"
            class:em-mode-btn-active={bccMode === 'chips'}
            role="tab"
            aria-selected={bccMode === 'chips'}
            onclick={() => (bccMode = 'chips')}
          >Chips</button>
          <button
            type="button"
            class="em-mode-btn"
            class:em-mode-btn-active={bccMode === 'template'}
            role="tab"
            aria-selected={bccMode === 'template'}
            onclick={() => (bccMode = 'template')}
          >Template</button>
        </div>
      </header>
      {#if bccMode === 'chips'}
        <ChipInputField
          value={bccChips}
          placeholder="bcc@example.com"
          onChange={(v) => setRecipient('bcc', chipsToRaw(v))}
        />
      {:else}
        <textarea
          class="em-code"
          rows="2"
          spellcheck="false"
          placeholder={`{{input.bcc}}`}
          value={bccRaw}
          oninput={(e) => setRecipient('bcc', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      {/if}
    </section>
  </details>

  <!-- Subject -->
  <section class="em-sec">
    <header class="em-sec-hdr"><span class="sr-label-tight">Subject</span></header>
    <label class="em-field">
      <span class="em-label">Subject line</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={`Daily report for {{input.date}}`}
        value={String(config.subject ?? '')}
        oninput={(e) => set('subject', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="em-hint">Templates supported: <code>{`{{input.field}}`}</code></span>
    </label>
  </section>

  <!-- Body (single field — executor auto-detects HTML when starts with <) -->
  <section class="em-sec">
    <header class="em-sec-hdr">
      <span class="sr-label-tight">Body</span>
      {#if isHtml}<span class="em-info">detected as HTML</span>{:else if bodyVal}<span class="em-info">detected as plain text</span>{/if}
    </header>
    <label class="em-field">
      <span class="em-label">Message body</span>
      <textarea
        class="em-code"
        rows="8"
        spellcheck="false"
        placeholder={`Hi,\n\nHere is the update: {{input.summary}}`}
        value={bodyVal}
        oninput={(e) => set('body', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="em-hint">
        Templates: <code>{`{{input.field}}`}</code>. If the body starts with an
        HTML tag (e.g. <code>&lt;p&gt;</code>) it is sent as HTML, otherwise as
        plain text.
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="em-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="em-code"
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
  .em { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .em-sec { display: flex; flex-direction: column; gap: 8px; }
  .em-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .em-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .em-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .em-hint { font-size: 11px; color: var(--text-ghost); }
  .em-hint code, .em-label code { font-size: 11px; color: var(--text-muted); }

  .em-info { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .em-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .em-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .em-mode-btn + .em-mode-btn { border-left: 1px solid var(--card-border); }
  .em-mode-btn:hover { color: var(--text-primary); }
  .em-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .em-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .em-code:focus { border-color: var(--text-muted); }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }

  .em-cc {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .em-cc[open] { padding-bottom: 10px; }
  .em-cc summary { cursor: pointer; padding: 2px 0; }
  .em-cc > .em-sec { margin-top: 8px; }

  .em-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .em-raw summary { cursor: pointer; }
</style>
