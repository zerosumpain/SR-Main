<script lang="ts">
  import type { Considerations } from '../lib/policy';
  import { PRESSURES_BY_ID } from '../lib/pressures';
  import { LEGISLATION_BY_ID } from '../lib/legislation';
  import { STRATEGIES } from '../lib/strategies';

  let { c }: { c: Considerations } = $props();
  let open = $state(false);

  const stratName = (id: string) => STRATEGIES.find((s) => s.id === id)?.short ?? id;
  const sevCol = { high: '#b1455e', medium: '#b4632e', low: '#9a7b1f' };
  const clean = (t: string) => t.replace(/^(Strategy|Pressure|Framework|Law|Sector voice|Sector debate|Maturity dimension|Capability|Posture):\s*/i, '');

  const counts = $derived(
    [
      { k: 'pros', n: c.pros?.length ?? 0, col: '#2f7d4f' },
      { k: 'cons', n: c.cons?.length ?? 0, col: '#b1455e' },
      { k: 'tensions', n: c.tensions?.length ?? 0, col: '#b4632e' },
      { k: 'trade-offs', n: c.tradeoffs?.length ?? 0, col: '#3a5fa8' },
      { k: 'considerations', n: c.considerations?.length ?? 0, col: '#7a5aa6' },
      { k: 'stakeholders', n: (c.stakeholders?.impacted?.length ?? 0) + (c.stakeholders?.interested?.length ?? 0), col: '#2f6155' },
    ].filter((x) => x.n),
  );
</script>

<div class="cc">
  {#if c.headline}<p class="cc-headline">{c.headline}</p>{/if}
  {#if c.summary}<p class="cc-sum">{c.summary}</p>{/if}

  <div class="cc-strip">
    {#each counts as x}<span class="chip" style="--c:{x.col}"><b>{x.n}</b> {x.k}</span>{/each}
  </div>

  {#if c.evidence?.length}
    <div class="cc-ev">
      <span class="ev-lab">Grounded in {c.evidence.length} sources</span>
      <div class="ev-chips">
        {#each c.evidence.slice(0, 8) as e}
          {#if e.url}<a class="ev" href={e.url} target={e.url.startsWith('http') ? '_blank' : undefined} rel="noopener">{clean(e.title)}</a>
          {:else}<span class="ev">{clean(e.title)}</span>{/if}
        {/each}
        {#if c.evidence.length > 8}<span class="ev more">+{c.evidence.length - 8}</span>{/if}
      </div>
    </div>
  {/if}

  <button class="cc-toggle" onclick={() => (open = !open)} aria-expanded={open}>
    {open ? '▾ Hide the full appraisal' : '▸ Show the full appraisal'}
  </button>

  {#if open}
    <div class="cc-detail">
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
          <span class="r-lab">Cites</span>
          {#each c.references.pressures as id}{#if PRESSURES_BY_ID[id]}<a class="ref pr" href="/projects/dfe-data-strategy/landscape" title={PRESSURES_BY_ID[id].title}>{PRESSURES_BY_ID[id].title}</a>{/if}{/each}
          {#each c.references.strategies as id}<a class="ref st" href="/projects/dfe-data-strategy/strategies">{stratName(id)}</a>{/each}
          {#each c.references.legislation as id}{#if LEGISLATION_BY_ID[id]}<a class="ref lg" href={`/projects/dfe-data-strategy/legislation#${id}`}>{LEGISLATION_BY_ID[id].name}</a>{/if}{/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cc { display: flex; flex-direction: column; gap: 9px; }
  .cc-headline { margin: 0; font-family: var(--fs-serif); font-size: var(--fs-body-sm); font-weight: 600; line-height: 1.35; color: var(--ink); }
  .cc-sum { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.72); }
  .cc-strip { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.03em; color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 35%, transparent); background: color-mix(in srgb, var(--c) 7%, transparent); border-radius: var(--radius-sharp); padding: 2px 7px; }
  .chip b { font-size: var(--fs-label-xs); }
  .cc-ev { display: flex; flex-direction: column; gap: 4px; }
  .ev-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .ev-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ev { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.66); background: rgba(28,22,17,0.045); border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 2px 6px; text-decoration: none; }
  a.ev:hover { background: var(--accent-ink-tint-12); color: var(--accent-ink); }
  .ev.more { color: rgba(28,22,17,0.45); }
  .cc-toggle { align-self: flex-start; background: none; border: none; padding: 2px 0; cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-ink); }
  .cc-toggle:hover { color: var(--accent-ink-hover); }
  .cc-detail { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; border-top: 1px dotted rgba(28,22,17,0.15); }
  .cc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .col, .block { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 9px 11px; }
  .col.pro { border-left: 3px solid var(--success); } .col.con { border-left: 3px solid var(--error); }
  .col-h, .b-h { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.55); margin-bottom: 6px; }
  .col.pro .col-h { color: var(--success); } .col.con .col-h { color: var(--error); }
  .item { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.78); margin-bottom: 5px; }
  .item b { color: var(--ink); }
  .empty { color: rgba(28,22,17,0.35); }
  .tension { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.8); margin-bottom: 5px; border-left: 3px solid var(--c); padding-left: 8px; }
  .t-sev { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: #fff; background: var(--c); padding: 1px 5px; border-radius: var(--radius-sharp); margin-right: 6px; }
  .block.watch { border-left: 3px solid #b4632e; }
  .stake { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.74); margin-bottom: 4px; }
  .stake b { color: var(--ink); }
  .refs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .r-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .ref { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; padding: 2px 7px; border-radius: var(--radius-sharp); border: 1px solid; }
  .ref.pr { color: #8a2d3a; border-color: rgba(138,45,58,0.3); background: rgba(138,45,58,0.05); }
  .ref.st { color: var(--accent-ink); border-color: var(--accent-ink-tint-35); background: var(--accent-ink-tint-06); }
  .ref.lg { color: var(--accent-ink); border-color: var(--accent-ink-tint-35); background: var(--accent-ink-tint-06); }
  @media (max-width: 680px) { .cc-cols { grid-template-columns: 1fr; } }
</style>
