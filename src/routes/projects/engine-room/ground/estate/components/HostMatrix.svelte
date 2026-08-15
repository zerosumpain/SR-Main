<script lang="ts">
  // HostMatrix — one codebase, and the machine decides.
  //
  // A matrix rather than three lists, because the argument is about the SHAPE of the column:
  // almost everything scheduled runs in exactly one place, and the two exceptions point in
  // opposite directions. Choosing a machine dims the others so a column can be read on its
  // own; choosing none leaves the whole grid legible, which is the default for a reason.
  import { MACHINES, SUBSYSTEMS, type Place } from '../../../lib/ground';

  const COLS: Place[] = ['origin', 'house', 'runner'];
  let focus = $state<Place | null>(null);

  const machine = (p: Place) => MACHINES.find((m) => m.id === p)!;
  const runs = (id: string, p: Place) => SUBSYSTEMS.find((s) => s.id === id)!.runs.includes(p);
  const countFor = (p: Place) => SUBSYSTEMS.filter((s) => s.runs.includes(p)).length;

  let rowSel = $state<string>(SUBSYSTEMS[1].id);
  const row = $derived(SUBSYSTEMS.find((s) => s.id === rowSel) ?? SUBSYSTEMS[1]);
</script>

<div class="hm">
  <div class="grid" style="--cols:{COLS.length}">
    <div class="head">
      <span class="h-corner">runs where</span>
      {#each COLS as c (c)}
        <button type="button" class="h-col" class:on={focus === c} class:dim={focus !== null && focus !== c}
                aria-pressed={focus === c} style="--tone:{machine(c).tone}"
                onclick={() => (focus = focus === c ? null : c)}>
          <b>{machine(c).label}</b>
          <em>{countFor(c)} of {SUBSYSTEMS.length}</em>
        </button>
      {/each}
    </div>

    {#each SUBSYSTEMS as s (s.id)}
      <button type="button" class="row" class:sel={rowSel === s.id} onclick={() => (rowSel = s.id)}
              aria-pressed={rowSel === s.id}>
        <!-- The tag marks the EXCEPTION only. Nine rows reading "hostname" is nine repetitions
             of the default, which is noise; the one that is a flag is the interesting row. -->
        <span class="r-lab">{s.label}{#if s.gate === 'flag'}<i class="r-gate">a flag, not a hostname</i>{/if}</span>
        {#each COLS as c (c)}
          <span class="cell" class:yes={runs(s.id, c)} class:dim={focus !== null && focus !== c}
                style="--tone:{machine(c).tone}"
                aria-label="{s.label} {runs(s.id, c) ? 'runs on' : 'does not run on'} {machine(c).label}">
            {runs(s.id, c) ? '●' : '·'}
          </span>
        {/each}
      </button>
    {/each}
  </div>

  <div class="read" aria-live="polite">
    {#if focus}
      <span class="r-kick" style="--tone:{machine(focus).tone}">{machine(focus).label}</span>
      <p class="r-strap">{machine(focus).strap}</p>
      <p class="r-why"><b>Why it exists.</b> {machine(focus).reason}</p>
      <p class="r-why"><b>What can reach it.</b> {machine(focus).exposure}</p>
    {:else}
      <span class="r-kick">{row.label}</span>
      <p class="r-strap">{row.what}</p>
      <p class="r-why">{row.why}</p>
    {/if}
  </div>
</div>

<style>
  .hm { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  .grid { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .head { display: grid; grid-template-columns: minmax(150px, 1.6fr) repeat(var(--cols), minmax(96px, 1fr));
    gap: 6px; align-items: end; margin-bottom: 4px; }
  .h-corner { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(28,22,17,0.4); padding-bottom: 4px; }
  .h-col { display: flex; flex-direction: column; gap: 1px; text-align: center;
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.16);
    border-bottom: 3px solid var(--tone); border-radius: var(--radius-sharp);
    padding: 7px 8px; cursor: pointer; transition: background 0.13s, opacity 0.13s; }
  .h-col:hover { background: rgba(255,255,255,0.9); }
  .h-col.on { background: color-mix(in srgb, var(--tone) 14%, transparent); }
  .h-col.dim { opacity: 0.4; }
  .h-col b { font-size: var(--fs-label-xs); font-weight: 600; color: var(--text-primary); line-height: 1.2; }
  .h-col em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: rgba(28,22,17,0.45); }

  .row { display: grid; grid-template-columns: minmax(150px, 1.6fr) repeat(var(--cols), minmax(96px, 1fr));
    gap: 6px; align-items: center; width: 100%; text-align: left; cursor: pointer;
    background: rgba(255,255,255,0.5); border: 1px solid transparent;
    border-radius: var(--radius-sharp); padding: 5px 9px; font-family: inherit;
    transition: background 0.12s, border-color 0.12s; }
  .row:hover { background: rgba(255,255,255,0.85); }
  .row.sel { border-color: rgba(28,22,17,0.28); background: rgba(255,255,255,0.95); }
  .r-lab { display: flex; align-items: baseline; gap: 7px; font-size: var(--fs-label);
    color: var(--text-primary); min-width: 0; }
  .r-gate { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.06em; text-transform: uppercase; padding: 1px 6px; white-space: nowrap;
    border-radius: var(--radius-pill); background: rgba(176,137,42,0.18); color: #8a6a1f; }

  .cell { text-align: center; font-family: var(--font-mono); font-size: var(--fs-label);
    color: rgba(28,22,17,0.2); transition: opacity 0.13s; }
  .cell.yes { color: var(--tone); }
  .cell.dim { opacity: 0.25; }

  .read { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--tone, #5a6b7a);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: rgba(255,255,255,0.55); padding: 11px 14px; min-width: 0; }
  .r-kick { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--tone, #5a6b7a); margin-bottom: 4px; }
  .r-strap { margin: 0 0 6px; font-family: var(--fs-serif); font-size: var(--fs-body-sm); font-weight: 600;
    line-height: 1.3; color: var(--text-primary); max-width: 76ch; }
  .r-why { margin: 0 0 5px; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 86ch; }
  .r-why:last-child { margin-bottom: 0; }
  .r-why b { color: var(--text-primary); }

  @media (max-width: 640px) {
    .head, .row { grid-template-columns: 1fr repeat(var(--cols), 40px); gap: 4px; }
    .h-col b { font-size: var(--fs-label-xs); }
    .h-col em { display: none; }
  }
</style>
