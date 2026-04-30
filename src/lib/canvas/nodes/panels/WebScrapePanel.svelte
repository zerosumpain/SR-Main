<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedInput from './shared/TemplatedInput.svelte';

  let {
    config,
    onChange,
    definition,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    upstreamFields?: string[];
  } = $props();

  // The web-scrape executor (`src/lib/workflows/nodes/web-scrape.ts`) reads:
  //   - config.url     (string, required, supports {{input.field}})
  //   - config.maxChars (number, 0 = no limit)
  //   - config._onError (handled by OnErrorBlock)
  // Anything else in config is preserved untouched (raw JSON pass-through).
  // Extraction is delegated to Mozilla Readability on the fetched HTML, so
  // there is no selector / extract-mode / multiple knob to expose — the
  // canonical promise of this node is "give me the article text".

  const url = $derived(String(config.url ?? ''));
  const maxChars = $derived(Number(config.maxChars ?? 0));

  const urlEmpty = $derived(url.trim().length === 0);
  const urlSchemeOk = $derived.by(() => {
    const v = url.trim();
    if (!v) return null;
    // Allow templates that may resolve at runtime — only flag clearly bad literals.
    if (v.includes('{{')) return true;
    return /^https?:\/\//i.test(v);
  });

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

<div class="ws">
  <!-- URL -->
  <section class="ws-sec">
    <header class="ws-sec-hdr">
      <span class="sr-label-tight">Target URL</span>
      {#if urlEmpty}
        <span class="ws-warn">required</span>
      {:else if urlSchemeOk === false}
        <span class="ws-warn">must start with http:// or https://</span>
      {/if}
    </header>
    <label class="ws-field">
      <span class="ws-label">URL</span>
      <TemplatedInput
        spellcheck={false}
        value={url}
        upstreamFields={upstreamFields}
        placeholder="https://example.com/article"
        onChange={(v) => set('url', v)}
      />
      <span class="ws-hint">
        Templates supported: <code>{`{{input.url}}`}</code>. Mozilla Readability strips nav/ads
        and returns the main article text — no CSS selector needed.
      </span>
    </label>
  </section>

  <!-- Truncation -->
  <section class="ws-sec">
    <header class="ws-sec-hdr">
      <span class="sr-label-tight">Output limits</span>
      <span class="ws-sec-meta">{maxChars > 0 ? `truncate at ${maxChars.toLocaleString()} chars` : 'no limit'}</span>
    </header>
    <label class="ws-field">
      <span class="ws-label">Max characters</span>
      <input
        type="number"
        min="0"
        step="500"
        value={maxChars}
        oninput={(e) => {
          const n = Number((e.currentTarget as HTMLInputElement).value);
          set('maxChars', Number.isFinite(n) && n >= 0 ? n : 0);
        }}
      />
      <span class="ws-hint">
        Truncate extracted text to this many characters. <code>0</code> = no limit. Output includes
        a <code>truncated</code> flag so downstream nodes can detect cut-off text.
      </span>
    </label>
  </section>

  <!-- Output shape (informational) -->
  <section class="ws-sec ws-sec-info">
    <header class="ws-sec-hdr"><span class="sr-label-tight">Output shape</span></header>
    <p class="ws-empty">
      <code>{`{ url, success, title, text, length, truncated }`}</code>
    </p>
    <span class="ws-hint">
      Access extracted text via <code>{`{{input.text}}`}</code> on the next node.
      On fetch failure: <code>success: false</code> with an <code>error</code> string.
    </span>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="ws-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="ws-code"
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
  .ws { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .ws-sec { display: flex; flex-direction: column; gap: 8px; }
  .ws-sec-info { opacity: 0.85; }
  .ws-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .ws-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .ws-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .ws-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .ws-hint { font-size: 11px; color: var(--text-ghost); }
  .ws-hint code, .ws-label code { font-size: 11px; color: var(--text-muted); }
  .ws-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .ws-empty code { font-size: 11px; color: var(--text-muted); }

  .ws-warn { font-family: var(--font-mono); font-size: 10px; color: var(--status-error, #c0392b); }

  .ws-code {
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
  .ws-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, textarea:focus { border-color: var(--text-muted); }

  .ws-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .ws-raw summary { cursor: pointer; }
</style>
