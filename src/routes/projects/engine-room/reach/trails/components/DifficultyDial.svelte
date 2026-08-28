<script lang="ts">
  // DifficultyDial — the live grader's own arithmetic, run in front of the reader.
  //
  // equivalent km = km + climb/100, banded per sport with the same thresholds the
  // shipped grader uses (lib/trails.ts BANDS). The scale bar is drawn to the chosen
  // sport's own bands, so switching sport visibly moves the goalposts — which is the
  // point: a hard walk and an easy ride can be the same physical route.
  import { BANDS, SPORT_LABEL } from '../../../lib/trails';

  let { tone = 'var(--success)' }: { tone?: string } = $props();

  let sport = $state('hike');
  let km = $state(12);
  let ascent = $state(400);

  const bands = $derived(BANDS[sport] ?? BANDS.run);
  const eq = $derived(km + ascent / 100);
  const band = $derived(
    eq < bands[0] ? 'Easy' : eq < bands[1] ? 'Moderate' : eq < bands[2] ? 'Hard' : 'Severe',
  );

  /** The scale runs to a quarter past the hard bound, so severe has visible room. */
  const scaleMax = $derived(bands[2] * 1.25);
  const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;

  const SPORTS = Object.keys(BANDS);
</script>

<div class="dial" style="--tone:{tone}">
  <div class="chips" role="group" aria-label="Sport">
    {#each SPORTS as s (s)}
      <button type="button" class="chip" class:on={sport === s} aria-pressed={sport === s}
              onclick={() => (sport = s)}>{SPORT_LABEL[s] ?? s}</button>
    {/each}
  </div>

  <div class="sliders">
    <label class="sl">
      <span class="sl-k">Distance <b>{km} km</b></span>
      <input type="range" min="1" max="60" step="1" bind:value={km} />
    </label>
    <label class="sl">
      <span class="sl-k">Climb <b>{ascent} m</b></span>
      <input type="range" min="0" max="2000" step="25" bind:value={ascent} />
    </label>
  </div>

  <div class="scale" role="img"
       aria-label="Difficulty scale for {SPORT_LABEL[sport] ?? sport}: easy below {bands[0]} equivalent km, moderate below {bands[1]}, hard below {bands[2]}, severe beyond. This route sits at {eq.toFixed(1)}, which is {band.toLowerCase()}.">
    <div class="seg easy" style="width:{pct(bands[0])}"></div>
    <div class="seg mod" style="left:{pct(bands[0])}; width:calc({pct(bands[1])} - {pct(bands[0])})"></div>
    <div class="seg hard" style="left:{pct(bands[1])}; width:calc({pct(bands[2])} - {pct(bands[1])})"></div>
    <div class="seg sev" style="left:{pct(bands[2])}; width:calc(100% - {pct(bands[2])})"></div>
    <div class="needle" style="left:{pct(eq)}"></div>
  </div>
  <div class="marks" aria-hidden="true">
    <span style="left:{pct(bands[0])}">{bands[0]}</span>
    <span style="left:{pct(bands[1])}">{bands[1]}</span>
    <span style="left:{pct(bands[2])}">{bands[2]}</span>
  </div>

  <p class="readout" aria-live="polite">
    {km} km + {ascent} m of climb → <b>{eq.toFixed(1)} equivalent km</b> →
    <b class="band">{band}</b> for a {(SPORT_LABEL[sport] ?? sport).toLowerCase()}.
  </p>
</div>

<style>
  .dial { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--tone); border-color: var(--tone); color: #fff; }

  .sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 22px; }
  .sl { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .sl-k { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .sl-k b { color: var(--text-primary); letter-spacing: 0; }
  .sl input { width: 100%; accent-color: var(--tone); }

  .scale { position: relative; height: 18px; border-radius: var(--radius-sharp); overflow: hidden;
    border: 1px solid rgba(28,22,17,0.18); }
  .seg { position: absolute; top: 0; bottom: 0; }
  .seg.easy { left: 0; background: color-mix(in srgb, var(--success) 30%, transparent); }
  .seg.mod { background: color-mix(in srgb, var(--warn) 32%, transparent); }
  .seg.hard { background: color-mix(in srgb, var(--accent) 36%, transparent); }
  .seg.sev { background: color-mix(in srgb, #8a2d3a 38%, transparent); }
  .needle { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1px;
    background: var(--text-primary); }

  .marks { position: relative; height: 14px; }
  .marks span { position: absolute; transform: translateX(-50%);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }

  .readout { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.72); }
  .readout b { color: var(--text-primary); }
  .readout .band { color: var(--tone); }
</style>
