<script lang="ts">
  // NightRun — the overnight self-improvement run as an operable sequence.
  //
  // The claim the instrument makes without prose: every phase is caught on its own. Break
  // any one of the eight and the run is marked partial — it does not abort the night. The
  // old version of this page said that in a paragraph; here the reader does it themselves.
  //
  // No timers, no rAF, no animation state: selection and one broken id, both plain runes.
  import Steps from '../../../components/viz/Steps.svelte';
  import { PHASES } from '../../../lib/building';
  import { app } from '../../../lib/appState.svelte';
  import { href } from '../../../lib/nav';

  interface Props { tone?: string }
  let { tone = '#8a2d3a' }: Props = $props();

  let selected = $state<string>(PHASES[0].id);
  let broken = $state<string | null>(null);

  const eli = $derived(app.narrative === 'eli5');
  const idx = $derived(PHASES.findIndex((p) => p.id === selected));
  const phase = $derived(PHASES[idx]);
  const isBroken = $derived(broken === selected);
  const ran = $derived(broken ? PHASES.length - 1 : PHASES.length);

  const items = $derived(
    PHASES.map((p) => ({
      id: p.id,
      label: p.name,
      state: (broken === p.id ? 'failed' : 'done') as 'failed' | 'done',
    })),
  );

  function toggleBreak() {
    broken = isBroken ? null : selected;
  }
</script>

<div class="nr" style="--tone:{tone}">
  <Steps {items} {selected} onselect={(id) => (selected = id)} {tone} railed />

  <div class="rs" class:partial={broken !== null} role="status">
    <span class="rs-k">Run</span>
    <b class="rs-v">{broken ? 'partial' : 'complete'}</b>
    <span class="rs-n">{ran} of {PHASES.length} phases</span>
  </div>

  <div class="det" class:hit={isBroken} aria-live="polite">
    <div class="d-head">
      <span class="d-no" aria-hidden="true">{idx + 1}</span>
      <b class="d-name">{phase.name}</b>
      <button class="brk" onclick={toggleBreak} aria-pressed={isBroken}>
        {isBroken ? 'Restore' : 'Break'} {phase.name}
      </button>
    </div>

    <p class="d-what">{eli ? phase.eli5 : phase.what}</p>

    {#if phase.note}
      <p class="d-note">
        <span class="n-m" aria-hidden="true">◦</span>
        <span>
          {phase.note}
          {#if phase.id === 'build'}<a href={href('change', 'gate')}>The gate →</a>{/if}
        </span>
      </p>
    {/if}

    {#if isBroken}
      <p class="d-hit">
        <span class="h-m" aria-hidden="true">✕</span>
        <span>Caught here. The other {PHASES.length - 1} phases still ran.</span>
      </p>
    {/if}
  </div>
</div>

<style>
  .nr { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .rs { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap;
    padding: 6px 12px; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--success) 10%, transparent); width: fit-content; }
  .rs.partial { background: color-mix(in srgb, var(--tone) 13%, transparent); }
  .rs-k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .rs-v { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--success); }
  .rs.partial .rs-v { color: var(--tone); }
  .rs-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.6); }

  .det { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--tone);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: rgba(255,255,255,0.55); padding: 11px 14px; min-width: 0; }
  .det.hit { background: color-mix(in srgb, var(--tone) 6%, rgba(255,255,255,0.55)); }

  .d-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .d-no { flex-shrink: 0; display: grid; place-items: center; min-width: 20px; height: 20px;
    border-radius: var(--radius-pill); background: var(--tone); color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; }
  .d-name { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600;
    color: var(--text-primary); line-height: 1.2; }

  .brk { margin-left: auto; font-family: 'DM Sans', sans-serif; font-size: 12px;
    color: var(--text-primary); background: rgba(255,255,255,0.7);
    border: 1px solid rgba(28,22,17,0.24); border-radius: var(--radius-round);
    padding: 5px 12px; cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s; }
  .brk:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.4); }
  .brk[aria-pressed='true'] { background: var(--tone); border-color: var(--tone); color: #fff; }

  .d-what { margin: 7px 0 0; font-size: 13px; line-height: 1.55;
    color: rgba(28,22,17,0.78); max-width: 84ch; }

  .d-note, .d-hit { display: flex; gap: 7px; margin: 7px 0 0; font-size: 12px; line-height: 1.5;
    color: rgba(28,22,17,0.62); max-width: 84ch; }
  .n-m, .h-m { flex-shrink: 0; color: var(--tone); }
  .d-hit { color: var(--tone); font-weight: 500; }
  .d-note a { color: var(--accent-ink); text-decoration: none;
    border-bottom: 1px dashed currentColor; white-space: nowrap; margin-left: 4px; }

  @media (max-width: 460px) {
    .brk { margin-left: 0; flex-basis: 100%; }
  }
</style>
