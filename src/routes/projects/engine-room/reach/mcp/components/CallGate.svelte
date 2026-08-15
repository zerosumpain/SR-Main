<script lang="ts">
  // CallGate — one call, four ways in.
  //
  // The structural claim, made operable: the caller control changes the picture and never
  // the verdict, because the check does not live in any caller. The two controls that DO
  // move it are the class of the operation and whether a person is there to answer.
  //
  // Nothing here names a tool. The constants classify by operation — 16 of 155 destructive —
  // so the instrument offers classes of call, not invented names.
  //
  // Provenance for the written lines here — each is a compression of a constant, never a
  // new claim: the three verdicts come from lib/tools.ts MCP_FACTS('Destructive operations')
  // and lib/guardrails.ts RAILS('destructive').detail; the counterfactual at the bottom comes
  // from lib/tools.ts LESSONS('Every cross-cutting concern has to unwrap the same envelope').
  import { MANIFEST } from '../../../lib/tools';

  /** Arithmetic on the constants, not a new figure: 16 of 155 are gated, so 139 are not. */
  const ORDINARY = MANIFEST.registered - MANIFEST.destructive;

  const CALLERS = [
    { id: 'assistant', label: 'The assistant', sub: 'a chat turn' },
    { id: 'workflow', label: 'A workflow', sub: 'a scheduled run' },
    { id: 'builder', label: 'The builder', sub: 'a build step' },
    { id: 'external', label: 'An external client', sub: 'over the protocol' },
  ];

  let caller = $state('assistant');
  let destructive = $state(false);
  let wrapped = $state(false);
  let present = $state(true);

  const verdict = $derived(!destructive ? 'pass' : present ? 'hold' : 'refuse');

  const VERDICT = {
    pass: {
      mark: '✓',
      head: 'Passes straight through',
      note: `${ORDINARY} of ${MANIFEST.registered} tools carry no gate.`,
    },
    hold: {
      mark: '?',
      head: 'Held for confirmation',
      note: 'The call waits at the boundary until the owner answers.',
    },
    refuse: {
      mark: '✕',
      head: 'Refused',
      note: 'Destructive, and nobody is there to confirm. It does not wait.',
    },
  } as const;
  const v = $derived(VERDICT[verdict]);

  const resolved = $derived(wrapped ? 'inside the dispatcher' : 'direct');
  const classed = $derived(
    destructive
      ? `destructive · ${MANIFEST.destructive} of ${MANIFEST.registered}`
      : `ordinary · ${ORDINARY} of ${MANIFEST.registered}`
  );
  const asked = $derived(!destructive ? 'not needed' : present ? 'someone present' : 'nobody present');
</script>

<div class="cg" style="--tone:var(--success)">
  <div class="cg-ctl">
    <div class="grp" role="group" aria-label="What kind of call">
      <span class="g-lab">The call</span>
      <button class:on={!destructive} aria-pressed={!destructive} onclick={() => (destructive = false)}>Ordinary</button>
      <button class:on={destructive} aria-pressed={destructive} onclick={() => (destructive = true)}>Destructive</button>
    </div>
    <div class="grp" role="group" aria-label="How the call arrives">
      <span class="g-lab">Arrives</span>
      <button class:on={!wrapped} aria-pressed={!wrapped} onclick={() => (wrapped = false)}>Direct</button>
      <button class:on={wrapped} aria-pressed={wrapped} onclick={() => (wrapped = true)}>Via the dispatcher</button>
    </div>
    <div class="grp" role="group" aria-label="Whether the owner is present">
      <span class="g-lab">Owner</span>
      <button class:on={present} aria-pressed={present} onclick={() => (present = true)}>Present</button>
      <button class:on={!present} aria-pressed={!present} onclick={() => (present = false)}>Unattended</button>
    </div>
  </div>

  <div class="cg-flow">
    <div class="lanes" role="group" aria-labelledby="cg-who">
      <span class="l-cap" id="cg-who">Who is calling</span>
      {#each CALLERS as c (c.id)}
        <button class="lane" class:on={caller === c.id} aria-pressed={caller === c.id}
                onclick={() => (caller = c.id)}>
          <b>{c.label}</b>
          <em>{c.sub}</em>
        </button>
      {/each}
    </div>

    <div class="bus" aria-hidden="true"></div>

    <div class="door">
      <span class="d-k">The doorway</span>
      <ol class="checks">
        <li><span class="c-n">1</span><span class="c-t">Resolve the tool name</span><em>{resolved}</em></li>
        <li><span class="c-n">2</span><span class="c-t">Classify the operation</span><em>{classed}</em></li>
        <li><span class="c-n">3</span><span class="c-t">Confirm, or refuse</span><em>{asked}</em></li>
      </ol>
    </div>

    <div class="out" aria-hidden="true"></div>

    <div class="verdict" data-v={verdict} aria-live="polite">
      <span class="v-mark" aria-hidden="true">{v.mark}</span>
      <b class="v-head">{v.head}</b>
      <span class="v-note">{v.note}</span>
    </div>
  </div>

  <p class="reg">All four read one registry — {MANIFEST.registered} tools, wired once.</p>

  <!-- The live region is always present so the counterfactual is announced when it appears;
       a region inserted together with its content is not reliably read out. -->
  <div aria-live="polite">
    {#if wrapped && destructive}
      <p class="ghost">Gate the outer name instead and this passes — every destructive call through, looking correct.</p>
    {/if}
  </div>
</div>

<style>
  .cg { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.45); padding: 13px 15px; }

  /* ---- controls ---- */
  .cg-ctl { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 14px; }
  .grp { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
  .g-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); margin-right: 2px; }
  .grp button { font-family: var(--font-body); font-size: var(--fs-label-xs); line-height: 1.2;
    color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp);
    padding: 5px 10px; cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s; }
  .grp button:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.36); }
  .grp button.on { background: var(--tone); border-color: var(--tone); color: #fff; }

  /* ---- the flow: four lanes → one door → one verdict ---- */
  .cg-flow { display: grid; align-items: center; gap: 0 6px;
    grid-template-columns: minmax(0,1fr) 22px minmax(0,1fr) 22px minmax(0,1.05fr); }

  .lanes { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .l-cap { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 1px; }
  .lane { position: relative; display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
    text-align: left; min-width: 0; padding: 6px 10px; cursor: pointer; font-family: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-right: 3px solid rgba(28,22,17,0.16);
    border-radius: var(--radius-sharp) 0 0 var(--radius-sharp); background: rgba(255,255,255,0.55);
    opacity: 0.62; transition: opacity 0.13s, background 0.13s, border-color 0.13s; }
  .lane:hover { opacity: 0.9; background: rgba(255,255,255,0.9); }
  .lane.on { opacity: 1; border-right-color: var(--tone);
    background: color-mix(in srgb, var(--tone) 9%, transparent); }
  .lane b { font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); line-height: 1.25; }
  .lane em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: rgba(28,22,17,0.5); }
  .lane::after { content: ''; position: absolute; right: -9px; top: 50%; width: 9px;
    border-top: 1px solid rgba(28,22,17,0.24); }
  .lane.on::after { border-top-color: var(--tone); }

  .bus { position: relative; align-self: stretch; min-height: 60px; }
  .bus::before { content: ''; position: absolute; left: 50%; top: 22%; bottom: 12%;
    border-left: 1px solid rgba(28,22,17,0.24); }
  .out { position: relative; align-self: stretch; min-height: 30px; }
  .bus::after, .out::after { content: '▸'; position: absolute; left: 50%; top: 50%;
    transform: translate(-52%, -52%); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.42); }
  .out::before { content: ''; position: absolute; left: 8%; right: 46%; top: 50%;
    border-top: 1px solid rgba(28,22,17,0.24); }

  .door { min-width: 0; padding: 9px 11px; border: 1px solid rgba(28,22,17,0.18);
    border-left: 3px solid var(--tone); border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: rgba(255,255,255,0.7); }
  .d-k { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--tone); margin-bottom: 6px; }
  .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .checks li { display: grid; grid-template-columns: 16px 1fr; gap: 1px 7px; align-items: baseline; min-width: 0; }
  .c-n { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    color: rgba(28,22,17,0.45); }
  .c-t { font-size: var(--fs-label-xs); line-height: 1.3; color: var(--text-primary); }
  .checks em { grid-column: 2; font-style: normal; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.55); overflow-wrap: anywhere; }

  .verdict { --v: var(--success); min-width: 0; padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--v) 40%, transparent); border-left: 3px solid var(--v);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--v) 9%, transparent);
    display: grid; grid-template-columns: 20px 1fr; gap: 2px 8px; align-items: baseline;
    transition: background 0.2s, border-color 0.2s; }
  .verdict[data-v='hold'] { --v: var(--warn); }
  .verdict[data-v='refuse'] { --v: var(--error); }
  .v-mark { font-family: var(--font-mono); font-size: var(--fs-nav); font-weight: 600; color: var(--v); }
  .v-head { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); line-height: 1.25;
    color: var(--text-primary); }
  .v-note { grid-column: 2; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.72); }

  .reg { margin: 11px 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }

  .ghost { margin: 7px 0 0; padding: 7px 10px; border-left: 3px solid var(--error);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--error) 8%, transparent);
    font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.78); max-width: 84ch; }

  /* ---- narrow: the flow becomes a column, the rails turn downward ---- */
  @media (max-width: 760px) {
    .cg-flow { grid-template-columns: 1fr; gap: 4px; }
    .lane { border-right-width: 1px; border-left: 3px solid rgba(28,22,17,0.16);
      border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; }
    .lane.on { border-right-color: rgba(28,22,17,0.16); border-left-color: var(--tone); }
    .lane::after { display: none; }
    .bus, .out { align-self: center; min-height: 0; height: 16px; width: 100%; }
    .bus::before { left: 50%; top: 0; bottom: 0; }
    .out::before { display: none; }
    .bus::after, .out::after { transform: translate(-52%, -52%) rotate(90deg); }
    .door { border-left-width: 3px; border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; }
  }
  @media (max-width: 420px) {
    .cg { padding: 11px 12px; }
    .cg-ctl { gap: 7px 12px; }
  }
</style>
