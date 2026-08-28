<script lang="ts">
  /**
   * The three-counter row, as the captured product screens draw it.
   *
   * This figure is a redrawing, not a screenshot: the point being made is
   * about the DEVICE — three states counted in one row rather than one raised
   * as an alarm, with a single emphasised counter — so the figure has to show
   * the device, and a screenshot would also show a great deal of seeded data
   * that is not the argument.
   *
   * The emphasis is a rule, never a fill: on the real screens the boxed
   * counter is the one the viewer must personally clear, and a fill would read
   * as a fourth state. Every counter carries its own word, so the ochre is
   * never doing the work alone.
   */
  type Counter = { label: string; value: number; note?: string; tone: 'done' | 'waiting' | 'refused'; boxed?: boolean };
  type Screen = { screen: string; role: string; counters: Counter[] };

  let { data }: { data?: unknown } = $props();

  const screens = $derived((data as { screens?: Screen[] } | undefined)?.screens ?? []);
  const foot = $derived((data as { foot?: string } | undefined)?.foot ?? '');
</script>

<div class="cr">
  {#each screens as s (s.screen)}
    <div class="cr-screen">
      <div class="cr-head">
        <b class="cr-name">{s.screen}</b>
        <span class="cr-role">{s.role}</span>
      </div>
      <div class="cr-row">
        {#each s.counters as c (c.label)}
          <div class="cr-cell" data-tone={c.tone} class:boxed={c.boxed}>
            <span class="cr-label">{c.label}</span>
            <span class="cr-val">{c.value}</span>
            {#if c.note}<span class="cr-note">{c.note}</span>{/if}
            {#if c.boxed}<span class="cr-emph">the viewer must clear this one</span>{/if}
          </div>
        {/each}
      </div>
    </div>
  {/each}
  {#if foot}<p class="cr-foot">{foot}</p>{/if}
</div>

<style>
  .cr { width: 100%; padding: 15px 16px 14px; display: grid; gap: 18px; }
  .cr-screen { display: grid; gap: 7px; min-width: 0; }
  .cr-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .cr-name { font-size: var(--fs-label); color: var(--text-primary); }
  .cr-role {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-ghost);
  }
  .cr-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 2px; }
  .cr-cell {
    display: grid; gap: 2px; align-content: start;
    padding: 9px 12px 11px;
    border: 1px solid var(--line-hair);
    background: rgba(255, 255, 255, 0.4);
    min-width: 0;
  }
  /* A rule, never a fill — a filled cell would read as a fourth state. */
  .cr-cell.boxed { border: 1.5px solid var(--warn); background: rgba(176, 137, 42, 0.06); }
  .cr-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-secondary);
  }
  .cr-val {
    font-family: var(--fs-serif); font-weight: 600; font-size: 30px; line-height: 1;
    font-variant-numeric: tabular-nums; color: var(--text-primary);
  }
  .cr-note { font-size: var(--fs-label-xs); line-height: 1.45; color: var(--text-muted); }
  .cr-emph {
    margin-top: 3px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.06em; color: var(--warn);
  }

  /* Tone tints the numeral only. The word above it is the actual encoding. */
  [data-tone='done'] .cr-val { color: var(--success); }
  [data-tone='waiting'] .cr-val { color: var(--warn); }
  [data-tone='refused'] .cr-val { color: var(--error); }

  .cr-foot {
    margin: 0; padding-top: 11px; border-top: 1px solid var(--line-hair);
    font-size: var(--fs-label-xs); line-height: 1.55; color: var(--text-muted); max-width: 78ch;
  }
</style>
