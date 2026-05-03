<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ExpressionRuleBuilder from './widgets/ExpressionRuleBuilder.svelte';

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

  void definition;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // The rule builder / advanced textarea + compile logic lives in
  // <ExpressionRuleBuilder/>. The widget commits the compiled JS expression
  // straight into config.expression, so the test runner below just reads
  // config.expression — no separate "live" copy needed.

  let sampleJson = $state('{\n  "value": 42\n}');
  let testResult = $state<null | { ok: true; value: boolean } | { ok: false; error: string }>(null);

  function runTest() {
    let parsed: unknown;
    try {
      parsed = sampleJson.trim() ? JSON.parse(sampleJson) : {};
    } catch (err: unknown) {
      testResult = { ok: false, error: `Sample JSON: ${err instanceof Error ? err.message : String(err)}` };
      return;
    }
    try {
      const expr = String(config.expression ?? '') || 'false';
      const fn = new Function('input', `return (${expr});`) as (i: unknown) => unknown;
      const out = fn(parsed);
      testResult = { ok: true, value: !!out };
    } catch (err: unknown) {
      testResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  let showRawJson = $state(false);
</script>

<div class="cd">
  <ExpressionRuleBuilder
    value={String(config.expression ?? '')}
    onChange={(expr) => set('expression', expr)}
    upstreamFields={upstreamFields}
    advancedPlaceholder="input.score > 80 && input.tier === 'gold'"
    advancedHint="Use this when the rule builder can't express what you need (e.g. <code>input.a && input.b > 10</code> mixed AND/OR or method calls). Single boolean expression only — no <code>const</code>/<code>let</code>, no blocks."
  />

  <!-- Test against sample input -->
  <section class="cd-sec">
    <header class="cd-sec-hdr">
      <span class="sr-label-tight">Test against</span>
      {#if testResult && testResult.ok}
        <span class="cd-result" class:cd-result-true={testResult.value} class:cd-result-false={!testResult.value}
          >→ {testResult.value}</span>
      {:else if testResult && !testResult.ok}
        <span class="cd-result cd-result-err">→ error: {testResult.error}</span>
      {/if}
    </header>
    <label class="cd-field">
      <span class="cd-label">Sample input JSON</span>
      <textarea
        class="cd-code"
        rows="5"
        spellcheck="false"
        value={sampleJson}
        oninput={(e) => { sampleJson = (e.currentTarget as HTMLTextAreaElement).value; }}
      ></textarea>
    </label>
    <button type="button" class="cd-test" onclick={runTest}>Test</button>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="cd-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="cd-code"
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
  .cd { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .cd-sec { display: flex; flex-direction: column; gap: 8px; }
  .cd-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .cd-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .cd-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .cd-code {
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
  .cd-code:focus { border-color: var(--text-muted); }

  .cd-test {
    align-self: flex-start;
    padding: 5px 14px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .cd-test:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }

  .cd-result {
    font-family: var(--font-mono); font-size: 10px;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
  }
  .cd-result-true { color: var(--status-success, #2a9d4a); border-color: color-mix(in srgb, var(--status-success, #2a9d4a) 35%, transparent); }
  .cd-result-false { color: var(--text-muted); }
  .cd-result-err { color: var(--status-error, #c0392b); border-color: color-mix(in srgb, var(--status-error, #c0392b) 35%, transparent); }

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
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .cd-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .cd-raw summary { cursor: pointer; }
</style>
