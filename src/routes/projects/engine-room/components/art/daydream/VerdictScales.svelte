<script lang="ts">
  // VerdictScales — the double-check weighs its own note against the doubts it can raise.
  // Pick an answer and the balance settles the way that answer means: level when the note
  // holds, tipped against it when it was wrong, wobbling and undecided when it can't tell.
  // The answers are the feature's own list (RED_TEAM_VERDICTS); the words are VERDICT_COPY.
  interface Props {
    verdicts: string[];
    picked: string | null;
    onpick: (v: string) => void;
    label: (v: string) => string;
  }
  let { verdicts, picked, onpick, label }: Props = $props();
  const tilt = $derived(picked === 'wrong' ? 14 : 0);
</script>

<div class="vs">
  <svg viewBox="0 0 420 260" aria-hidden="true" data-v={picked ?? 'none'}>
    <path class="post" d="M210 60 V226 M160 232 H260" />
    <g class="beam" style="transform: rotate({tilt}deg)">
      <line x1="70" y1="60" x2="350" y2="60" />
      <circle class="pivot" cx="210" cy="60" r="9" />
      <g class="pan left" style="transform: rotate({-tilt}deg)">
        <path d="M70 60 L40 132 M70 60 L100 132" /><path class="dish" d="M30 132 H110 A40 18 0 0 1 30 132Z" />
        <rect class="note" x="48" y="102" width="44" height="30" rx="2" /><path class="nl" d="M56 112 H84 M56 121 H76" />
      </g>
      <g class="pan right" style="transform: rotate({-tilt}deg)">
        <path d="M350 60 L320 132 M350 60 L380 132" /><path class="dish" d="M310 132 H390 A40 18 0 0 1 310 132Z" />
        <text class="q" x="350" y="126" text-anchor="middle">?</text>
      </g>
    </g>
  </svg>
  <div class="opts" role="group" aria-label="What the double-check can conclude">
    {#each verdicts as v (v)}
      <button class:on={picked === v} data-v={v} aria-pressed={picked === v} onclick={() => onpick(v)}>
        <span class="mark" aria-hidden="true">{v === 'holds' ? '✓' : v === 'wrong' ? '✕' : '?'}</span>{label(v)}
      </button>
    {/each}
  </div>
</div>

<style>
  .vs { display: flex; flex-direction: column; gap: 18px; }
  svg { width: 100%; max-width: 460px; display: block; margin: 0 auto; overflow: visible; }
  .post { stroke: var(--fg); stroke-width: 6; fill: none; stroke-linecap: square; }
  .beam { transform-origin: 210px 60px; transform-box: view-box; transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1); }
  .beam line { stroke: var(--fg); stroke-width: 6; }
  .pivot { fill: var(--tone); stroke: var(--fg); stroke-width: 3; }
  .pan { transition: transform 1s cubic-bezier(0.34, 1.56, 0.64, 1); transform-box: view-box; }
  .left { transform-origin: 70px 60px; } .right { transform-origin: 350px 60px; }
  .pan path:first-child { stroke: var(--fg-2); stroke-width: 2; fill: none; }
  .dish { fill: var(--fg); }
  .note { fill: var(--tone); stroke: var(--fg); stroke-width: 2; }
  .nl { stroke: var(--er-ink); stroke-width: 3; }
  .q { font-family: var(--er-display); font-size: 40px; fill: var(--fail); }
  [data-v='unclear'] .beam { animation: wobble 2.4s ease-in-out infinite; }
  @keyframes wobble { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
  [data-v='holds'] .pivot { fill: var(--you); }
  [data-v='wrong'] .note { fill: var(--fail); }

  .opts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .opts button { display: inline-flex; align-items: center; gap: 10px; padding: 10px 18px 10px 10px; border-radius: var(--radius-pill); border: 2px solid var(--rule-strong);
    background: var(--ground); color: var(--fg); cursor: pointer; font-family: var(--er-display); text-transform: uppercase; font-size: 16px; transition: border-color 0.2s, background 0.2s; }
  .mark { width: 28px; height: 28px; border-radius: var(--radius-pill); display: grid; place-items: center; background: var(--wash); font-family: var(--er-mono); font-size: 15px; }
  .opts button:hover { border-color: var(--fg); }
  .opts button.on { border-color: var(--fg); background: var(--fg); color: var(--ground); }
  .opts button.on[data-v='holds'] .mark { background: var(--you); color: #fff; }
  .opts button.on[data-v='wrong'] .mark { background: var(--fail); color: #fff; }
  .opts button.on[data-v='unclear'] .mark { background: var(--tone); color: var(--er-ink); }
</style>
