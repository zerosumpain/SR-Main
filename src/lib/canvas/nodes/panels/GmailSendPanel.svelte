<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import GmailAccountPicker from './widgets/GmailAccountPicker.svelte';
  import RecipientListBlock from './widgets/RecipientListBlock.svelte';
  import BodyTabsBlock from './widgets/BodyTabsBlock.svelte';

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

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gs">
  <GmailAccountPicker
    value={config.accountId as number | string | null | undefined}
    onChange={(next) => set('accountId', next)}
    title="Sending account"
  />

  <RecipientListBlock
    label="To"
    value={config.to}
    onChange={(raw) => set('to', raw)}
    placeholder="alice@example.com — Enter or , to add"
    templatePlaceholder={`{{input.recipient}} or {{trigger.output.from}}`}
    chipsHint={`One or more recipients. Use Template mode for <code>{{input.x}}</code> values.`}
    templateHint={`Templates supported: <code>{{input.field}}</code>. Comma-separate for multiple.`}
  />

  <details class="gs-cc">
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
  <section class="gs-sec">
    <header class="gs-sec-hdr"><span class="sr-label-tight">Subject</span></header>
    <label class="gs-field">
      <span class="gs-label">Subject line</span>
      <input
        type="text"
        spellcheck="false"
        placeholder="Daily digest for {`{{input.date}}`}"
        value={String(config.subject ?? '')}
        oninput={(e) => set('subject', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="gs-hint">Templates supported: <code>{`{{input.field}}`}</code></span>
    </label>
  </section>

  <BodyTabsBlock
    text={String(config.bodyText ?? '')}
    html={String(config.bodyHtml ?? '')}
    onChangeText={(v) => set('bodyText', v)}
    onChangeHtml={(v) => set('bodyHtml', v)}
    textPlaceholder={`Hello,\n\n{{input.summary}}`}
    htmlPlaceholder={`<p>{{input.summary}}</p>`}
  />

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gs-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gs-code"
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
  .gs { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gs-sec { display: flex; flex-direction: column; gap: 8px; }
  .gs-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .gs-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gs-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gs-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .gs-hint code, .gs-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .gs-hint a { color: var(--accent); text-decoration: none; }
  .gs-hint a:hover { text-decoration: underline; }

  .gs-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .gs-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }

  .gs-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .gs-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .gs-mode-btn + .gs-mode-btn { border-left: 1px solid var(--card-border); }
  .gs-mode-btn:hover { color: var(--text-primary); }
  .gs-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .gs-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .gs-code:focus { border-color: var(--text-muted); }

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

  .gs-cc {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gs-cc[open] { padding-bottom: 10px; }
  .gs-cc summary { cursor: pointer; padding: 2px 0; }
  .gs-cc > .gs-sec { margin-top: 8px; }

  .gs-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gs-raw summary { cursor: pointer; }
</style>
