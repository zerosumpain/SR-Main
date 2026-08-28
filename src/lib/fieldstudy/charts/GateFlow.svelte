<script lang="ts">
  /**
   * The governed path of one request — a diagram, not a chart.
   *
   * Read left to right as the path of an analysis; the verdict row under each
   * stage is the path of consent, which is the device the source deck uses and
   * the one thing a reader has to take away. Each stage says which authority
   * acts and what a request holds at that point, because the argument being
   * made is that "asking" and "receiving" are separated by a human decision.
   *
   * Deliberately not colour-coded by actor: the only colour is the verdict,
   * and it always ships with the word next to it.
   */
  type Verdict = 'pass' | 'hold' | 'refuse';
  type Stage = { label: string; actor: string; holds: string; verdict: Verdict };

  let { data }: { data?: unknown } = $props();

  const stages = $derived((data as { stages?: Stage[] } | undefined)?.stages ?? []);
  const foot = $derived((data as { foot?: string } | undefined)?.foot ?? '');

  const VERDICT: Record<Verdict, string> = {
    pass: 'Flows',
    hold: 'Held',
    refuse: 'Refused',
  };
  const GLYPH: Record<Verdict, string> = { pass: '→', hold: '‖', refuse: '✕' };
</script>

<div class="gf">
  <ol class="gf-track">
    {#each stages as s, i (s.label)}
      <li class="gf-stage" data-verdict={s.verdict}>
        <span class="gf-no">{String(i + 1).padStart(2, '0')}</span>
        <span class="gf-actor">{s.actor}</span>
        <b class="gf-label">{s.label}</b>
        <span class="gf-holds">{s.holds}</span>
        <span class="gf-verdict">
          <span class="gf-glyph" aria-hidden="true">{GLYPH[s.verdict]}</span>{VERDICT[s.verdict]}
        </span>
      </li>
    {/each}
  </ol>
  {#if foot}<p class="gf-foot">{foot}</p>{/if}
</div>

<style>
  .gf { width: 100%; padding: 14px 16px 12px; }
  .gf-track {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 2px;
  }
  .gf-stage {
    display: grid; gap: 3px; align-content: start;
    padding: 10px 12px 11px;
    border: 1px solid var(--line);
    /* 2px of surface between adjacent fills, per the mark spec — the gap does
       the separating, not a heavier rule. */
    background: rgba(255, 255, 255, 0.4);
    min-width: 0;
  }
  .gf-no {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; color: var(--accent); font-variant-numeric: tabular-nums;
  }
  .gf-actor {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-ghost);
  }
  .gf-label { font-size: var(--fs-label); line-height: 1.35; color: var(--text-primary); }
  .gf-holds { font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); }
  .gf-verdict {
    margin-top: 5px; display: inline-flex; align-items: baseline; gap: 5px;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary);
  }
  .gf-glyph { font-size: var(--fs-label-xs); }

  [data-verdict='pass'] .gf-glyph { color: var(--success); }
  [data-verdict='hold'] .gf-glyph { color: var(--warn); }
  [data-verdict='refuse'] .gf-glyph { color: var(--error); }
  /* The held stage is the one the whole diagram exists to show. It gets the
     only emphasis in the row — a border, not a fill, so it does not read as a
     fourth category. */
  [data-verdict='hold'] { border-color: var(--warn); border-width: 1.5px; }

  .gf-foot {
    margin: 11px 0 0; font-size: var(--fs-label-xs); line-height: 1.55;
    color: var(--text-muted); max-width: 78ch;
  }
</style>
