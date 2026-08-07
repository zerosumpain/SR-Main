<script lang="ts">
  // FolderPolicy — two settings on the same tree, resolved by two different rules.
  //
  // Written as an instrument because the rule is easy to state and hard to believe until you
  // have watched it: exclude a whole tree, re-include one folder inside it, and the file is
  // included — while the label you put on the excluded parent is STILL on the file. Nearest
  // ancestor wins for one setting; every ancestor contributes to the other.
  import { POLICY_TREE, POLICY_RULES } from '../../../lib/drive';

  type Mode = 'inherit' | 'include' | 'exclude';
  const MODES: Mode[] = ['inherit', 'include', 'exclude'];

  let modes = $state<Mode[]>(POLICY_TREE.map((n) => n.mode as Mode));

  /** The rules, applied root-first — so the LAST explicit mode seen is the nearest ancestor's. */
  const resolved = $derived.by(() => {
    let included = true;
    let decidedBy: string | null = null;
    const cats: string[] = [];
    POLICY_TREE.forEach((node, i) => {
      if (modes[i] !== 'inherit') {
        included = modes[i] === 'include';
        decidedBy = node.label;
      }
      for (const c of node.cats) if (!cats.includes(c)) cats.push(c);
    });
    return { included, decidedBy, cats };
  });

  const leaf = POLICY_TREE[POLICY_TREE.length - 1];
</script>

<div class="fp">
  <ul class="tree">
    {#each POLICY_TREE as node, i (node.path)}
      <li style="--depth:{i}">
        <span class="n-name">{node.label === 'root' ? '/' : `${node.label}/`}</span>
        <span class="n-modes" role="group" aria-label="Policy for {node.label}">
          {#each MODES as m (m)}
            <button type="button" class="m" class:on={modes[i] === m} data-m={m}
                    aria-pressed={modes[i] === m}
                    onclick={() => (modes = modes.map((x, j) => (j === i ? m : x)))}>{m}</button>
          {/each}
        </span>
        <span class="n-cats">
          {#each node.cats as c (c)}<em>{c}</em>{:else}<i>no labels</i>{/each}
        </span>
      </li>
    {/each}
  </ul>

  <div class="out" class:no={!resolved.included} aria-live="polite">
    <div class="o-line">
      <span class="o-file">a file in <b>{leaf.label}/</b></span>
      <span class="o-verdict">{resolved.included ? 'feeds the graph' : 'never feeds the graph'}</span>
    </div>
    <p class="o-why">
      {#if resolved.decidedBy}
        Decided by <b>{resolved.decidedBy === 'root' ? 'the root' : `${resolved.decidedBy}/`}</b> — the nearest
        ancestor that gave an explicit answer.
      {:else}
        Nothing on the path gave an explicit answer, so the default stands.
      {/if}
      Labels carried down: {#each resolved.cats as c, i (c)}<em>{c}</em>{i < resolved.cats.length - 1 ? ' ' : ''}{:else}<i>none</i>{/each}
      — the union of every ancestor's, including any whose folder is excluded.
    </p>
  </div>

  <ul class="rules">
    {#each POLICY_RULES as r (r.id)}
      <li><b>{r.setting}</b><span class="r-rule">{r.rule}</span><span class="r-why">{r.why}</span></li>
    {/each}
  </ul>
</div>

<style>
  .fp { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .tree { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .tree li { display: grid; grid-template-columns: minmax(120px, 1fr) auto minmax(110px, 1fr);
    gap: 10px; align-items: center; padding: 5px 10px; border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); margin-left: calc(var(--depth) * 16px); }
  .n-name { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-primary); }
  .n-modes { display: flex; gap: 3px; }
  .m { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.06em;
    text-transform: uppercase; color: rgba(28,22,17,0.6); background: rgba(255,255,255,0.7);
    border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round);
    padding: 3px 8px; cursor: pointer; }
  .m:hover { background: rgba(28,22,17,0.07); }
  .m.on[data-m='include'] { background: var(--success); border-color: var(--success); color: #fff; }
  .m.on[data-m='exclude'] { background: #8a2d3a; border-color: #8a2d3a; color: #fff; }
  .m.on[data-m='inherit'] { background: rgba(28,22,17,0.5); border-color: rgba(28,22,17,0.5); color: #fff; }
  .n-cats { display: flex; gap: 4px; flex-wrap: wrap; }
  .n-cats em, .o-why em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    padding: 2px 7px; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
  .n-cats i, .o-why i { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.35); }

  .out { padding: 10px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent); }
  .out.no { border-left-color: #8a2d3a; background: rgba(138,45,58,0.07); }
  .o-line { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 5px; }
  .o-file { font-size: 12.5px; color: rgba(28,22,17,0.7); }
  .o-file b { font-family: 'JetBrains Mono', monospace; color: var(--text-primary); }
  .o-verdict { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--success); }
  .out.no .o-verdict { color: #8a2d3a; }
  .o-why { margin: 0; font-size: 12px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 86ch; }
  .o-why b { color: var(--text-primary); }

  .rules { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
  .rules li { display: flex; flex-direction: column; gap: 2px; padding: 8px 11px;
    border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.5); }
  .rules b { font-size: 12.5px; color: var(--text-primary); }
  .r-rule { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--success); }
  .r-why { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.62); }

  @media (max-width: 620px) {
    .tree li { grid-template-columns: 1fr; gap: 4px; margin-left: calc(var(--depth) * 10px); }
  }
</style>
