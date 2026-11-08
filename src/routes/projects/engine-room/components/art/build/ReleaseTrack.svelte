<script lang="ts">
  // ReleaseTrack — "how far may it travel". The road from the workshop to the live site,
  // with a barrier where each release policy stops the parcel. Pick a policy and the parcel
  // drives as far as it is allowed, then waits at its barrier.
  //
  // The policies and their labels are the feature's own list (facts.build.releasePolicies);
  // the furthest stop each can reach is the one fact drawn here, keyed by the ReleasePolicy
  // type so a new policy fails the type check until it has a place on the road.
  import type { ReleasePolicy } from '$lib/constants/development';

  interface Props {
    policies: Array<{ id: string; label: string }>;
    selected: string;
    onselect: (id: string) => void;
    text: string;
  }
  let { policies, selected, onselect, text }: Props = $props();

  const STOPS = [
    { id: 'workshop', label: 'Its own copy', sub: 'built and tested' },
    { id: 'preview', label: 'A preview', sub: 'shown to me running' },
    { id: 'github', label: 'GitHub', sub: 'a pull request' },
    { id: 'live', label: 'The live site', sub: 'if CI merges it' },
  ];
  /** The furthest stop each policy may reach, and who lifts the barrier after it. */
  const REACH = {
    preview_only: { stop: 1, gate: 'Stops here. Nothing leaves the preview.' },
    pull_request: { stop: 2, gate: 'A draft. It waits for me to mark it ready.' },
    production: { stop: 3, gate: 'CI decides. Only low-risk changes from the builder merge themselves.' },
  } satisfies Record<ReleasePolicy, { stop: number; gate: string }>;

  const reach = $derived(REACH[selected as ReleasePolicy] ?? REACH.preview_only);
</script>

<div class="rt" class:open={reach.stop === STOPS.length - 1} style="--stop:{reach.stop};--n:{STOPS.length}">
  <div class="seg pols" role="group" aria-label="Release policy">
    {#each policies as p (p.id)}
      <button class:on={selected === p.id} aria-pressed={selected === p.id} onclick={() => onselect(p.id)}>{p.label}</button>
    {/each}
  </div>

  <div class="road">
    <div class="tar" aria-hidden="true"><span class="lit"></span></div>
    <span class="car" aria-hidden="true">
      <svg viewBox="0 0 40 34"><rect x="2" y="2" width="36" height="30" rx="2" /><path d="M2 13h36M20 2v30" /></svg>
    </span>
    <span class="bar" aria-hidden="true"></span>
    <ol class="stops">
      {#each STOPS as s, i (s.id)}
        <li class:reached={i <= reach.stop} class:beyond={i > reach.stop}>
          <span class="pin"></span>
          <b>{s.label}</b>
          <span>{s.sub}</span>
        </li>
      {/each}
    </ol>
  </div>

  <p class="gate"><span class="g-k">At the barrier</span>{reach.gate}</p>
  <p class="text">{text}</p>
</div>

<style>
  .rt { min-width: 0; }
  .pols { margin-bottom: 26px; display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border: 1px solid var(--rule); }
  .pols button { background: transparent; border: none; padding: 9px 14px; font-family: var(--er-mono); font-size: var(--fs-label-xs); cursor: pointer;
    color: var(--fg-2); border-radius: var(--radius-sharp); }
  .pols button.on { background: var(--tone-text); color: var(--er-ink); }
  .road { position: relative; padding-top: 58px; }
  .tar { position: absolute; top: 40px; left: calc(50% / var(--n)); right: calc(50% / var(--n)); height: 6px; background: var(--rule); }
  .lit { position: absolute; inset: 0 auto 0 0; width: calc(100% * var(--stop) / (var(--n) - 1)); background: var(--tone-text); transition: width 1s var(--er-ease); }
  .car { position: absolute; top: 0; width: 44px; left: calc((100% / var(--n)) * (var(--stop) + 0.5)); transform: translateX(-50%); transition: left 1s var(--er-ease); }
  .car svg { display: block; width: 100%; }
  .car rect { fill: var(--er-amber); stroke: var(--er-ink); stroke-width: 2; }
  .car path { fill: none; stroke: var(--er-ink); stroke-width: 2; }
  .bar { position: absolute; top: 18px; height: 44px; width: 6px; background: repeating-linear-gradient(180deg, var(--fail) 0 8px, var(--er-cream) 8px 16px);
    left: calc((100% / var(--n)) * (var(--stop) + 0.5) + 34px); transition: left 1s var(--er-ease), opacity 0.4s; }
  .rt.open .bar { opacity: 0; }
  .stops { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); }
  .stops li { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding: 0 4px; transition: opacity 0.4s; }
  .pin { width: 18px; height: 18px; margin-top: -24px; margin-bottom: 8px; border-radius: var(--radius-pill); background: var(--er-ink); border: 3px solid var(--rule-strong); transition: border-color 0.4s, background 0.4s; }
  .reached .pin { border-color: var(--tone-text); background: var(--tone-text); }
  .stops b { font-size: var(--fs-body-sm); color: var(--fg); }
  .stops span { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }
  .beyond { opacity: 0.38; }
  .gate { margin: 28px 0 0; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; font-size: var(--fs-body); color: var(--fg); }
  .g-k { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--fail); }
  .text { margin: 10px 0 0; font-size: var(--fs-body-sm); line-height: 1.6; color: var(--fg-2); max-width: 70ch; }
  @media (max-width: 560px) {
    .stops b { font-size: var(--fs-label); }
    .bar { left: calc((100% / var(--n)) * (var(--stop) + 0.5) + 26px); }
    .car { width: 34px; }
  }
</style>
