<script lang="ts">
  // Max-tokens integer input with sensible-default coercion.

  let {
    value,
    onChange,
    label = 'Max Tokens',
    min = 1,
    fallback = 1024,
    hint = 'Maximum length of the AI response (roughly 4 characters per token).',
  }: {
    value: number;
    onChange: (v: number) => void;
    label?: string;
    min?: number;
    /** Used when the input parses to NaN/0/negative. */
    fallback?: number;
    hint?: string;
  } = $props();
</script>

<section class="mt-sec">
  <label class="mt-field mt-field-narrow">
    <span class="mt-label">{label}</span>
    <input
      type="number"
      {min}
      step="1"
      {value}
      oninput={(e) => {
        const raw = Number((e.currentTarget as HTMLInputElement).value);
        const n = Number.isFinite(raw) && raw >= min ? Math.floor(raw) : fallback;
        onChange(n);
      }}
    />
    {#if hint}<span class="mt-hint">{hint}</span>{/if}
  </label>
</section>

<style>
  .mt-sec { display: flex; flex-direction: column; gap: 8px; }
  .mt-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .mt-field-narrow { max-width: 220px; }
  .mt-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .mt-hint { font-size: 11px; color: var(--text-ghost); }
  input[type='number'] {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='number']:focus { border-color: var(--text-muted); }
</style>
