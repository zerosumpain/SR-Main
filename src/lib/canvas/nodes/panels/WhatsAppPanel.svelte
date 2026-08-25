<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import NodeMemoryBlock from './shared/NodeMemoryBlock.svelte';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import PhoneField from './widgets/PhoneField.svelte';
  import { WHATSAPP_SENT_HASHES_KEY } from '$lib/canvas/node-memory-keys';

  let {
    config,
    onChange,
    definition,
    workflowId,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    workflowId?: string;
  } = $props();

  // ---------- Recipient mode (Static phone vs Template) -------------------
  // The executor reads `config.to` as a single string (and runs template
  // interpolation on it). We keep that contract intact: this panel only
  // toggles which UI widget edits the same field.
  //
  // Auto-detect rule on mount:
  //   - starts with `+` AND no `{{` token → Static phone
  //   - otherwise (empty / contains template / non-E164) → Template
  // The user can flip the toggle at any time; switching modes does NOT
  // mutate `config.to` so a template stays preserved if they peek at the
  // static editor and toggle back.

  function detectMode(raw: string): 'static' | 'template' {
    const v = (raw ?? '').trim();
    if (!v) return 'static';
    if (v.includes('{{')) return 'template';
    if (v.startsWith('+')) return 'static';
    return 'template';
  }

  const initialTo = String(config.to ?? '');
  let toMode = $state<'static' | 'template'>(detectMode(initialTo));

  function setTo(value: string) {
    onChange({ ...config, to: value });
  }
  function setMessage(value: string) {
    onChange({ ...config, message: value });
  }
  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Message --------------------------------------------------
  // 1024 char cap is a soft, displayed-only limit (matches the WhatsApp
  // text-message practical limit; the executor does not enforce it).

  const MESSAGE_LIMIT = 1024;
  const toValue = $derived(String(config.to ?? ''));
  const messageValue = $derived(String(config.message ?? ''));
  const messageLen = $derived(messageValue.length);
  const messageOver = $derived(messageLen > MESSAGE_LIMIT);

  // ---------- Options / Media -----------------------------------------
  const formatMarkdown = $derived(config.formatMarkdown !== false); // default true
  const maxChunks = $derived.by(() => {
    const raw = config.maxChunks;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;
  });
  const suppressMins = $derived.by(() => {
    const raw = config.suppressDuplicateWindowMins;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  });
  const mediaPathValue = $derived(String(config.mediaPath ?? ''));
  const mediaUrlValue = $derived(String(config.mediaUrl ?? ''));
  const captionValue = $derived(String(config.caption ?? ''));

  let showMedia = $state(!!(config.mediaPath || config.mediaUrl));

  // ---------- Raw JSON -------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="wa">
  <!-- Recipient -->
  <section class="wa-sec">
    <header class="wa-sec-hdr">
      <span class="sr-label-tight">Recipient</span>
      <div class="wa-mode-toggle" role="tablist" aria-label="Recipient input mode">
        <button
          type="button"
          class="wa-mode-btn"
          class:wa-mode-btn-active={toMode === 'static'}
          role="tab"
          aria-selected={toMode === 'static'}
          onclick={() => (toMode = 'static')}
        >Static phone</button>
        <button
          type="button"
          class="wa-mode-btn"
          class:wa-mode-btn-active={toMode === 'template'}
          role="tab"
          aria-selected={toMode === 'template'}
          onclick={() => (toMode = 'template')}
        >From upstream / template</button>
      </div>
    </header>

    {#if toMode === 'static'}
      <label class="wa-field">
        <span class="wa-label">Phone (E.164)</span>
        <PhoneField value={toValue} onChange={(v) => setTo(v)} />
        <span class="wa-hint">Country code + national number. Stored as <code>+44 7359228511</code>.</span>
      </label>
    {:else}
      <label class="wa-field">
        <span class="wa-label">Recipient template</span>
        <textarea
          class="wa-code"
          rows="2"
          spellcheck="false"
          placeholder={`{{input.phone}}`}
          value={toValue}
          oninput={(e) => setTo((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="wa-hint">Templates: <code>{`{{input.field}}`}</code>. Resolved value must be E.164 (e.g. <code>+447700900123</code>).</span>
      </label>
    {/if}
  </section>

  <!-- Message -->
  <section class="wa-sec">
    <header class="wa-sec-hdr">
      <span class="sr-label-tight">Message</span>
      <span class="wa-sec-meta" class:wa-warn={messageOver}>{messageLen} / {MESSAGE_LIMIT}</span>
    </header>
    <label class="wa-field">
      <textarea
        class="wa-code wa-message"
        rows="6"
        spellcheck="true"
        placeholder={`Hi {{input.name}}, your report is ready.`}
        value={messageValue}
        oninput={(e) => setMessage((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="wa-hint">Templates: <code>{`{{input.field}}`}</code></span>
    </label>
  </section>

  <!-- Options -->
  <section class="wa-sec">
    <header class="wa-sec-hdr">
      <span class="sr-label-tight">Options</span>
    </header>
    <label class="wa-opt">
      <input
        type="checkbox"
        checked={formatMarkdown}
        onchange={(e) => set('formatMarkdown', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>
        <span class="wa-label">Convert Markdown</span>
        <span class="wa-hint"><code>**bold**</code> → <code>*bold*</code>, <code>##</code> headings → bold lines, <code>[text](url)</code> → text (url), <code>-</code> bullets → •.</span>
      </span>
    </label>
    <div class="wa-opt-row">
      <label class="wa-field wa-field-narrow">
        <span class="wa-label">Max chunks</span>
        <input
          type="number"
          min="0"
          value={maxChunks}
          oninput={(e) => set('maxChunks', Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="wa-hint">Split &gt;4096-char messages into up to N sends. 0 = no cap.</span>
      </label>
      <label class="wa-field wa-field-narrow">
        <span class="wa-label">Suppress duplicates (mins)</span>
        <input
          type="number"
          min="0"
          value={suppressMins}
          oninput={(e) => set('suppressDuplicateWindowMins', Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="wa-hint">Skip an identical send to the same number within N minutes. 0 = off.</span>
      </label>
    </div>
    {#if suppressMins > 0}
      <!-- The hashes behind the suppression window. Without this the window is
           invisible: clearing an upstream dedupe key still won't produce a send
           until it expires. -->
      <NodeMemoryBlock
        {workflowId}
        keys={[WHATSAPP_SENT_HASHES_KEY]}
        label="Duplicate-suppression hashes"
        hint="Clearing this lets an identical message send again before the {suppressMins}-minute window expires."
      />
    {/if}
  </section>

  <!-- Media (optional) -->
  <details class="wa-media" bind:open={showMedia}>
    <summary><span class="sr-label-tight">Media attachment (optional)</span></summary>
    <label class="wa-field">
      <span class="wa-label">Media file path</span>
      <textarea
        class="wa-code"
        rows="1"
        spellcheck="false"
        placeholder={`/path/to/file.png or {{input.filePath}}`}
        value={mediaPathValue}
        oninput={(e) => set('mediaPath', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="wa-hint">Local file to send. Requires the Hermes bridge.</span>
    </label>
    <label class="wa-field">
      <span class="wa-label">Media URL</span>
      <textarea
        class="wa-code"
        rows="1"
        spellcheck="false"
        placeholder="https://…/image.png"
        value={mediaUrlValue}
        oninput={(e) => set('mediaUrl', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="wa-hint">Downloaded and sent as an attachment.</span>
    </label>
    <label class="wa-field">
      <span class="wa-label">Caption</span>
      <textarea
        class="wa-code"
        rows="2"
        spellcheck="true"
        placeholder="Optional caption"
        value={captionValue}
        oninput={(e) => set('caption', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="wa-hint">Falls back to the message text. Templates: <code>{`{{input.field}}`}</code>.</span>
    </label>
  </details>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="wa-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="wa-code"
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
  .wa { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .wa-sec { display: flex; flex-direction: column; gap: 8px; }
  .wa-sec-hdr {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .wa-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .wa-mode-toggle {
    display: inline-flex;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .wa-mode-btn {
    padding: 3px 8px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .wa-mode-btn + .wa-mode-btn { border-left: 1px solid var(--card-border); }
  .wa-mode-btn:hover { color: var(--text-primary); }
  .wa-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .wa-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .wa-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .wa-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .wa-hint code, .wa-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .wa-code {
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
  .wa-code:focus { border-color: var(--text-muted); }
  .wa-message { font-family: inherit; font-size: var(--fs-label); }

  .wa-warn { color: var(--status-error, #c0392b); }

  input[type='text'], input[type='tel'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='tel']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .wa-opt {
    display: flex; gap: 8px; align-items: flex-start;
    cursor: pointer;
  }
  .wa-opt input[type='checkbox'] { margin-top: 2px; width: auto; }
  .wa-opt > span { display: flex; flex-direction: column; gap: 2px; }
  .wa-opt-row { display: flex; gap: 12px; flex-wrap: wrap; }

  .wa-media {
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .wa-media summary { cursor: pointer; margin-bottom: 4px; }
  .wa-media[open] summary { margin-bottom: 6px; }

  .wa-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .wa-raw summary { cursor: pointer; }
</style>
