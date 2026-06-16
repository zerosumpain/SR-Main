<script lang="ts">
  import type { Considerations } from '../lib/policy';
  import { PRESSURES_BY_ID } from '../lib/pressures';
  import { LEGISLATION_BY_ID } from '../lib/legislation';
  import { STRATEGIES } from '../lib/strategies';

  let { c }: { c: Considerations } = $props();
  const stratName = (id: string) => STRATEGIES.find((s) => s.id === id)?.short ?? id;
  const sevCol = { high: '#b1455e', medium: '#b4632e', low: '#9a7b1f' };
</script>

<div class="cc">
  {#if c.summary}<p class="cc-sum">{c.summary}</p>{/if}

  <div class="cc-cols">
    <div class="col pro">
      <span class="col-h">▲ Pros</span>
      {#each c.pros as p}<div class="item"><b>{p.point}</b>{#if p.detail} — {p.detail}{/if}</div>{/each}
      {#if !c.pros.length}<div class="empty">—</div>{/if}
    </div>
    <div class="col con">
      <span class="col-h">▼ Cons</span>
      {#each c.cons as p}<div class="item"><b>{p.point}</b>{#if p.detail} — {p.detail}{/if}</div>{/each}
      {#if !c.cons.length}<div class="empty">—</div>{/if}
    </div>
  </div>

  {#if c.tensions?.length}
    <div class="block">
      <span class="b-h">⚡ Tensions</span>
      {#each c.tensions as t}
        <div class="tension" style="--c:{sevCol[t.severity ?? 'medium']}"><span class="t-sev">{t.severity}</span>{t.point}</div>
      {/each}
    </div>
  {/if}

  {#if c.tradeoffs?.length}
    <div class="block">
      <span class="b-h">⇄ Trade-offs</span>
      {#each c.tradeoffs as t}<div class="item"><b>{t.point}</b>{#if t.detail} — {t.detail}{/if}</div>{/each}
    </div>
  {/if}

  {#if c.considerations?.length}
    <div class="block">
      <span class="b-h">◆ Considerations</span>
      {#each c.considerations as t}<div class="item"><b>{t.point}</b>{#if t.detail} — {t.detail}{/if}</div>{/each}
    </div>
  {/if}

  <div class="cc-cols">
    {#if c.stakeholders?.impacted?.length}
      <div class="block">
        <span class="b-h">Impacted stakeholders</span>
        {#each c.stakeholders.impacted as s}<div class="stake"><b>{s.name}</b>{#if s.why} — {s.why}{/if}</div>{/each}
      </div>
    {/if}
    {#if c.stakeholders?.interested?.length}
      <div class="block">
        <span class="b-h">Interested stakeholders</span>
        {#each c.stakeholders.interested as s}<div class="stake"><b>{s.name}</b>{#if s.why} — {s.why}{/if}</div>{/each}
      </div>
    {/if}
  </div>

  {#if c.watchouts?.length}
    <div class="block watch">
      <span class="b-h">⚠ Watch-outs</span>
      {#each c.watchouts as w}<div class="item">{w}</div>{/each}
    </div>
  {/if}

  {#if c.references && (c.references.pressures.length || c.references.strategies.length || c.references.legislation.length)}
    <div class="refs">
      <span class="r-lab">Grounded in</span>
      {#each c.references.pressures as id}{#if PRESSURES_BY_ID[id]}<a class="ref pr" href="/projects/dfe-data-strategy/landscape" title={PRESSURES_BY_ID[id].title}>{PRESSURES_BY_ID[id].title}</a>{/if}{/each}
      {#each c.references.strategies as id}<a class="ref st" href="/projects/dfe-data-strategy/strategies">{stratName(id)}</a>{/each}
      {#each c.references.legislation as id}{#if LEGISLATION_BY_ID[id]}<a class="ref lg" href={`/projects/dfe-data-strategy/legislation#${id}`}>{LEGISLATION_BY_ID[id].name}</a>{/if}{/each}
    </div>
  {/if}
</div>

<style>
  .cc { display: flex; flex-direction: column; gap: 12px; }
  .cc-sum { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--ink); }
  .cc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .col, .block { border: 1px solid rgba(28,22,17,0.1); border-radius: 8px; background: rgba(255,255,255,0.4); padding: 9px 11px; }
  .col.pro { border-left: 3px solid #2f7d4f; } .col.con { border-left: 3px solid #b1455e; }
  .col-h, .b-h { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.55); margin-bottom: 6px; }
  .col.pro .col-h { color: #2f7d4f; } .col.con .col-h { color: #b1455e; }
  .item { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.78); margin-bottom: 5px; }
  .item b { color: var(--ink); }
  .empty { color: rgba(28,22,17,0.35); }
  .tension { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.8); margin-bottom: 5px; border-left: 3px solid var(--c); padding-left: 8px; }
  .t-sev { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; color: #fff; background: var(--c); padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
  .block.watch { border-left: 3px solid #b4632e; }
  .stake { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.74); margin-bottom: 4px; }
  .stake b { color: var(--ink); }
  .refs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .r-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .ref { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-decoration: none; padding: 2px 7px; border-radius: 4px; border: 1px solid; }
  .ref.pr { color: #8a2d3a; border-color: rgba(138,45,58,0.3); background: rgba(138,45,58,0.05); }
  .ref.st { color: #2f6155; border-color: rgba(63,125,110,0.3); background: rgba(63,125,110,0.05); }
  .ref.lg { color: #2f6f97; border-color: rgba(47,111,151,0.3); background: rgba(47,111,151,0.05); }
  @media (max-width: 680px) { .cc-cols { grid-template-columns: 1fr; } }
</style>
