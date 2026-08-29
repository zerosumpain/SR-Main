<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';
  import { fetchGmailAccountOptions } from './shared/gmailAccounts';

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
  // Always spread the existing `config` so unknown keys (e.g. _onError,
  // future executor-side fields) round-trip through the editor.

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Account picker --------------------------------------------
  // gmail-fetch's executor reads `accountId` from config and falls back to
  // input.accountId if 0 — so 0 is a legitimate value (inherit from upstream
  // gmail-trigger / gmail-search output) rather than an error.
  //
  // ResourcePicker works with string values; we round-trip via String/Number.
  // A blank/templated string from the picker becomes 0 = "inherit".

  const accountId = $derived(Number(config.accountId ?? 0));
  const accountValue = $derived(
    typeof config.accountId === 'string' && config.accountId.includes('{{')
      ? config.accountId
      : accountId ? String(accountId) : '',
  );

  function setAccount(next: string) {
    if (!next) { set('accountId', 0); return; }
    if (next.includes('{{')) { set('accountId', next); return; }
    const n = Number(next);
    set('accountId', Number.isFinite(n) ? n : 0);
  }

  // ---------- Message id ------------------------------------------------
  // The executor runs strict template interpolation on `messageId`. The
  // common case is `{{trigger.output.messageId}}` (immediately downstream of
  // gmail-trigger) or `{{nodes.search.output.messages[0].id}}` (downstream
  // of gmail-search).

  const messageIdRaw = $derived(String(config.messageId ?? ''));

  function appendTemplate(snippet: string) {
    const current = messageIdRaw;
    // If the field is empty (or only whitespace), replace; otherwise append
    // with a separating space so a user can compose multiple snippets.
    const next = current.trim() === '' ? snippet : `${current} ${snippet}`;
    set('messageId', next);
  }

  const templateExamples: Array<{ label: string; value: string }> = [
    { label: 'From trigger', value: '{{trigger.output.messageId}}' },
    { label: 'From input', value: '{{input.messageId}}' },
    { label: 'First search hit', value: '{{nodes.search.output.messages[0].id}}' },
    { label: 'Reply target', value: '{{input.threadId}}' },
  ];

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gf">
  <!-- Account picker -->
  <section class="gf-sec">
    <header class="gf-sec-hdr">
      <span class="sr-label-tight">Source account</span>
      {#if !accountId}<span class="gf-info">inherits from upstream</span>{/if}
    </header>
    <ResourcePicker
      label="Account"
      value={accountValue}
      fetcher={fetchGmailAccountOptions}
      onChange={setAccount}
      placeholder="inherit from upstream (input.accountId)"
      emptyHint="No connected accounts — connect one at /admin/connections/gmail, or leave blank to inherit."
    />
    <span class="gf-hint">
      Manage connected accounts at
      <a href="/admin/connections/gmail" target="_blank" rel="noreferrer"><code>/admin/connections/gmail</code></a>.
      Leave blank to inherit from the upstream node’s output (e.g. directly after gmail-trigger or gmail-search).
    </span>
  </section>

  <!-- Template helpers (collapsed by default) -->
  <details class="gf-helpers">
    <summary><span class="sr-label-tight">Template helpers</span></summary>
    <p class="gf-hint">
      Click an example to append it to the Message ID field. Most workflows fetch the id
      that arrived from <code>gmail-trigger</code> or <code>gmail-search</code> upstream.
    </p>
    <div class="gf-chip-row">
      {#each templateExamples as ex (ex.value)}
        <button
          type="button"
          class="gf-chip"
          title={ex.value}
          onclick={() => appendTemplate(ex.value)}
        >{ex.label}</button>
      {/each}
    </div>
  </details>

  <!-- Message ID -->
  <section class="gf-sec">
    <header class="gf-sec-hdr">
      <span class="sr-label-tight">Message ID</span>
      {#if !messageIdRaw.trim()}<span class="gf-warn">⚠ required</span>{/if}
    </header>
    <label class="gf-field">
      <span class="gf-label">Gmail message id (template-aware)</span>
      <textarea
        class="gf-code"
        rows="2"
        spellcheck="false"
        placeholder={`{{trigger.output.messageId}}`}
        value={messageIdRaw}
        oninput={(e) => set('messageId', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="gf-hint">
        Templates: <code>{`{{input.field}}`}</code>,
        <code>{`{{trigger.output.messageId}}`}</code>,
        <code>{`{{nodes.<id>.output.messages[0].id}}`}</code>.
        Output: full headers, plain-text body, HTML body, and attachment metadata.
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gf-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gf-code"
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
  .gf { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gf-sec { display: flex; flex-direction: column; gap: 8px; }
  .gf-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .gf-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gf-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gf-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 0; }
  .gf-hint code, .gf-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .gf-hint a { color: var(--accent); text-decoration: none; }
  .gf-hint a:hover { text-decoration: underline; }

  .gf-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .gf-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }
  .gf-info {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .gf-helpers {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .gf-helpers[open] { padding-bottom: 10px; }
  .gf-helpers summary { cursor: pointer; padding: 2px 0; }
  .gf-helpers > .gf-hint { margin-top: 6px; }

  .gf-chip-row {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .gf-chip {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .gf-chip:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .gf-code {
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
  .gf-code:focus { border-color: var(--text-muted); }

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

  .gf-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gf-raw summary { cursor: pointer; }
</style>
