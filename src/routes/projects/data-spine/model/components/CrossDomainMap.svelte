<script lang="ts">
  // CrossDomainMap — BEAT 5 "beyond education". The DfE brokerage federates to
  // other domains by trust-federation, never a shared pool. Toggle members on/off,
  // then run the Milburn hidden-NEETs query: a no-PII answer assembles across
  // education + DWP + health with no combined database ever forming; each join
  // writes to a ledger tally. Timer handles are plain `let` (svelte5-pitfalls).
  import { onMount } from 'svelte';
  import { FABRIC_NODES } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  const MEMBERS = FABRIC_NODES.filter((n) => n.band === 'cross');
  // members that the hidden-NEETs query actually needs
  const NEET_IDS = new Set(['x-dwp', 'x-nhs']);

  let on = $state<Record<string, boolean>>(Object.fromEntries(MEMBERS.map((m) => [m.id, true])));
  let selected = $state<string | null>(null);
  let phase = $state<'idle' | 'run' | 'done'>('idle');
  let ledger = $state(0);
  let runKey = $state(0);
  let timers: ReturnType<typeof setTimeout>[] = []; // plain let

  function clear() { timers.forEach(clearTimeout); timers = []; }

  function runNeet() {
    clear();
    phase = 'run';
    ledger = 0;
    runKey += 1;
    // ensure the needed members are on
    for (const id of NEET_IDS) on[id] = true;
    const active = MEMBERS.filter((m) => on[m.id]);
    active.forEach((_, i) => timers.push(setTimeout(() => { ledger += 1; }, 700 + i * 350)));
    timers.push(setTimeout(() => { phase = 'done'; }, 700 + active.length * 350 + 500));
  }

  onMount(() => () => clear());

  // geometry — education (left) → thin DfE brokerage hub (centre) → cross-domain
  // members in a vertical column (right). Column x + box width stays inside viewBox.
  const VB_W = 800, VB_H = 470;
  const HUB = { x: 290, y: 235 };
  const EDU = { x: 96, y: 235 };
  const MEM_X = 600, MEM_W = 150, MEM_H = 52;
  const colTop = 66, colGap = (VB_H - 120 - MEM_H) / (MEMBERS.length - 1);
  const positioned = MEMBERS.map((m, i) => ({ ...m, x: MEM_X, y: colTop + i * colGap }));
  const memPath = (m: { x: number; y: number }) => `M ${HUB.x + 66} ${HUB.y} C ${HUB.x + 150} ${HUB.y}, ${m.x - 90} ${m.y}, ${m.x - 6} ${m.y}`;
</script>

<div class="xd">
  <div class="xd-bar">
    <button class="run" onclick={runNeet}>▶ Run the hidden-NEETs query</button>
    <span class="ledger" class:live={phase !== 'idle'}>ledger entries: <b>{ledger}</b></span>
    <span class="nostore">no combined database created</span>
  </div>

  <div class="stage-scroll">
    <svg viewBox="0 0 {VB_W} {VB_H}" role="img" aria-label="The DfE brokerage federates to NHS, social care, youth justice, DWP and police by trust-federation lines — no shared store — and a no-PII query assembles a hidden-NEETs answer across education, DWP and health.">
      <!-- trust-federation links -->
      {#each positioned as m (m.id)}
        {#if on[m.id]}
          <path d={memPath(m)} class="fed-line" class:active={phase !== 'idle' && NEET_IDS.has(m.id)} />
          <text x={(HUB.x + 70 + m.x - 6) / 2} y={(HUB.y + m.y) / 2 - 6} text-anchor="middle" class="fed-lab">trust-federated</text>
        {/if}
      {/each}
      <!-- education edge -->
      <path d={`M ${EDU.x + 44} ${EDU.y} H ${HUB.x - 70}`} class="fed-line edu" class:active={phase !== 'idle'} />
      <g class="edu-node">
        <rect x={EDU.x - 48} y={EDU.y - 32} width="92" height="64" rx="8" class="ebox" />
        <text x={EDU.x - 2} y={EDU.y - 6} text-anchor="middle" class="e-lab">Education</text>
        <text x={EDU.x - 2} y={EDU.y + 9} text-anchor="middle" class="e-sub">the fabric</text>
        <text x={EDU.x - 2} y={EDU.y + 23} text-anchor="middle" class="e-sub">~24k schools</text>
      </g>

      <!-- the brokerage hub -->
      <g class="hub">
        <circle cx={HUB.x} cy={HUB.y} r="66" class="hub-c" />
        <text x={HUB.x} y={HUB.y - 6} text-anchor="middle" class="hub-lab">DfE</text>
        <text x={HUB.x} y={HUB.y + 10} text-anchor="middle" class="hub-lab">brokerage</text>
        <text x={HUB.x} y={HUB.y + 26} text-anchor="middle" class="hub-sub">trust only · 0 records</text>
      </g>

      <!-- cross-domain members -->
      {#each positioned as m (m.id)}
        <g class="member" class:off={!on[m.id]} class:sel={selected === m.id} class:need={NEET_IDS.has(m.id)}
           role="button" tabindex="0" aria-label="{m.label} — toggle / details"
           onclick={() => (selected = selected === m.id ? null : m.id)}
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = selected === m.id ? null : m.id; } }}>
          <rect x={m.x - 6} y={m.y - 26} width="150" height="52" rx="8" class="mbox" />
          <text x={m.x + 69} y={m.y - 5} text-anchor="middle" class="m-lab">{m.label}</text>
          {#if m.sub}<text x={m.x + 69} y={m.y + 11} text-anchor="middle" class="m-sub">{m.sub}</text>{/if}
          <g class="toggle" transform="translate({m.x + 128}, {m.y - 20})">
            <circle r="6" class="tg" />
          </g>
        </g>
      {/each}

      <!-- assembled answer -->
      {#if phase === 'done'}
        <g class="ans">
          <rect x="250" y="392" width="320" height="56" rx="10" class="ans-box" />
          <text x="410" y="416" text-anchor="middle" class="ans-n">~314,000</text>
          <text x="410" y="434" text-anchor="middle" class="ans-lab">hidden 18–24s found · no-PII · no shared store</text>
        </g>
      {/if}

      {#key runKey}
        {#if phase !== 'idle'}
          {#each positioned.filter((m) => on[m.id] && NEET_IDS.has(m.id)) as m, i (m.id)}
            {@const rp = `M ${m.x} ${m.y} C ${m.x - 120} ${m.y}, ${HUB.x + 180} ${HUB.y}, ${HUB.x} ${HUB.y}`}
            <circle r="5" class="qdot"><animateMotion dur="0.9s" begin="{(i * 0.3).toFixed(2)}s" fill="freeze" path={rp} /></circle>
          {/each}
        {/if}
      {/key}
    </svg>
  </div>

  {#if selected}
    {@const m = MEMBERS.find((x) => x.id === selected)}
    {#if m}
      <aside class="inspector">
        <button class="close" onclick={() => (selected = null)} aria-label="Close">✕</button>
        <span class="ins-k">cross-domain member{on[m.id] ? '' : ' · federation OFF'}</span>
        <h4>{m.label}{#if m.sub}&nbsp;<em>· {m.sub}</em>{/if}</h4>
        <p>{m.desc}</p>
        <button class="tgl-btn" onclick={() => (on[m.id] = !on[m.id])}>{on[m.id] ? 'Turn federation off' : 'Turn federation on'}</button>
      </aside>
    {/if}
  {/if}

  <p class="caption">
    {#if eli}
      Other services — doctors, job centres, social workers — plug in the same careful way. To find young people
      who've gone missing from every system, the fabric asks all three at once and adds up the totals. It never
      builds one big folder about anyone.
    {:else}
      Cross-domain reach is <b>trust-federation, not a shared pool</b>. Milburn's finding — over a million NEETs,
      ~314,000 of them invisible to DfE, DWP and DHSC alike — is answerable by a no-PII query across education,
      benefits and health, with <b>no combined database ever created</b>. The join is virtual, governed and logged.
    {/if}
  </p>
</div>

<style>
  .xd { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round); background: var(--surface-elevated, #e8dece); overflow: hidden; }
  .xd-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 20px 6px; }
  .run { font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; color: #fff; background: var(--accent-ink, #0e5b66); border: 1.5px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-round); padding: 9px 18px; cursor: pointer; }
  .run:hover { background: #094850; }
  .ledger { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(26,16,8,0.7); }
  .ledger b { font-family: 'Fraunces', serif; font-size: 16px; color: #a8842a; }
  .ledger.live b { color: #a8842a; }
  .nostore { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #216b3f; margin-left: auto; }

  .stage-scroll { overflow-x: auto; padding: 4px 6px; }
  svg { display: block; min-width: 700px; width: 100%; height: auto; }

  .fed-line { fill: none; stroke: rgba(26,16,8,0.4); stroke-width: 1.6; stroke-dasharray: 6 5; }
  .fed-line.active { stroke: #2f7d4f; stroke-width: 2.2; stroke-dasharray: none; opacity: 0.7; }
  .fed-lab { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.06em; fill: rgba(26,16,8,0.5); text-transform: uppercase; }

  .ebox { fill: #fff; stroke: rgba(26,16,8,0.55); stroke-width: 1.4; }
  .e-lab { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; fill: var(--ink); }
  .e-sub { font-family: 'JetBrains Mono', monospace; font-size: 8px; fill: rgba(26,16,8,0.62); }

  .hub-c { fill: var(--accent-ink, #0e5b66); stroke: #083d45; stroke-width: 2; }
  .hub-lab { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; fill: #fff; }
  .hub-sub { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.06em; fill: #bfe0dc; }

  .member { cursor: pointer; }
  .mbox { fill: #fff; stroke: rgba(26,16,8,0.55); stroke-width: 1.4; transition: opacity 0.2s, stroke 0.15s; }
  .member.need .mbox { stroke: #2f7d4f; }
  .member.sel .mbox { stroke: var(--accent-ink, #0e5b66); stroke-width: 2.5; fill: #dce9e4; }
  .member.off .mbox { fill: #ece5d8; stroke: rgba(26,16,8,0.28); stroke-dasharray: 4 4; }
  .member.off .m-lab, .member.off .m-sub { fill: rgba(26,16,8,0.4); }
  .m-lab { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600; fill: var(--ink); }
  .m-sub { font-family: 'JetBrains Mono', monospace; font-size: 8px; fill: rgba(26,16,8,0.62); }
  .tg { fill: #2f7d4f; }
  .member.off .tg { fill: rgba(26,16,8,0.3); }

  .qdot { fill: #2f7d4f; stroke: #ede4d4; stroke-width: 1.2; }
  .ans-box { fill: #eef6f0; stroke: #2f7d4f; stroke-width: 2; }
  .ans-n { font-family: 'Fraunces', serif; font-weight: 600; font-size: 24px; fill: #1a4d2e; }
  .ans-lab { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.06em; fill: #216b3f; }

  .inspector { position: relative; margin: 4px 20px 12px; border: 1.5px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: #fff; padding: 14px 18px; }
  .inspector .close { position: absolute; top: 8px; right: 12px; background: none; border: none; color: rgba(26,16,8,0.55); cursor: pointer; font-size: 13px; }
  .ins-k { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent-ink); }
  .inspector h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; margin: 3px 0 6px; color: var(--ink); }
  .inspector h4 em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(26,16,8,0.6); }
  .inspector p { font-size: 13px; line-height: 1.55; color: rgba(26,16,8,0.85); margin: 0 0 10px; }
  .tgl-btn { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--ink); background: transparent; border: 1.5px solid rgba(26,16,8,0.5); border-radius: var(--radius-round); padding: 6px 14px; cursor: pointer; }

  .caption { font-size: 14px; line-height: 1.55; color: rgba(26,16,8,0.82); margin: 0; padding: 8px 20px 18px; }
  .caption b { color: var(--ink); }

  @media (max-width: 700px) { .xd-bar { padding: 12px 12px 4px; } .nostore { margin-left: 0; } }
</style>
