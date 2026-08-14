<script lang="ts" module>
  export interface Stat {
    label: string;
    value: number | string;
    /** Small qualifier under the number — units, a share, a caveat. */
    note?: string | null;
    /** Reserved status colouring. Absent means ordinary ink. */
    tone?: 'good' | 'warn' | 'bad';
    /**
     * Where this number is explained. A headline figure with nowhere to go is
     * the thing that made the dashboard feel like a summary rather than a way
     * in — every tile that has a panel behind it now links to it.
     */
    href?: string;
  }
</script>

<script lang="ts">
  /**
   * Headline numbers.
   *
   * Deliberately NOT charts. Each of these is a single magnitude with no series
   * and no time axis, and the honest form for one number is the number — a
   * six-bar chart of "sources / facts / entities" would encode nothing the
   * digits do not.
   *
   * The value wears text tokens, never a series colour. `tone` is reserved for
   * genuine states (a run that found no counter-evidence, a narrow evidence
   * base) and always ships with its label, never colour alone.
   */
  let { stats = [] }: { stats: Stat[] } = $props();

  function display(v: number | string): string {
    return typeof v === 'number' ? v.toLocaleString('en-GB') : v;
  }
</script>

<div class="tiles">
  {#each stats as s (s.label)}
    <svelte:element
      this={s.href ? 'a' : 'div'}
      class="tile"
      class:linked={!!s.href}
      href={s.href}
    >
      <div class="value {s.tone ?? ''}">{display(s.value)}</div>
      <div class="label">{s.label}</div>
      {#if s.note}<div class="note">{s.note}</div>{/if}
    </svelte:element>
  {/each}
</div>

<style>
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
  .tile { border: 1px solid var(--card-border); background: var(--surface-elevated); padding: 0.65rem 0.7rem; display: block; text-decoration: none; }
  .tile.linked { cursor: pointer; }
  .tile.linked:hover { border-color: var(--accent); }
  .tile.linked:hover .label { color: var(--accent); }
  .value { font-family: var(--font-display); font-size: 1.6rem; font-weight: 900; line-height: 1.05; color: var(--text-primary); }
  .value.good { color: var(--success); }
  .value.warn { color: var(--warn); }
  .value.bad { color: var(--error); }
  .label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); margin-top: 0.25rem; }
  .note { font-size: 0.76rem; color: var(--text-ghost); margin-top: 0.15rem; line-height: 1.3; }
</style>
