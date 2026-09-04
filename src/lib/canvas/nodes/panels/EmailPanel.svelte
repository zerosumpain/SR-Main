<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import RecipientListBlock from './widgets/RecipientListBlock.svelte';

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

  // ---------- Body --------------------------------------------------------
  // The executor reads a single `body` string and auto-detects HTML when
  // the trimmed value starts with `<`. We surface a hint so users know.

  const bodyVal = $derived(String(config.body ?? ''));
  const isHtml = $derived(bodyVal.trimStart().startsWith('<'));

  // ---------- Raw JSON --------------------------------------------------
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

  <RecipientListBlock
    label="To"
    value={config.to}
    onChange={(raw) => set('to', raw)}
    placeholder="alice@example.com — Enter or , to add"
    templatePlaceholder={`{{input.recipient}} or {{trigger.output.from}}`}
    chipsHint={`One or more recipients. Use Template mode for <code>{{input.x}}</code> values.`}
    templateHint={`Templates supported: <code>{{input.field}}</code>. Comma-separate for multiple.`}
  />

  <details class="em-cc">
    <summary><span class="sr-label-tight">Cc / Bcc</span></summary>
    <RecipientListBlock
      label="Cc"
      value={config.cc}
      onChange={(raw) => set('cc', raw)}
      placeholder="cc@example.com"
      templatePlaceholder={`{{input.cc}}`}
    />
    <RecipientListBlock
      label="Bcc"
      value={config.bcc}
      onChange={(raw) => set('bcc', raw)}
      placeholder="bcc@example.com"
      templatePlaceholder={`{{input.bcc}}`}
    />
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
  <RawConfigEditor {config} {onChange} />
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
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .em-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .em-hint code, .em-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .em-info { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .em-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .em-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
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
    font-family: var(--font-code); font-size: var(--fs-label);
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
</style>
