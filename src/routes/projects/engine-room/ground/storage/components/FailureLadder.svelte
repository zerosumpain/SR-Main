<script lang="ts">
  // FailureLadder — break something and see what actually gets it back.
  //
  // Backups are usually drawn as a topology, which answers "what exists" and not "what
  // survives what". This is the inverse: the reader picks a failure and the recovery is
  // enumerated in the order it would actually be reached. The last item on the list has no
  // recovery at all, which is the only reason the instrument earns its place — a ladder where
  // every rung holds teaches nothing.
  import { FAILURES } from '../../../lib/ground';

  let sel = $state(FAILURES[1].id);
  const f = $derived(FAILURES.find((x) => x.id === sel) ?? FAILURES[1]);
</script>

<div class="fl">
  <div class="picks" role="group" aria-label="Failures">
    {#each FAILURES as x (x.id)}
      <button type="button" class:on={sel === x.id} class:fatal={x.fatal} aria-pressed={sel === x.id}
              onclick={() => (sel = x.id)}>{x.label}</button>
    {/each}
  </div>

  <div class="out" class:fatal={f.fatal} aria-live="polite">
    <span class="o-kick">{f.fatal ? 'nothing recovers this on its own' : 'recovered by'}</span>
    <ol class="steps">
      {#each f.recovers as r, i (r)}
        <li><span class="s-n">{i + 1}</span><span class="s-t">{r}</span></li>
      {/each}
    </ol>
    <p class="o-cost"><b>What it still costs.</b> {f.cost}</p>
  </div>
</div>

<style>
  .fl { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .picks { display: flex; gap: 5px; flex-wrap: wrap; }
  .picks button { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer;
    transition: background 0.12s, border-color 0.12s; }
  .picks button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .picks button.on { background: #5a6b7a; border-color: #5a6b7a; color: #fff; }
  .picks button.fatal { border-style: dashed; }
  .picks button.fatal.on { background: #8a2d3a; border-color: #8a2d3a; border-style: solid; }

  .out { padding: 11px 14px; border-left: 3px solid #5a6b7a;
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; background: rgba(90,107,122,0.09); }
  .out.fatal { border-left-color: #8a2d3a; background: rgba(138,45,58,0.07); }
  .o-kick { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: #5a6b7a; margin-bottom: 7px; }
  .out.fatal .o-kick { color: #8a2d3a; }

  .steps { margin: 0 0 9px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .steps li { display: flex; align-items: baseline; gap: 9px; }
  .s-n { flex-shrink: 0; width: 18px; height: 18px; display: grid; place-items: center;
    border-radius: var(--radius-pill); background: rgba(90,107,122,0.22);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: #46545f; }
  .out.fatal .s-n { background: rgba(138,45,58,0.18); color: #8a2d3a; }
  .s-t { font-size: var(--fs-label); line-height: 1.5; color: var(--text-primary); }

  .o-cost { margin: 0; padding-top: 8px; border-top: 1px dashed rgba(28,22,17,0.16);
    font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 86ch; }
  .o-cost b { color: var(--text-primary); }
</style>
