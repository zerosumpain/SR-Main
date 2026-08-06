<script lang="ts">
  // FailureModes — the three ways a guardrail stops working without anybody editing it.
  //
  // These were three prose cards. Each is really a picture: a check on one of two routes,
  // one rule standing on two different grounds, and one rule existing three times. So each
  // is a diagram with a single compressed line under it, and only one is on screen at once.
  import { FAILURE_MODES } from '../../../lib/guardrails';

  interface Props { tone?: string }
  let { tone = '#8a2d3a' }: Props = $props();

  let mode = $state(0);

  /** FAILURE_MODES[i].body, compressed. Same claim, a quarter of the words. */
  const LINE = [
    'A check inside one caller protects that caller. A second route never runs it, and nothing errors. Put the control where all traffic must pass.',
    'Sound on a laptop, unsound once something terminates connections on its behalf. The code did not change; the ground did. Review cannot see it — the diff is empty.',
    'A copied rule drifts from its original, and every copy is somewhere the fix does not land. Extract it, or make each copy name its twin.'
  ];

  const ALT = [
    'Two callers reach the same operation. The check sits inside the first caller only, so traffic arriving by the second reaches the operation unchecked.',
    'One rule standing on two different grounds: sound on a laptop, unsound behind something that terminates connections on its behalf.',
    'Three copies of one rule. The fix lands on one copy; the other two drift away from it.'
  ];
</script>

<div class="fm" style="--tone:{tone}">
  <div class="fm-picks" role="group" aria-label="Failure mode">
    {#each FAILURE_MODES as m, i (m.title)}
      <button class:on={mode === i} aria-pressed={mode === i} onclick={() => (mode = i)}>
        <span class="p-n">{i + 1}</span>{m.title}
      </button>
    {/each}
  </div>

  <svg class="dia" viewBox="0 0 300 104" role="img" aria-label={ALT[mode]} preserveAspectRatio="xMidYMid meet">
    <defs>
      <marker id="fm-ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="rgba(28,22,17,0.5)" />
      </marker>
      <marker id="fm-ah-bad" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0 L8 4 L0 8 z" fill="#c44" />
      </marker>
    </defs>

    {#if mode === 0}
      <text x="4" y="24" class="t">caller A</text>
      <line x1="66" y1="30" x2="228" y2="30" stroke="rgba(28,22,17,0.5)" stroke-width="1.5" marker-end="url(#fm-ah)" />
      <rect x="130" y="18" width="7" height="24" rx="2" fill="#2d7a3a" />
      <text x="133" y="12" class="t ok mid">check</text>

      <text x="4" y="80" class="t">caller B</text>
      <line x1="66" y1="74" x2="228" y2="74" stroke="#c44" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#fm-ah-bad)" />
      <text x="133" y="66" class="t bad mid">no check</text>

      <rect x="234" y="14" width="62" height="76" rx="6" fill="rgba(138,45,58,0.12)" stroke="rgba(28,22,17,0.32)" />
      <text x="265" y="47" class="t mid">the</text>
      <text x="265" y="61" class="t mid">operation</text>
    {:else if mode === 1}
      <rect x="92" y="6" width="116" height="30" rx="6" fill="rgba(255,255,255,0.7)" stroke="rgba(28,22,17,0.32)" />
      <text x="150" y="25" class="t mid">the same rule</text>
      <line x1="140" y1="38" x2="82" y2="56" stroke="rgba(28,22,17,0.5)" stroke-width="1.5" marker-end="url(#fm-ah)" />
      <line x1="160" y1="38" x2="218" y2="56" stroke="rgba(28,22,17,0.5)" stroke-width="1.5" marker-end="url(#fm-ah)" />

      <rect x="6" y="60" width="134" height="38" rx="6" fill="rgba(45,122,58,0.12)" stroke="rgba(45,122,58,0.5)" />
      <text x="73" y="77" class="t mid">on a laptop</text>
      <text x="73" y="91" class="t ok mid">sound</text>

      <rect x="160" y="60" width="134" height="38" rx="6" fill="rgba(196,68,68,0.1)" stroke="rgba(196,68,68,0.5)" />
      <text x="227" y="77" class="t mid">behind a proxy</text>
      <text x="227" y="91" class="t bad mid">everyone looks local</text>
    {:else}
      <text x="50" y="14" class="t mid">the fix</text>
      <line x1="50" y1="20" x2="50" y2="42" stroke="rgba(28,22,17,0.5)" stroke-width="1.5" marker-end="url(#fm-ah)" />

      <rect x="8" y="46" width="84" height="36" rx="6" fill="rgba(45,122,58,0.12)" stroke="rgba(45,122,58,0.5)" />
      <text x="50" y="68" class="t mid">the rule</text>

      <rect x="108" y="46" width="84" height="36" rx="6" fill="rgba(255,255,255,0.6)" stroke="rgba(196,68,68,0.45)" stroke-dasharray="5 4" />
      <text x="150" y="68" class="t mid">the rule</text>
      <text x="150" y="98" class="t bad mid">drifts</text>

      <rect x="208" y="46" width="84" height="36" rx="6" fill="rgba(255,255,255,0.6)" stroke="rgba(196,68,68,0.45)" stroke-dasharray="5 4" />
      <text x="250" y="68" class="t mid">the rule</text>
      <text x="250" y="98" class="t bad mid">drifts</text>
    {/if}
  </svg>

  <p class="fm-line" aria-live="polite">{LINE[mode]}</p>
</div>

<style>
  .fm { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

  .fm-picks { display: flex; gap: 6px; flex-wrap: wrap; }
  .fm-picks button { display: inline-flex; align-items: center; gap: 7px;
    font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2);
    border-radius: var(--radius-round); padding: 5px 12px 5px 6px; cursor: pointer;
    transition: background 0.12s, border-color 0.12s; }
  .fm-picks button:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.36); }
  .fm-picks button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
  .fm-picks button.on { background: var(--tone); border-color: var(--tone); color: #fff; }
  .p-n { flex-shrink: 0; display: grid; place-items: center; width: 19px; height: 19px;
    border-radius: var(--radius-pill); background: rgba(28,22,17,0.09);
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; color: rgba(28,22,17,0.65); }
  .fm-picks button.on .p-n { background: rgba(255,255,255,0.28); color: #fff; }

  .dia { display: block; width: 100%; max-width: 620px; height: auto;
    border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.45); padding: 6px; }
  .t { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.72); }
  .t.mid { text-anchor: middle; }
  .t.ok { fill: #2d7a3a; }
  .t.bad { fill: #c44; }

  .fm-line { margin: 0; font-size: 13px; line-height: 1.58; color: rgba(28,22,17,0.78); max-width: 84ch; }
</style>
