<script lang="ts">
  import type { PanelProps } from './registry';

  let { config, onChange }: PanelProps = $props();

  let sourcePath = $state((config.sourcePath as string) ?? '');
  let itemTextPath = $state((config.itemTextPath as string) ?? '');
  let schema = $state(
    typeof config.schema === 'object' && config.schema !== null
      ? JSON.stringify(config.schema, null, 2)
      : (config.schema as string) ?? ''
  );
  let schemaError = $state<string | null>(null);
  // Empty → node's executor resolves the admin default at runtime.
  // DO NOT hardcode a specific provider model here; that's how CS Jobs
  // canvas ended up with everything pinned to gpt-4o-mini.
  let model = $state((config.model as string) ?? '');
  let instructions = $state((config.instructions as string) ?? '');

  let schemaParsed = $state<Record<string, unknown> | null>(null);

  function parseSchema(raw: string): Record<string, unknown> | null {
    if (!raw.trim()) return null;
    try {
      const p = JSON.parse(raw);
      if (typeof p === 'object' && p !== null) return p as Record<string, unknown>;
      return null;
    } catch { return null; }
  }

  function onSchemaBlur() {
    const p = parseSchema(schema);
    if (schema.trim() && p === null) {
      schemaError = 'Invalid JSON';
    } else {
      schemaError = null;
      schemaParsed = p;
      emit();
    }
  }

  function emit() {
    const out: Record<string, unknown> = { sourcePath, model };
    if (itemTextPath) out.itemTextPath = itemTextPath;
    const p = schemaParsed ?? parseSchema(schema);
    if (p) out.schema = p;
    if (instructions) out.instructions = instructions;
    onChange(out);
  }

  // Equality-guarded prop → state sync. Unguarded re-assigns trigger the
  // effect to re-run on its own writes, which can cascade into
  // effect_update_depth_exceeded when combined with other panels writing
  // back through onChange.
  $effect(() => {
    const nextSourcePath = (config.sourcePath as string) ?? '';
    if (nextSourcePath !== sourcePath) sourcePath = nextSourcePath;
    const nextItemTextPath = (config.itemTextPath as string) ?? '';
    if (nextItemTextPath !== itemTextPath) itemTextPath = nextItemTextPath;
    const nextModel = (config.model as string) ?? '';
    if (nextModel !== model) model = nextModel;
    const nextInstructions = (config.instructions as string) ?? '';
    if (nextInstructions !== instructions) instructions = nextInstructions;
    const s = config.schema;
    let nextSchema = schema;
    if (s && typeof s === 'object') nextSchema = JSON.stringify(s, null, 2);
    else if (typeof s === 'string') nextSchema = s;
    if (nextSchema !== schema) schema = nextSchema;
  });
</script>

<div class="panel">
  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Source path</span>
    </div>
    <input class="ps-input" type="text" value={sourcePath}
      oninput={(e) => { sourcePath = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="input.scraped.pages" />
    <div class="ps-hint">Dot-notation path to the field to extract from; string or array.</div>
  </section>

  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Item text path</span>
      <span class="ps-meta">optional — used when source is an array</span>
    </div>
    <input class="ps-input" type="text" value={itemTextPath}
      oninput={(e) => { itemTextPath = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="content" />
  </section>

  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Schema (JSON)</span>
      <span class="ps-meta">fields to extract</span>
    </div>
    <div class="ps-field" class:has-error={!!schemaError}>
      <textarea
        class="ps-textarea ps-textarea-code"
        rows="7"
        spellcheck="false"
        value={schema}
        oninput={(e) => { schema = (e.target as HTMLTextAreaElement).value; schemaError = null; }}
        onblur={onSchemaBlur}
        placeholder={'{\n  "title": "string",\n  "salary": "string | null",\n  "location": "string"\n}'}
      ></textarea>
    </div>
    {#if schemaError}
      <div class="ps-error">{schemaError}</div>
    {/if}
  </section>

  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Model</span></div>
    <input class="ps-input" type="text" value={model}
      oninput={(e) => { model = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="leave blank for the admin chat default" />
    <div class="ps-hint">
      Empty uses whatever's configured in <code>/admin/models</code>.
      Slashed IDs (e.g. <code>anthropic/claude-3.5-sonnet</code>) route via OpenRouter.
    </div>
  </section>

  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Instructions</span>
      <span class="ps-meta">optional — extra context for the LLM</span>
    </div>
    <div class="ps-field">
      <textarea
        class="ps-textarea"
        rows="3"
        value={instructions}
        oninput={(e) => { instructions = (e.target as HTMLTextAreaElement).value; emit(); }}
        placeholder="Extract structured job posting data. Return null for missing fields."
      ></textarea>
    </div>
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
  .ps-field { border: 1px solid var(--card-border); }
  .ps-field.has-error { border-color: #c44; }
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
  .ps-textarea-code {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .ps-error {
    font-family: var(--font-mono);
    font-size: 10px;
    color: #c44;
  }
</style>
