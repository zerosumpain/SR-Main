<script lang="ts">
  // PipelineRun — push a change down the six stages and watch where it stops.
  //
  // The claim this makes without prose: the boundary of autonomy is a file path. Set the
  // author, set the gate result, tick what the diff touches, press push. A routine
  // machine-authored change with a green gate walks all six stages on its own; one protected
  // path anywhere in the diff and stage four holds for a person; a red gate and stages four
  // to six are never reached at all, because the deploy job declares the gate as a dependency.
  //
  // Playback is a setTimeout chain. The timer id is a PLAIN let, never $state — a handle an
  // effect both reads and writes throws effect_update_depth_exceeded and locks the page.
  import { onDestroy } from 'svelte';
  import Steps from '../../../components/viz/Steps.svelte';
  import Stat from '../../../components/viz/Stat.svelte';
  import { PIPELINE, RISK_PATHS } from '../../../lib/shipping';
  import { app } from '../../../lib/appState.svelte';

  interface Props { tone?: string }
  let { tone = '#8a2d3a' }: Props = $props();

  type Fate = 'done' | 'failed' | 'held' | 'skipped';
  type Vis = 'idle' | 'running' | 'done' | 'failed' | 'skipped';
  const N = PIPELINE.length;

  /** RISK_PATHS' own groups, shortened to fit a chip. Wording only — the list is unchanged. */
  const CHIP: Record<string, string> = {
    'Authentication and sessions': 'Auth + sessions',
    'Everything server-side': 'Server-side code',
    'The protocol server': 'Protocol server',
    'Encryption helpers': 'Encryption helpers',
    'Project and share guards': 'Share guards',
    'The database schema': 'Database schema',
    'The pipeline itself': 'The pipeline',
    'The agent’s own safety rails': 'The agent’s safety rails',
  };

  /** PIPELINE.what, cut to one line each. No fact added, none changed. */
  const LINE: Record<string, string> = {
    branch: 'Always on a copy. Nothing edits the trunk in place, including the machine.',
    gate: 'Lint, types, the unit suite, a production build, two bespoke checks.',
    tier: 'The diff against the merge base, matched against a list of protected paths.',
    merge: 'Low tier, machine-written, gate green: it merges itself. Everything else waits.',
    build: 'The build runs where it deploys. No artefact is transferred.',
    live: 'A marker records the deployed commit, so “is it live?” is not a guess.',
  };

  let author = $state<'machine' | 'person'>('machine');
  let gateRed = $state(false);
  let picked = $state<string[]>([]);
  let step = $state(-1); // −1 not pushed · 0…N−1 the stage in flight · N finished
  let selected = $state<string>('merge');

  let timer: ReturnType<typeof setTimeout> | null = null; // plain let, deliberately

  const eli = $derived(app.narrative === 'eli5');
  const high = $derived(picked.length > 0);
  const selfMerge = $derived(author === 'machine' && !high && !gateRed);
  const finished = $derived(step >= N);
  const inFlight = $derived(step >= 0 && step < N);

  const plan: Fate[] = $derived([
    'done',
    gateRed ? 'failed' : 'done',
    gateRed ? 'skipped' : 'done',
    gateRed ? 'skipped' : selfMerge ? 'done' : 'held',
    gateRed || !selfMerge ? 'skipped' : 'done',
    gateRed || !selfMerge ? 'skipped' : 'done',
  ]);

  const held = $derived(plan[3] === 'held');

  const items = $derived(
    PIPELINE.map((p, i) => ({
      id: p.id,
      label: p.name,
      sub: p.id === 'merge' && finished && held ? 'waits for a person' : p.where,
      state: (step < 0
        ? 'idle'
        : i < step
          ? plan[i] === 'held'
            ? 'running'
            : plan[i]
          : i === step
            ? 'running'
            : 'idle') as Vis,
    })),
  );

  const stage = $derived(PIPELINE.find((p) => p.id === selected) ?? PIPELINE[0]);
  const lastPick = $derived(
    picked.length ? (RISK_PATHS.find((p) => p.group === picked[picked.length - 1]) ?? null) : null,
  );

  function stop() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }
  function advance() {
    timer = setTimeout(() => {
      timer = null;
      const fate = plan[step];
      if (fate === 'failed' || fate === 'held') { step = N; return; }
      step += 1;
      if (step < N) advance();
    }, 330);
  }
  function push() { stop(); step = 0; advance(); }
  function reset() { stop(); step = -1; }

  function setAuthor(a: 'machine' | 'person') { reset(); author = a; }
  function setGate(red: boolean) { reset(); gateRed = red; }
  function toggle(g: string) {
    reset();
    picked = picked.includes(g) ? picked.filter((x) => x !== g) : [...picked, g];
  }

  onDestroy(stop);
</script>

<div class="pr" style="--tone:{tone}">
  <div class="ctl">
    <div class="grp">
      <span class="g-lab" id="pr-who">Author</span>
      <div class="seg" role="group" aria-labelledby="pr-who">
        <button class:on={author === 'machine'} aria-pressed={author === 'machine'}
                onclick={() => setAuthor('machine')}>Machine</button>
        <button class:on={author === 'person'} aria-pressed={author === 'person'}
                onclick={() => setAuthor('person')}>A person</button>
      </div>
    </div>

    <div class="grp">
      <span class="g-lab" id="pr-gate">Gate</span>
      <div class="seg" role="group" aria-labelledby="pr-gate">
        <button class:on={!gateRed} aria-pressed={!gateRed} onclick={() => setGate(false)}>green</button>
        <button class="danger" class:on={gateRed} aria-pressed={gateRed} onclick={() => setGate(true)}>red</button>
      </div>
    </div>

    <button class="go" onclick={push} disabled={inFlight}>
      {inFlight ? 'running…' : finished ? '↻ Push again' : '▶ Push the change'}
    </button>
  </div>

  <div class="paths">
    <span class="g-lab" id="pr-touch">What it touches</span>
    <ul class="chips" aria-labelledby="pr-touch">
      {#each RISK_PATHS as p (p.group)}
        <li>
          <button class:on={picked.includes(p.group)} aria-pressed={picked.includes(p.group)}
                  title={p.why} onclick={() => toggle(p.group)}>{CHIP[p.group] ?? p.group}</button>
        </li>
      {/each}
    </ul>
    <p class="tier" class:high>{high ? `high tier · ${picked.length} protected` : 'low tier · nothing protected'}</p>
  </div>

  <Steps {items} {selected} onselect={(id) => (selected = id)} {tone} railed />

  <div class="vd" class:stop={finished && gateRed} class:hold={finished && held} class:ship={finished && selfMerge}
       aria-live="polite">
    {#if !finished}
      <span class="v-mark" aria-hidden="true">{inFlight ? '·' : '▸'}</span>
      <span class="v-txt">{inFlight ? 'Running…' : 'Set the controls, then push.'}</span>
    {:else if gateRed}
      <span class="v-mark" aria-hidden="true">✕</span>
      <span class="v-txt"><b>Stopped at the gate.</b> Deploy declares the gate as a dependency, so it never starts.</span>
    {:else if held}
      <span class="v-mark" aria-hidden="true">⏸</span>
      <span class="v-txt"><b>Held for a person.</b>
        {#if lastPick}{lastPick.group} — {lastPick.why}{:else}Every human-authored change waits for a person.{/if}</span>
    {:else}
      <span class="v-mark" aria-hidden="true">✓</span>
      <span class="v-txt"><b>Live.</b> Merged itself, built on the machine that serves it, commit written down.</span>
    {/if}
  </div>

  <div class="det">
    <b class="d-name">{stage.name}</b>
    <p class="d-line">{eli ? stage.eli5 : LINE[stage.id]}</p>
  </div>

  <p class="sub">Why stage 5 runs on the target</p>
  <div class="tiles">
    <Stat value="5 GB+" label="peak build memory" how="more than a standard hosted runner has" {tone} />
    <Stat value="0" label="production keys held off-site" how="the build runs where it deploys" {tone} />
  </div>
</div>

<style>
  .pr { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .ctl { display: flex; align-items: center; gap: 9px 18px; flex-wrap: wrap; }
  .grp { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .g-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); }

  .seg { display: flex; border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-pill); overflow: hidden; }
  .seg button { font-family: 'DM Sans', sans-serif; font-size: 12px; line-height: 1.2;
    padding: 5px 12px; border: none; background: rgba(255,255,255,0.6); color: var(--text-primary);
    cursor: pointer; transition: background 0.12s, color 0.12s; }
  .seg button + button { border-left: 1px solid rgba(28,22,17,0.2); }
  .seg button:hover { background: rgba(28,22,17,0.07); }
  .seg button.on { background: var(--tone); color: #fff; }
  .seg button.danger.on { background: #c44; }

  .go { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: #fff;
    background: var(--tone); border: none; border-radius: var(--radius-round);
    padding: 7px 16px; cursor: pointer; margin-left: auto; }
  .go:disabled { opacity: 0.5; cursor: default; }

  .paths { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .chips { list-style: none; display: flex; flex-wrap: wrap; gap: 5px; margin: 0; padding: 0; }
  .chips button { font-family: 'DM Sans', sans-serif; font-size: 12px; line-height: 1.25;
    color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-pill);
    padding: 4px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .chips button:hover { background: rgba(28,22,17,0.06); border-color: rgba(28,22,17,0.36); }
  .chips button.on { background: color-mix(in srgb, var(--tone) 14%, transparent); border-color: var(--tone); }

  .tier { margin: 1px 0 0; font-family: 'JetBrains Mono', monospace; font-size: 10px;
    letter-spacing: 0.04em; color: rgba(28,22,17,0.55); }
  .tier.high { color: var(--tone); }

  .vd { display: flex; gap: 8px; align-items: baseline; padding: 9px 12px;
    border-radius: var(--radius-round); background: rgba(28,22,17,0.04);
    border-left: 3px solid rgba(28,22,17,0.2); font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.75); min-height: 2.6em; }
  .vd.stop { background: rgba(196,68,68,0.09); border-left-color: #c44; }
  .vd.hold { background: color-mix(in srgb, var(--tone) 8%, transparent); border-left-color: var(--tone); }
  .vd.ship { background: rgba(45,122,58,0.09); border-left-color: #2d7a3a; }
  .v-mark { flex-shrink: 0; font-family: 'JetBrains Mono', monospace; color: rgba(28,22,17,0.45); }
  .vd.stop .v-mark { color: #c44; }
  .vd.hold .v-mark { color: var(--tone); }
  .vd.ship .v-mark { color: #2d7a3a; }
  .v-txt { min-width: 0; }
  .v-txt b { color: var(--text-primary); }

  .det { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--tone);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: rgba(255,255,255,0.55); padding: 9px 13px; min-width: 0; }
  .d-name { font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600;
    color: var(--text-primary); line-height: 1.2; }
  .d-line { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.75); max-width: 84ch; }

  .sub { margin: 4px 0 0; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.13em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }

  @media (max-width: 520px) {
    .go { margin-left: 0; flex-basis: 100%; }
    .tiles { grid-template-columns: 1fr; }
  }
</style>
