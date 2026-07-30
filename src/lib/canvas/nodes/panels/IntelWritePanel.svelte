<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';

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

  // ---------- Field readers ------------------------------------------------
  // The intel-write executor (src/lib/workflows/nodes/intel-write.ts) reads:
  //   - title         : string (optional, supports {{input.field}} templates)
  //   - content       : string (required, supports templates) — embedded body
  //   - format        : 'summary' | 'text' | 'email' | 'meeting_transcript'
  //   - sourceTag     : string (optional, templated, stored in metadata)
  //   - sourceUrl     : string (optional, templated, stored in metadata)
  //   - extraMetadata : string of JSON (optional, templated, merged into meta)
  //
  // We expose structured editors for each. Unknown keys are preserved via the
  // spread in `set()` so future fields aren't silently dropped.

  const ALLOWED_FORMATS = ['summary', 'text', 'email', 'meeting_transcript'] as const;
  type FormatT = (typeof ALLOWED_FORMATS)[number];

  const title = $derived(String(config.title ?? ''));
  const content = $derived(String(config.content ?? ''));
  const formatRaw = $derived(String(config.format ?? 'summary'));
  const format = $derived<FormatT>(
    (ALLOWED_FORMATS as readonly string[]).includes(formatRaw) ? (formatRaw as FormatT) : 'summary',
  );
  const sourceTag = $derived(String(config.sourceTag ?? ''));
  const sourceUrl = $derived(String(config.sourceUrl ?? ''));
  const extraMetadata = $derived(String(config.extraMetadata ?? ''));

  const contentEmpty = $derived(content.trim().length === 0);

  // Validate the extraMetadata JSON-ish field. We allow templates to leak in,
  // so we strip {{...}} tokens before parsing to detect *structural* issues
  // (vs. perfectly-valid template placeholders that JSON.parse can't handle).
  const extraMetadataState = $derived.by<'empty' | 'ok' | 'templated' | 'invalid'>(() => {
    const raw = extraMetadata.trim();
    if (!raw) return 'empty';
    const stripped = raw.replace(/\{\{[^}]*\}\}/g, '"__tpl__"');
    try {
      const parsed = JSON.parse(stripped);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return raw === stripped ? 'ok' : 'templated';
      }
      return 'invalid';
    } catch {
      return 'invalid';
    }
  });

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Raw JSON ----------------------------------------------------

  let showRawJson = $state(false);
  let showAdvanced = $state(
    sourceTag.trim().length > 0 || sourceUrl.trim().length > 0 || extraMetadata.trim().length > 0,
  );

  // `definition` referenced for typings only; the canvas-level header renders
  // the "What this does" preview line.
  void definition;
</script>

<div class="iw">
  <!-- Content (required) -->
  <section class="iw-sec">
    <header class="iw-sec-hdr">
      <span class="sr-label-tight">Content</span>
      {#if contentEmpty}<span class="iw-warn">required</span>{/if}
    </header>
    <label class="iw-field">
      <span class="iw-label">Note body</span>
      <TemplatedTextarea
        class="iw-code iw-content"
        rows={6}
        spellcheck={false}
        placeholder={`{{input.summary}}\n\nSource: {{input.url}}`}
        value={content}
        upstreamFields={upstreamFields}
        onChange={(v) => set('content', v)}
      />
      <span class="iw-hint">
        Markdown or plain text. Templates supported: <code>{`{{input.field}}`}</code>. This is what
        gets embedded and extracted into entities + relationships.
      </span>
    </label>
  </section>

  <!-- Title -->
  <section class="iw-sec">
    <header class="iw-sec-hdr"><span class="sr-label-tight">Title</span></header>
    <label class="iw-field">
      <span class="iw-label">Title (optional)</span>
      <textarea
        class="iw-code iw-title"
        rows="2"
        spellcheck="false"
        placeholder={'e.g. {{input.headline}}'}
        value={title}
        oninput={(e) => set('title', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="iw-hint">Leave blank to let intel derive a title from the content.</span>
    </label>
  </section>

  <!-- Format -->
  <section class="iw-sec">
    <header class="iw-sec-hdr"><span class="sr-label-tight">Format</span></header>
    <label class="iw-field">
      <span class="iw-label">Content format</span>
      <select
        value={format}
        onchange={(e) => set('format', (e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="summary">Summary (LLM brief)</option>
        <option value="text">Text (raw note)</option>
        <option value="email">Email</option>
        <option value="meeting_transcript">Meeting transcript</option>
      </select>
      <span class="iw-hint">Hint to the intel extractor about what kind of content this is.</span>
    </label>
  </section>

  <!-- Advanced — source + metadata -->
  <details class="iw-adv" bind:open={showAdvanced}>
    <summary><span class="sr-label-tight">Advanced — source &amp; metadata</span></summary>

    <div class="iw-adv-body">
      <label class="iw-field">
        <span class="iw-label">Source tag</span>
        <textarea
          class="iw-code iw-line"
          rows="1"
          spellcheck="false"
          placeholder="e.g. daily-briefing"
          value={sourceTag}
          oninput={(e) => set('sourceTag', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="iw-hint">
          Free-text tag stored in <code>metadata.sourceTag</code>. Templated. Used for filtering
          later — does not affect dedup.
        </span>
      </label>

      <label class="iw-field">
        <span class="iw-label">Source URL</span>
        <textarea
          class="iw-code iw-line"
          rows="1"
          spellcheck="false"
          placeholder={'{{input.url}}'}
          value={sourceUrl}
          oninput={(e) => set('sourceUrl', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="iw-hint">
          Canonical URL stored in <code>metadata.sourceUrl</code> for provenance. Templated.
        </span>
      </label>

      <label class="iw-field">
        <span class="iw-label">
          Extra metadata (JSON)
          {#if extraMetadataState === 'ok'}<span class="iw-ok">JSON ✓</span>{/if}
          {#if extraMetadataState === 'templated'}<span class="iw-info">templated</span>{/if}
          {#if extraMetadataState === 'invalid'}<span class="iw-warn">invalid JSON</span>{/if}
        </span>
        <textarea
          class="iw-code"
          rows="4"
          spellcheck="false"
          placeholder={`{ "persona": "researcher", "score": {{input.score}} }`}
          value={extraMetadata}
          oninput={(e) => set('extraMetadata', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="iw-hint">
          Optional JSON object. Merged into the note metadata after template interpolation.
          Templates supported. If parsing fails at run time, the note is still written but the
          parse error is recorded under <code>_extraMetadataParseError</code>.
        </span>
      </label>
    </div>
  </details>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="iw-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="iw-code"
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
  .iw { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .iw-sec { display: flex; flex-direction: column; gap: 8px; }
  .iw-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .iw-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .iw-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; align-items: baseline; gap: 8px;
  }
  .iw-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .iw-hint code, .iw-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .iw-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }
  .iw-ok   { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-success, #2a9d4a); }
  .iw-info { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .iw-code {
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
  .iw-code:focus { border-color: var(--text-muted); }
  .iw-content { min-height: 96px; }
  .iw-title { resize: vertical; min-height: 36px; }
  .iw-line { resize: vertical; min-height: 30px; }

  .iw-adv {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    padding: 8px 10px;
  }
  .iw-adv summary { cursor: pointer; }
  .iw-adv-body {
    display: flex; flex-direction: column; gap: 12px;
    margin-top: 8px;
  }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  select:focus, textarea:focus { border-color: var(--text-muted); }

  .iw-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .iw-raw summary { cursor: pointer; }
</style>
