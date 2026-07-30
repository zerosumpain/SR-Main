<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // The executor reads `config.milliseconds` (see src/lib/workflows/nodes/delay.ts).
  // We always store an integer ms back, but expose a friendlier
  // duration + unit pair for editing.

  type Unit = 'ms' | 'seconds' | 'minutes' | 'hours';

  const UNIT_MS: Record<Unit, number> = {
    ms: 1,
    seconds: 1000,
    minutes: 60_000,
    hours: 3_600_000,
  };

  // Pick the largest unit where the displayed number is >= 1 AND the conversion
  // is "clean enough" (within a reasonable rounding tolerance for hours/minutes,
  // exact for seconds where possible). For 90000ms → 1.5 minutes, we keep
  // minutes (1.5) rather than promoting to hours (0.025) or demoting to
  // seconds (90).
  function pickUnit(ms: number): Unit {
    if (!Number.isFinite(ms) || ms <= 0) return 'seconds';
    if (ms >= UNIT_MS.hours && ms % UNIT_MS.hours === 0) return 'hours';
    if (ms >= UNIT_MS.minutes && ms % UNIT_MS.minutes === 0) return 'minutes';
    if (ms >= UNIT_MS.seconds && ms % UNIT_MS.seconds === 0) return 'seconds';
    // Non-clean fractions: prefer the largest unit that gives a value >= 1.
    if (ms >= UNIT_MS.hours) return 'hours';
    if (ms >= UNIT_MS.minutes) return 'minutes';
    if (ms >= UNIT_MS.seconds) return 'seconds';
    return 'ms';
  }

  // Source-of-truth ms (integer). Falls back to default (1000) if missing.
  const storedMs = $derived.by(() => {
    const raw = config.milliseconds;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  });

  // Local editor state — unit is sticky after the user picks it, so that
  // typing "1.5" minutes doesn't snap back to seconds on every keystroke.
  let unit = $state<Unit>(pickUnit(storedMs));
  let durationStr = $state<string>(formatDuration(storedMs, unit));

  // If the config is changed externally (e.g. via raw JSON), re-sync the
  // local view — but don't fight the user mid-edit on the same value.
  $effect(() => {
    const expected = Math.round(parseDuration(durationStr) * UNIT_MS[unit]);
    if (expected !== storedMs) {
      unit = pickUnit(storedMs);
      durationStr = formatDuration(storedMs, unit);
    }
  });

  function formatDuration(ms: number, u: Unit): string {
    const v = ms / UNIT_MS[u];
    // Trim trailing zeros after a decimal point: 1.5 stays 1.5, 5 stays 5.
    if (Number.isInteger(v)) return String(v);
    return String(Number(v.toFixed(4)));
  }

  function parseDuration(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function commit(nextDuration: string, nextUnit: Unit) {
    const ms = Math.max(0, Math.round(parseDuration(nextDuration) * UNIT_MS[nextUnit]));
    onChange({ ...config, milliseconds: ms });
  }

  function onDurationInput(s: string) {
    durationStr = s;
    commit(s, unit);
  }
  function onUnitChange(u: Unit) {
    unit = u;
    commit(durationStr, u);
  }

  const liveMs = $derived(Math.max(0, Math.round(parseDuration(durationStr) * UNIT_MS[unit])));

  // Raw JSON disclosure
  let showRawJson = $state(false);

  // `definition` is referenced only for typings; canvas-level preview
  // header handles the "What this does" line.
  void definition;
</script>

<div class="dy">
  <!-- Duration + unit -->
  <section class="dy-sec">
    <div class="dy-row">
      <label class="dy-field dy-field-duration">
        <span class="dy-label">Duration</span>
        <input
          type="number"
          min="0"
          step="any"
          value={durationStr}
          oninput={(e) => onDurationInput((e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="dy-field dy-field-unit">
        <span class="dy-label">Unit</span>
        <select value={unit} onchange={(e) => onUnitChange((e.currentTarget as HTMLSelectElement).value as Unit)}>
          <option value="ms">milliseconds</option>
          <option value="seconds">seconds</option>
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
        </select>
      </label>
    </div>
    <p class="dy-readout">= <code>{liveMs}</code> ms</p>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => onChange({ ...config, _onError: v })}
  />

  <!-- Advanced raw JSON -->
  <details class="dy-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="dy-code"
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
  .dy { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .dy-sec { display: flex; flex-direction: column; gap: 8px; }

  .dy-row { display: flex; gap: 10px; align-items: flex-end; }
  .dy-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .dy-field-duration { flex: 1; }
  .dy-field-unit { flex: 0 0 140px; }

  .dy-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .dy-readout {
    margin: 0;
    font-family: var(--font-mono); font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .dy-readout code { color: var(--accent); }

  .dy-code {
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
  .dy-code:focus { border-color: var(--text-muted); }

  input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='number']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .dy-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .dy-raw summary { cursor: pointer; }
</style>
