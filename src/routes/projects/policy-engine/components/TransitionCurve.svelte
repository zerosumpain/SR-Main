<script lang="ts">
  // TransitionCurve — NEET rate by single year of age (16→24): the post-GCSE step,
  // the age-18 jump, and the plateau that begins exactly where tracking ends.
  import { app } from '../lib/appState.svelte';
  import { AGE_PROFILE } from '../lib/neet';

  const eli = $derived(app.narrative === 'eli5');
  const X0 = 56, X1 = 716, Y0 = 22, Y1 = 208;
  const yMax = 20;
  const x = (age: number) => X0 + ((age - 16) / 8) * (X1 - X0);
  const y = (pct: number) => Y1 - (pct / yMax) * (Y1 - Y0);
  const path = AGE_PROFILE.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.age).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');
</script>

<div class="tc">
  <div class="tc-scroll">
  <svg viewBox="0 0 760 260" role="img" aria-label="NEET rate by single year of age, 16 to 24, with the age-18 tracking dark zone">
    <!-- the dark zone: tracking duty ends at 18 -->
    <defs>
      <pattern id="tchatch" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="rgba(177,69,94,0.04)" /><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(177,69,94,0.25)" stroke-width="2" />
      </pattern>
    </defs>
    <rect x={x(18)} y={Y0} width={X1 - x(18)} height={Y1 - Y0} fill="url(#tchatch)" />
    <line x1={x(18)} x2={x(18)} y1={Y0} y2={Y1} class="zone-line" />
    <text x={x(18) + 8} y={Y0 + 13} class="zone-lab">{eli ? 'no one tracks them past here' : 'the tracking duty ends — the dark zone'}</text>

    {#each [5, 10, 15, 20] as g}
      <line x1={X0} x2={X1} y1={y(g)} y2={y(g)} class="grid" />
      <text x={X0 - 8} y={y(g) + 3} class="ax-y">{g}%</text>
    {/each}
    {#each AGE_PROFILE as p (p.age)}
      <text x={x(p.age)} y={Y1 + 16} class="ax-x">{p.age}</text>
    {/each}

    <path d={path} class="curve" />
    {#each AGE_PROFILE as p (p.age)}
      <circle cx={x(p.age)} cy={y(p.pct)} r="4.5" class="pt" />
    {/each}

    <!-- annotations -->
    <text x={x(16.5)} y={y(4) - 14} class="ann">{eli ? '↑ GCSEs end' : '↑ post-GCSE step'}</text>
    <text x={x(18.4)} y={y(13.2) - 10} class="ann strong">{eli ? 'the big jump — right as tracking stops' : 'the age-18 jump: +6.3pp in one year'}</text>
    <text x={(X0 + X1) / 2} y={Y1 + 33} class="ax-title">→ age</text>
    <text x={16} y={(Y0 + Y1) / 2} class="ax-title" transform="rotate(-90 16 {(Y0 + Y1) / 2})">→ % NEET at that age</text>
  </svg>
  </div>
  <p class="tc-note">
    {eli
      ? 'When do young people fall out? Hardly any at 16–17, while councils are still required to keep track. The cliff comes at 18 — the exact age the tracking duty ends — and from there the rate never comes back down.'
      : 'Single-age NEET rates (interpolated to the DfE 2025 anchors: 4.0% at 16–17, 16.0% at 18–24). The hazard concentrates at the 17→18 transition — a ~6pp jump in a single year — and the stock then plateaus rather than recovering, consistent with the persistence dynamics in the engine. The statutory tracking duty ends at exactly the age the cliff begins; survival analysis over the NPD→ILR→NCCIS→LEO spine (opportunity ladder, rung 3) is how the department would see this curve for real, by group and by place.'}
  </p>
</div>

<style>
  .tc { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 12px 14px; }
  /* keep annotation text legible on phones: scroll sideways rather than shrink */
  .tc-scroll { overflow-x: auto; }
  .tc svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .ax-x, .ax-y { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.5); }
  .ax-x { text-anchor: middle; } .ax-y { text-anchor: end; }
  .ax-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); text-anchor: middle; text-transform: uppercase; }
  .zone-line { stroke: #b1455e; stroke-width: 1.3; stroke-dasharray: 5 3; opacity: 0.6; }
  .zone-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: #8a2d3a; letter-spacing: 0.04em; }
  .curve { fill: none; stroke: #566a8c; stroke-width: 2.6; }
  .pt { fill: #566a8c; stroke: var(--paper); stroke-width: 2; }
  .ann { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: rgba(28,22,17,0.6); }
  .ann.strong { fill: #8a2d3a; font-weight: 600; }
  .tc-note { margin: 8px 0 0; font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.65); }
</style>
