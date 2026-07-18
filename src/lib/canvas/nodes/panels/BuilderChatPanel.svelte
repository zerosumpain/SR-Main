<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  void definition;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const prompt = $derived(String(config.prompt ?? ''));
  const thinkingLevel = $derived(String(config.thinkingLevel ?? 'medium'));
  const enforceDesignSystem = $derived(config.enforceDesignSystem !== false);
  const planFirst = $derived(config.planFirst === true);
  const modelProvider = $derived(String(config.modelProvider ?? ''));
  const modelId = $derived(String(config.modelId ?? ''));
  const buildId = $derived(String(config.buildId ?? ''));

  function num(k: string, fallback: number | null): number | null {
    const v = config[k];
    if (v === null || v === undefined || v === '') return fallback;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  const minIterations = $derived(num('minIterations', null));
  const maxIterations = $derived(num('maxIterations', 25));
  const maxTotalMinutes = $derived(num('maxTotalMinutes', 120));
  const maxTokensPerHour = $derived(num('maxTokensPerHour', 1_000_000));
  const activeMinutesPerHour = $derived(num('activeMinutesPerHour', 15));

  let showRawJson = $state(false);
</script>

<div class="bcp">
  <!-- Build outcome — primary input is the chat body; this is the default. -->
  <section class="bcp-sec">
    <header class="bcp-sec-hdr">
      <span class="sr-label-tight">Default outcome</span>
      <span class="bcp-sec-meta">edit in the chat node — this is the seed</span>
    </header>
    <label class="bcp-field">
      <span class="bcp-label">Prompt</span>
      <textarea
        class="bcp-code"
        rows="5"
        spellcheck="false"
        placeholder={'Build me a calculator with history…'}
        value={prompt}
        oninput={(e) => set('prompt', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="bcp-hint">
        The chat node pre-fills its composer with this. Edit there and press ⏎ to start.
        This field is also what programmatic workflow runs send (with template support).
      </span>
    </label>
    {#if buildId}
      <div class="bcp-buildid">
        <span class="bcp-label">Active build</span>
        <code class="bcp-code-inline">{buildId}</code>
        <button type="button" class="bcp-link" onclick={() => set('buildId', '')} title="Detach from this build (does not stop it)">detach</button>
      </div>
    {/if}
  </section>

  <!-- Reasoning + design -->
  <section class="bcp-sec">
    <header class="bcp-sec-hdr"><span class="sr-label-tight">Reasoning &amp; design</span></header>
    <label class="bcp-field">
      <span class="bcp-label">Thinking level</span>
      <select
        value={thinkingLevel}
        onchange={(e) => set('thinkingLevel', (e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="off">off — fastest</option>
        <option value="minimal">minimal</option>
        <option value="low">low</option>
        <option value="medium">medium (default)</option>
        <option value="high">high</option>
        <option value="xhigh">xhigh — deepest</option>
      </select>
    </label>
    <label class="bcp-checkbox">
      <input
        type="checkbox"
        checked={enforceDesignSystem}
        onchange={(e) => set('enforceDesignSystem', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Design conformity — enforce SR design system</span>
    </label>
    <label class="bcp-checkbox">
      <input
        type="checkbox"
        checked={planFirst}
        onchange={(e) => set('planFirst', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Plan first — proposer/critic debate before iteration 1</span>
    </label>
  </section>

  <!-- Iterations + budget -->
  <section class="bcp-sec">
    <header class="bcp-sec-hdr"><span class="sr-label-tight">Iterations &amp; budget</span></header>
    <div class="bcp-grid2">
      <label class="bcp-field">
        <span class="bcp-label">Min iterations <span class="bcp-opt">optional</span></span>
        <input
          type="number"
          min="0"
          step="1"
          value={minIterations ?? ''}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            set('minIterations', v === '' ? null : Number(v));
          }}
        />
      </label>
      <label class="bcp-field">
        <span class="bcp-label">Max iterations</span>
        <input
          type="number"
          min="1"
          step="1"
          value={maxIterations ?? ''}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            set('maxIterations', v === '' ? null : Number(v));
          }}
        />
      </label>
      <label class="bcp-field">
        <span class="bcp-label">Max total minutes</span>
        <input
          type="number"
          min="1"
          step="1"
          value={maxTotalMinutes ?? ''}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            set('maxTotalMinutes', v === '' ? null : Number(v));
          }}
        />
      </label>
      <label class="bcp-field">
        <span class="bcp-label">Active min / hr</span>
        <input
          type="number"
          min="1"
          max="60"
          step="1"
          value={activeMinutesPerHour ?? ''}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            set('activeMinutesPerHour', v === '' ? null : Number(v));
          }}
        />
      </label>
      <label class="bcp-field bcp-field-wide">
        <span class="bcp-label">Max tokens / hr</span>
        <input
          type="number"
          min="0"
          step="10000"
          value={maxTokensPerHour ?? ''}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            set('maxTokensPerHour', v === '' ? null : Number(v));
          }}
        />
      </label>
    </div>
  </section>

  <!-- Model -->
  <section class="bcp-sec">
    <header class="bcp-sec-hdr">
      <span class="sr-label-tight">Model</span>
      <span class="bcp-sec-meta">leave blank for site default</span>
    </header>
    <div class="bcp-grid2">
      <label class="bcp-field">
        <span class="bcp-label">Provider</span>
        <select
          value={modelProvider}
          onchange={(e) => set('modelProvider', (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">(default)</option>
          <option value="openrouter">openrouter</option>
        </select>
      </label>
      <label class="bcp-field">
        <span class="bcp-label">Model id</span>
        <input
          type="text"
          spellcheck="false"
          placeholder={'z-ai/glm-5.2 or openai/gpt-4o'}
          value={modelId}
          oninput={(e) => set('modelId', (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>
    <span class="bcp-hint">Both blank = use the admin-configured builder default.</span>
  </section>

  <!-- Notes for downstream -->
  <section class="bcp-sec bcp-sec-quiet">
    <header class="bcp-sec-hdr"><span class="sr-label-tight">Downstream</span></header>
    <p class="bcp-empty">
      Wire <strong>Builder Chat → Builder Pi</strong> to drive a build from this chat. The Pi node will pick up the build started here.
      Inside the chat node body: plain text starts/continues the build, <code>/btw …</code> queues an inject, <code>/wtf …</code> interrupts then injects, <code>$ …</code> runs a shell command, <code># …</code> pins a note.
    </p>
  </section>

  <!-- Advanced raw JSON -->
  <details class="bcp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="bcp-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .bcp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bcp-sec { display: flex; flex-direction: column; gap: 8px; }
  .bcp-sec-quiet { opacity: 0.85; }
  .bcp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bcp-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .bcp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .bcp-field-wide { grid-column: 1 / -1; }
  .bcp-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

  .bcp-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .bcp-req { color: var(--status-error, #c0392b); font-size: 9px; }
  .bcp-opt { color: var(--text-ghost); font-size: 9px; }
  .bcp-hint { font-size: 11px; color: var(--text-ghost); }
  .bcp-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .bcp-empty code, .bcp-hint code { font-size: 11px; color: var(--text-muted); }

  .bcp-checkbox {
    display: inline-flex; gap: 8px; align-items: center;
    font-size: 12px; color: var(--text-primary);
  }
  .bcp-checkbox input { accent-color: var(--accent); width: 14px; height: 14px; }

  .bcp-buildid {
    display: inline-flex; gap: 8px; align-items: baseline;
    padding: 5px 8px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .bcp-code-inline { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
  .bcp-link {
    background: transparent; border: none; padding: 0;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--accent); cursor: pointer;
  }
  .bcp-link:hover { text-decoration: underline; }

  .bcp-code {
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
  .bcp-code:focus { border-color: var(--text-muted); }

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

  .bcp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bcp-raw summary { cursor: pointer; }
</style>
