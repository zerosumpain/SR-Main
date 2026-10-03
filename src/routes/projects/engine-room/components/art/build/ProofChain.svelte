<script lang="ts">
  // ProofChain — the verification phases as links of a chain hung between the workshop and
  // the live site. Snap any link: it breaks open, everything after it greys and drops, and the
  // live site at the end stays dark. Mend it and the chain pulls taut and the site lights.
  //
  // Phase names are HTML under each link, so they read at any width; the drawing has no text.
  import { still } from '../../../lib/motion';

  interface Link { id: string; label: string; text: string }
  interface Props {
    links: Link[];
    snapped: string | null;
    selected: string;
    onselect: (id: string) => void;
    onsnap: (id: string | null) => void;
  }
  let { links, snapped, selected, onselect, onsnap }: Props = $props();

  const n = $derived(links.length);
  const brokeAt = $derived(snapped ? links.findIndex((l) => l.id === snapped) : -1);
  const W = $derived(n * 120 + 160), CY = 70;
  const lx = (i: number) => 100 + i * 120;
  const whole = $derived(brokeAt < 0);
  const stateOf = (i: number) => (brokeAt < 0 ? 'ok' : i < brokeAt ? 'ok' : i === brokeAt ? 'broken' : 'dead');
</script>

<div class="pc" class:whole class:still={still()}>
  <svg viewBox="0 0 {W} 150" aria-hidden="true">
    <rect class="post" x="8" y={CY - 34} width="26" height="68" rx="2" />
    <line class="stub" x1="34" y1={CY} x2={lx(0) - 46} y2={CY} />
    {#each links as l, i (l.id)}
      {@const s = stateOf(i)}
      <g class="link {s}" class:sel={l.id === selected} transform="translate({lx(i)} {CY})" style="--d:{(i - brokeAt) * 0.07}s">
        {#if s === 'broken'}
          <g class="half a"><path d="M -10 -20 H -26 A 20 20 0 0 0 -26 20 H -10" /></g>
          <g class="half b"><path d="M 10 -20 H 26 A 20 20 0 0 1 26 20 H 10" /></g>
          <g class="spark"><path d="M0 -30 V-42 M-10 -26 L-18 -36 M10 -26 L18 -36" /></g>
        {:else}
          <rect x="-46" y="-20" width="92" height="40" rx="20" class:alt={i % 2 === 1} />
        {/if}
      </g>
    {/each}
    <line class="stub tail" x1={lx(n - 1) + 46} y1={CY} x2={W - 70} y2={CY} />
    <g class="site" transform="translate({W - 44} {CY})">
      <circle r="30" />
      <path d="M-30 0 H30 M0 -30 C 14 -14, 14 14, 0 30 M0 -30 C -14 -14, -14 14, 0 30" />
    </g>
  </svg>

  <ol class="names" style="--cols:{n}">
    {#each links as l, i (l.id)}
      <li class={stateOf(i)}>
        <button class:on={l.id === selected} aria-pressed={l.id === selected} onclick={() => onselect(l.id)}>
          <span class="nm-n">{i + 1}</span>{l.label}
        </button>
      </li>
    {/each}
  </ol>

  <div class="actions">
    <button class="snap" onclick={() => onsnap(snapped === selected ? null : selected)}>
      {snapped === selected ? 'Mend this link' : `Snap the ${links.find((l) => l.id === selected)?.label ?? ''} link`}
    </button>
    {#if snapped && snapped !== selected}<button class="mend" onclick={() => onsnap(null)}>Mend the chain</button>{/if}
  </div>
</div>

<style>
  .pc { min-width: 0; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .post { fill: var(--fg-3); }
  .stub { stroke: var(--fg-3); stroke-width: 6; }
  .whole .tail { stroke: var(--tone); }
  .link rect { fill: none; stroke: var(--tone); stroke-width: 10; transition: stroke 0.4s; }
  .link rect.alt { stroke: var(--tone-text); }
  .link.sel rect { stroke: var(--fg); }
  .link { transition: transform 0.8s var(--er-ease) var(--d), opacity 0.6s var(--d); }
  .link.dead rect { stroke: var(--rule-strong); stroke-dasharray: 6 8; }
  .link.dead { opacity: 0.5; }
  .pc:not(.still) .link.dead { transform-box: fill-box; translate: 0 26px; transition: translate 0.8s var(--er-ease) var(--d); }
  .half path { fill: none; stroke: var(--fail); stroke-width: 10; stroke-linecap: round; }
  .pc:not(.still) .half.a { animation: tipA 0.6s var(--er-ease) forwards; }
  .pc:not(.still) .half.b { animation: tipB 0.6s var(--er-ease) forwards; }
  @keyframes tipA { to { transform: translate(-8px, 6px) rotate(-14deg); } }
  @keyframes tipB { to { transform: translate(10px, 18px) rotate(22deg); } }
  .still .half.a { transform: translate(-8px, 6px) rotate(-14deg); }
  .still .half.b { transform: translate(10px, 18px) rotate(22deg); }
  .spark path { stroke: var(--fail); stroke-width: 3; stroke-linecap: round; }
  .pc:not(.still) .spark { animation: spark 0.7s ease-out both; }
  @keyframes spark { from { opacity: 1; transform: scale(0.4); } to { opacity: 0; transform: scale(1.4); } }
  .spark { opacity: 0; }
  .site circle { fill: var(--wash); stroke: var(--rule-strong); stroke-width: 3; transition: fill 0.5s, stroke 0.5s; }
  .site path { fill: none; stroke: var(--rule-strong); stroke-width: 2; transition: stroke 0.5s; }
  .whole .site circle { fill: var(--tone); stroke: var(--tone); }
  .whole .site path { stroke: var(--er-ink); }

  .names { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 6px; }
  .names button { width: 100%; padding: 10px 6px; border: 1px solid var(--rule); background: transparent; color: var(--fg-2); cursor: pointer;
    font-family: var(--er-body); font-size: var(--fs-label); display: flex; flex-direction: column; align-items: center; gap: 4px; border-radius: var(--radius-sharp); }
  .names button.on { border-color: var(--fg); color: var(--fg); background: var(--wash); }
  .nm-n { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); }
  .names .broken button { border-color: var(--fail); color: var(--fail); }
  .names .dead button { opacity: 0.45; text-decoration: line-through; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
  .snap, .mend { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer;
    padding: 10px 16px; border-radius: var(--radius-pill); border: 1px solid var(--fail); background: transparent; color: var(--fail); }
  .snap:hover { background: var(--fail); color: #fff; }
  .mend { border-color: var(--rule-strong); color: var(--fg-2); }
  @media (max-width: 560px) {
    .names { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
</style>
