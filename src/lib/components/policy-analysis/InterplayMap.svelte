<script lang="ts">
  // THE INTERPLAY MAP — who is coming for what.
  //
  // The playbook ranks plays and the actor board describes actors, and between
  // them the reader still has to hold the join in their head: that three
  // different bodies are all aimed at the same measure, or that one actor's reach
  // covers half the machinery. That join IS the game-theoretic reading, and it is
  // the thing a list cannot show.
  //
  // Nothing is scored here that the assessment did not already score. An arc
  // exists because a play named that target; its weight is that play's own
  // exposure; a target's height on the page is the sum of what is aimed at it.
  // The plot is drawn by hand for the same reason `ExposurePlot` is — the
  // encoding is specific, and a chart component would have to be argued out of
  // inventing a scale.
  //
  // The table under it is not a fallback nobody reads: it is how this gets into a
  // printed pack, and how a screen reader gets the same information in the same
  // order.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { BAND_FILL, BAND_LABEL, type Interplay } from '$lib/policy-analysis/view';

  interface Props {
    map: Interplay;
    inspect: (id: string) => void;
  }

  let { map, inspect }: Props = $props();

  let focused = $state<string | null>(null);

  const WIDTH = 760;
  const ROW = 34;
  const TOP = 40;
  const LEFT_MARK = 262;
  const RIGHT_MARK = 498;

  const height = $derived(TOP + Math.max(map.actors.length, map.targets.length) * ROW + 24);
  const actorY = $derived(new Map(map.actors.map((a, i) => [a.actor.id, TOP + i * ROW])));
  const targetY = $derived(new Map(map.targets.map((t, i) => [t.id, TOP + i * ROW])));
  const arcs = $derived(map.links.map((link) => ({
    link,
    d: `M ${LEFT_MARK} ${actorY.get(link.actorId) ?? TOP} C 360 ${actorY.get(link.actorId) ?? TOP}, 400 ${targetY.get(link.targetId) ?? TOP}, ${RIGHT_MARK} ${targetY.get(link.targetId) ?? TOP}`,
  })));

  const lit = (id: string) => focused === null || focused === id
    || map.links.some((l) => (l.actorId === focused && l.targetId === id) || (l.targetId === focused && l.actorId === id));
  const arcLit = (actorId: string, targetId: string) => focused === null || focused === actorId || focused === targetId;

  const clip = (text: string, at: number) => (text.length > at ? `${text.slice(0, at - 1)}…` : text);
  const focusedActor = $derived(map.actors.find((a) => a.actor.id === focused) ?? null);
  const focusedTarget = $derived(map.targets.find((t) => t.id === focused) ?? null);
  const label = (a: Artefact | null, fallback: string) => a?.label ?? fallback;
</script>

{#if map.links.length}
  <figure class="map-figure">
    <svg viewBox="0 0 {WIDTH} {height}" role="img" aria-label="Which actors attack which parts of the policy, one arc per exploitation play">
      <text class="column" x={LEFT_MARK} y="20" text-anchor="end">Who moves</text>
      <text class="column" x={RIGHT_MARK} y="20" text-anchor="start">What it defeats</text>

      {#each arcs as arc (arc.link.playId + arc.link.targetId)}
        <path
          class="arc"
          class:dim={!arcLit(arc.link.actorId, arc.link.targetId)}
          d={arc.d}
          stroke={BAND_FILL[arc.link.band]}
          stroke-width={1 + arc.link.exposure * 5}
        />
      {/each}

      {#each map.actors as row, i (row.actor.id)}
        <g class="node" class:dim={!lit(row.actor.id)}>
          <text class="node-label" x={LEFT_MARK - 14} y={TOP + i * ROW + 4} text-anchor="end">{clip(row.actor.label, 30)}</text>
          <circle
            class="knob" cx={LEFT_MARK} cy={TOP + i * ROW} r={5 + row.reach}
            role="button" tabindex="0"
            aria-label="{row.actor.label}. {row.plays} plays reaching {row.reach} parts of the policy."
            onmouseenter={() => (focused = row.actor.id)}
            onmouseleave={() => (focused = null)}
            onfocus={() => (focused = row.actor.id)}
            onblur={() => (focused = null)}
            onclick={() => inspect(row.actor.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inspect(row.actor.id); } }}
          />
        </g>
      {/each}

      {#each map.targets as target, i (target.id)}
        <g class="node" class:dim={!lit(target.id)}>
          <rect
            class="knob" x={RIGHT_MARK - 5} y={TOP + i * ROW - 5} width="10" height="10"
            role="button" tabindex="0"
            aria-label="{target.label}. {target.incoming} plays aimed at it."
            onmouseenter={() => (focused = target.id)}
            onmouseleave={() => (focused = null)}
            onfocus={() => (focused = target.id)}
            onblur={() => (focused = null)}
            onclick={() => target.artefact && inspect(target.id)}
            onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && target.artefact) { e.preventDefault(); inspect(target.id); } }}
          />
          <text class="node-label" x={RIGHT_MARK + 14} y={TOP + i * ROW + 4}>{clip(target.label, 34)}</text>
          <text class="node-count" x={WIDTH - 4} y={TOP + i * ROW + 4} text-anchor="end">{target.incoming}</text>
        </g>
      {/each}
    </svg>

    <figcaption>
      {#if focusedActor}
        <strong>{focusedActor.actor.label}</strong>
        <span class="muted">{focusedActor.plays} {focusedActor.plays === 1 ? 'play' : 'plays'} · reaches {focusedActor.reach} {focusedActor.reach === 1 ? 'part' : 'parts'} of the policy · worst exposure {Math.round(focusedActor.worst * 100)}%</span>
        <ul>
          {#each map.links.filter((l) => l.actorId === focusedActor.actor.id) as l (l.playId + l.targetId)}
            <li><span class="band" style="background: {BAND_FILL[l.band]}" class:on-dark={l.band === 'severe'}>{BAND_LABEL[l.band]}</span> {l.label} → {label(map.targets.find((t) => t.id === l.targetId)?.artefact ?? null, 'a target no longer in the assessment')}</li>
          {/each}
        </ul>
      {:else if focusedTarget}
        <strong>{focusedTarget.label}</strong>
        <span class="muted">{focusedTarget.kind.replaceAll('_', ' ')} · {focusedTarget.incoming} {focusedTarget.incoming === 1 ? 'play aimed' : 'plays aimed'} at it</span>
        <ul>
          {#each map.links.filter((l) => l.targetId === focusedTarget.id) as l (l.playId)}
            <li><span class="band" style="background: {BAND_FILL[l.band]}" class:on-dark={l.band === 'severe'}>{BAND_LABEL[l.band]}</span> {map.actors.find((a) => a.actor.id === l.actorId)?.actor.label ?? 'An actor'} — {l.label}</li>
          {/each}
        </ul>
      {:else}
        <strong>{map.actors.length} {map.actors.length === 1 ? 'actor' : 'actors'}, {map.targets.length} {map.targets.length === 1 ? 'target' : 'targets'}, {map.links.length} {map.links.length === 1 ? 'line of attack' : 'lines of attack'}</strong>
        <span class="muted">Arc weight is the play's own exposure; a knob grows with how much it touches. Hover either column to isolate it, select one to open its evidence.</span>
        <p>A target with several arcs is a single point the policy has not defended twice over — the reading a ranked list cannot give you.</p>
        {#if map.hidden}<p class="muted">{map.hidden} further {map.hidden === 1 ? 'target is' : 'targets are'} attacked by exactly one play each and are left out of the drawing; they are in the table below.</p>{/if}
      {/if}
    </figcaption>
  </figure>

  <details class="table-view">
    <summary>The same map as a table</summary>
    <table>
      <thead><tr><th scope="col">Who moves</th><th scope="col">The play</th><th scope="col">What it defeats</th><th scope="col">Exposure</th></tr></thead>
      <tbody>
        {#each map.links as l (l.playId + l.targetId)}
          <tr>
            <td>{map.actors.find((a) => a.actor.id === l.actorId)?.actor.label ?? 'Actor unresolved'}</td>
            <td><button class="link" onclick={() => inspect(l.playId)}>{l.label}</button></td>
            <td>{map.targets.find((t) => t.id === l.targetId)?.label ?? 'Target unresolved'}</td>
            <td>{BAND_LABEL[l.band]} · {Math.round(l.exposure * 100)}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </details>
{:else}
  <p class="muted">No exploitation play has named the part of the policy it defeats, so there is no interplay to map yet.</p>
{/if}

<style>
  .map-figure { display: grid; grid-template-columns: minmax(0, 1fr) minmax(15rem, 22rem); gap: 1.5rem; align-items: start; margin: 1.25rem 0 0; }
  @media (max-width: 900px) { .map-figure { grid-template-columns: 1fr; } }
  svg { width: 100%; height: auto; overflow: visible; }
  .arc { fill: none; opacity: .85; transition: opacity .12s; }
  .arc.dim { opacity: .12; }
  .node { transition: opacity .12s; }
  .node.dim { opacity: .3; }
  .knob { fill: var(--text-primary); stroke: var(--bg); stroke-width: 2; cursor: pointer; }
  .knob:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
  .node-label { font-size: var(--fs-label); fill: var(--text-primary); pointer-events: none; }
  .node-count, .column { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--text-muted); letter-spacing: .04em; text-transform: uppercase; }
  figcaption { border-left: 2px solid var(--accent); padding-left: 1rem; min-height: 8rem; }
  figcaption strong { display: block; font-size: var(--fs-body-lg); }
  figcaption ul { list-style: none; padding: 0; margin: .6rem 0 0; display: grid; gap: .4rem; font-size: var(--fs-label); }
  .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .1rem .35rem; }
  .band.on-dark { color: var(--bg); }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  .table-view { margin-top: 1.25rem; }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-label); margin-top: .75rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .link { font: inherit; background: none; border: 0; padding: 0; text-align: left; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
  @media print { .table-view[open], .table-view { display: block; } svg { break-inside: avoid; } }
</style>
