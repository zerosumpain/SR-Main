<script lang="ts">
  // BrokerageGates — BEAT 2 "the front door". A horizontal corridor of five solid
  // brokerage gate pills. A petrol query-dot travels gate-to-gate as the user sends
  // the question in; each cleared gate stamps a check. The centre authorises, filters
  // consent, checks legal basis, verifies identity and logs — but holds no record
  // (the always-lit "pupil records here: 0" badge). Same Svelte-5 grammar and
  // high-contrast palette as FlowsDiagram.
  import {
    FABRIC_NODES,
    WORKED_QUESTION,
    WORKED_QUESTION_SHORT,
    WORKED_ANSWER,
    WORKED_ANSWER_LABEL,
    type FabricNode,
  } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  // the five brokerage gates, in the front-door order the beat narrates
  const ORDER = ['brk-dir', 'brk-consent', 'brk-policy', 'brk-identity', 'brk-ledger'];
  const COLORS: Record<string, string> = {
    'brk-dir': '#0e5b66', // petrol — directory / routing
    'brk-consent': '#2f7d4f', // teal-green — consent / opt-out (safe)
    'brk-policy': '#c4570a', // burnt orange — rules-based PII gate
    'brk-identity': '#1c2f4a', // navy — who may ask / receive
    'brk-ledger': '#a8842a', // gold — the ledger
  };
  const gates: FabricNode[] = ORDER.map((id) => FABRIC_NODES.find((n) => n.id === id)!).filter(Boolean);
  const CONSENT_I = 1; // index of the consent & opt-out gate

  // opt-out worked numbers — proving objections bite BEFORE the query runs
  const OPT_OUTS = 37;
  const fmt = (n: number) => n.toLocaleString('en-GB');

  // journey state. phase 0 = at the entrance; 1..5 = the dot is at gate (phase-1);
  // gates.length+1 (=6) = it has exited with the answer. plain runes, no timers.
  let phase = $state(0);
  let optOut = $state(false);
  let selected = $state<string | null>(null);

  const done = $derived(phase >= gates.length + 1);
  const started = $derived(phase > 0);
  // dot horizontal position as a % across the gates band
  const dotLeft = $derived(phase === 0 ? 0 : done ? 100 : ((phase - 0.5) / gates.length) * 100);
  const answer = $derived(optOut ? WORKED_ANSWER - OPT_OUTS : WORKED_ANSWER);
  const selectedGate = $derived(gates.find((g) => g.id === selected) ?? null);

  const isCleared = (i: number) => phase > i + 1;
  const isActive = (i: number) => phase === i + 1;

  function send() {
    if (phase === 0) phase = 1;
  }
  function stepFwd() {
    if (phase >= 1 && phase < gates.length + 1) phase += 1;
  }
  function stepBack() {
    if (phase > 1) phase -= 1;
  }
  function reset() {
    phase = 0;
  }
  function pick(id: string) {
    selected = selected === id ? null : id;
  }
</script>

<figure class="bg">
  <figcaption class="cap">
    <span class="eyebrow">Beat 2 · The front door</span>
    <p class="q">
      <span class="q-mark">the question:</span>
      {WORKED_QUESTION}
    </p>
  </figcaption>

  <div class="stage">
    <div class="corridor-scroll">
      <div class="corridor">
        <div class="port entry" aria-hidden="true">
          <span class="port-lab">question<br />goes in</span>
          <span class="port-chip">{WORKED_QUESTION_SHORT}</span>
        </div>

        <div class="gates">
          <!-- the rail the query-dot travels along -->
          <div class="track">
            <span class="rail"></span>
            <span
              class="dot"
              class:parked={phase === 0}
              class:out={done}
              style="left:{dotLeft}%"
              aria-hidden="true"
            ></span>
          </div>

          {#each gates as g, i (g.id)}
            <button
              class="gate"
              class:active={isActive(i)}
              class:cleared={isCleared(i)}
              class:open={selected === g.id}
              style="--gc:{COLORS[g.id]}"
              onclick={() => pick(g.id)}
              aria-pressed={selected === g.id}
              title="Inspect: {g.label}"
              aria-label="Gate {i + 1}, {g.label}. {isCleared(i) ? 'Cleared. ' : ''}Click to inspect."
            >
              <span class="g-top">
                <span class="g-no">0{i + 1}</span>
                <span class="g-stamp" class:show={isCleared(i)} aria-hidden="true">✓</span>
              </span>
              <span class="g-label">{g.label}</span>
              <span class="g-sub">{g.sub}</span>

              {#if i === CONSENT_I}
                <span class="optline" class:on={optOut} class:live={optOut && phase > CONSENT_I}>
                  {#if optOut}
                    <span class="ol-nums">{fmt(WORKED_ANSWER)} <span class="ol-arrow">→</span> {fmt(WORKED_ANSWER - OPT_OUTS)}</span>
                    <span class="ol-note">{OPT_OUTS} opt-outs removed before the query runs</span>
                  {:else}
                    <span class="ol-note muted">opt-outs: none set</span>
                  {/if}
                </span>
              {/if}

              <span class="g-hint" aria-hidden="true">inspect</span>
            </button>
          {/each}
        </div>

        <div class="port exit" aria-hidden="true">
          <span class="port-lab">only totals<br />come back</span>
          <span class="port-chip out" class:lit={done}>
            {#if done}{fmt(answer)} · {WORKED_ANSWER_LABEL}{:else}—{/if}
          </span>
        </div>
      </div>
    </div>

    <!-- the whole point: the centre never keeps a copy -->
    <div class="hold-badge" title="The national brokerage stores no pupil-level data.">
      <span class="hb-dot" aria-hidden="true"></span>
      pupil records held here: <b>0</b>
    </div>
  </div>

  <div class="controls">
    <div class="run">
      <button class="btn primary" onclick={send} disabled={started} title="Send the worked question into the brokerage">
        Send the question in ▸
      </button>
      <div class="step">
        <button class="btn ghost" onclick={stepBack} disabled={phase <= 1} aria-label="Step the query-dot back one gate" title="Back one gate">◂</button>
        <span class="step-read" aria-live="polite">
          {#if !started}at the door{:else if done}answer returned{:else}gate {phase} of {gates.length}: {gates[phase - 1].label}{/if}
        </span>
        <button class="btn ghost" onclick={stepFwd} disabled={!started || done} aria-label="Step the query-dot forward one gate" title="Forward one gate">▸</button>
      </div>
      <button class="btn link" onclick={reset} disabled={!started} title="Reset the journey">reset</button>
    </div>

    <button
      class="toggle"
      class:on={optOut}
      onclick={() => (optOut = !optOut)}
      aria-pressed={optOut}
      title="Toggle: what if a pupil opted out?"
    >
      <span class="tg-box" aria-hidden="true"></span>
      what if a pupil opted out?
    </button>
  </div>

  {#if selectedGate}
    <aside class="inspector" style="--gc:{COLORS[selectedGate.id]}">
      <div class="ins-head">
        <div>
          <span class="ins-eyebrow">Brokerage service</span>
          <h4>{selectedGate.label}</h4>
          {#if selectedGate.sub}<span class="ins-sub">{selectedGate.sub}</span>{/if}
        </div>
        <button class="ins-close" onclick={() => (selected = null)} aria-label="Close inspector" title="Close">✕</button>
      </div>
      <p class="ins-desc">{selectedGate.desc}</p>
      <div class="ins-meta">
        {#if selectedGate.exemplar}
          <div class="im-row">
            <span class="im-k">Exemplar</span>
            <span class="im-v">{selectedGate.exemplar}</span>
          </div>
        {/if}
        {#if selectedGate.standards}
          <div class="im-row">
            <span class="im-k">Standards</span>
            <span class="im-v mono">{selectedGate.standards}</span>
          </div>
        {/if}
      </div>
    </aside>
  {/if}

  <p class="takeaway">
    The centre <b>authorises, filters consent, checks legal basis, verifies identity and logs</b> — and holds no
    record. The question passes five gates; only a no-PII total ever comes back.
  </p>

  {#if eli}
    <p class="eli-note">
      Think of a guarded corridor with five doors. Your question walks through them one by one. Door 2 quietly drops
      anyone who said “no thank you” <em>before</em> anything runs. Nobody in the corridor keeps a copy of the pupils —
      the counter always reads zero.
    </p>
  {/if}
</figure>

<style>
  .bg {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .cap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent-ink, #0e5b66);
  }
  .q {
    margin: 0;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(16px, 1.9vw, 21px);
    line-height: 1.3;
    color: var(--ink, #1a1008);
  }
  .q-mark {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.6);
    margin-right: 8px;
    vertical-align: 2px;
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .corridor-scroll {
    overflow-x: auto;
  }
  .corridor {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: stretch;
    gap: 12px;
    min-width: 720px;
    background: var(--surface-elevated, #e8dece);
    border: 1.5px solid rgba(26, 16, 8, 0.45);
    border-radius: var(--radius-round, 12px);
    padding: 16px 16px 14px;
  }

  .port {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    align-items: center;
    width: 108px;
    text-align: center;
  }
  .port-lab {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    line-height: 1.5;
    color: rgba(26, 16, 8, 0.72);
  }
  .port-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    line-height: 1.35;
    color: var(--ink, #1a1008);
    background: #faf6ec;
    border: 1.5px solid rgba(26, 16, 8, 0.45);
    border-radius: var(--radius-sharp, 4px);
    padding: 6px 8px;
  }
  .port-chip.out {
    font-size: 12px;
    font-weight: 600;
    color: rgba(26, 16, 8, 0.55);
    border-style: dashed;
  }
  .port-chip.out.lit {
    color: #2f7d4f;
    border-color: #2f7d4f;
    border-style: solid;
    background: #fff;
  }

  .gates {
    position: relative;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
    padding-top: 22px; /* room for the rail + dot */
  }

  .track {
    position: absolute;
    top: 6px;
    left: 0;
    right: 0;
    height: 12px;
  }
  .rail {
    position: absolute;
    top: 5px;
    left: 4%;
    right: 4%;
    height: 2px;
    background: rgba(26, 16, 8, 0.3);
    border-radius: 2px;
  }
  .dot {
    position: absolute;
    top: 0;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border-radius: var(--radius-pill, 100px);
    background: var(--accent-ink, #0e5b66);
    border: 2px solid #faf6ec;
    box-sizing: border-box;
    transition: left 0.55s cubic-bezier(0.4, 0.05, 0.2, 1);
  }
  .dot::after {
    content: '';
    position: absolute;
    inset: -5px;
    border-radius: var(--radius-pill, 100px);
    border: 2px solid var(--accent-ink, #0e5b66);
    opacity: 0.4;
  }
  .dot.parked {
    background: rgba(26, 16, 8, 0.4);
  }
  .dot.parked::after {
    display: none;
  }
  .dot.out {
    background: #2f7d4f;
  }
  .dot.out::after {
    border-color: #2f7d4f;
  }

  .gate {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    cursor: pointer;
    background: #ffffff;
    border: 1.5px solid rgba(26, 16, 8, 0.45);
    border-top: 4px solid var(--gc);
    border-radius: var(--radius-round, 12px);
    padding: 10px 11px 30px;
    min-height: 108px;
    font-family: inherit;
    transition: border-color 0.2s, transform 0.2s;
  }
  .gate:hover {
    border-color: var(--gc);
  }
  .gate.active {
    border-color: var(--gc);
    background: #faf6ec;
    transform: translateY(-2px);
  }
  .gate.active::before {
    content: '';
    position: absolute;
    inset: -3px;
    border: 2px solid var(--gc);
    border-radius: var(--radius-round, 12px);
    pointer-events: none;
  }
  .gate.open {
    border-color: var(--gc);
    box-shadow: none;
    outline: 2px solid var(--gc);
    outline-offset: 1px;
  }

  .g-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .g-no {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--gc);
    font-weight: 600;
  }
  .g-stamp {
    display: grid;
    place-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-pill, 100px);
    background: var(--gc);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    transform: scale(0);
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .g-stamp.show {
    transform: scale(1);
  }
  .g-label {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 13.5px;
    line-height: 1.2;
    color: var(--ink, #1a1008);
  }
  .g-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.03em;
    color: rgba(26, 16, 8, 0.72);
    line-height: 1.4;
  }

  .optline {
    margin-top: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-top: 1px dashed rgba(26, 16, 8, 0.3);
    padding-top: 5px;
  }
  .ol-nums {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 700;
    color: #2f7d4f;
  }
  .ol-arrow {
    color: rgba(26, 16, 8, 0.55);
    margin: 0 1px;
  }
  .ol-note {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.02em;
    line-height: 1.35;
    color: #2f7d4f;
  }
  .ol-note.muted {
    color: rgba(26, 16, 8, 0.6);
  }
  .optline.live .ol-nums,
  .optline.live .ol-note {
    color: #2f7d4f;
  }

  .g-hint {
    position: absolute;
    bottom: 8px;
    left: 11px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.6);
  }
  .gate:hover .g-hint,
  .gate.open .g-hint {
    color: var(--gc);
  }

  .hold-badge {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.82);
    background: #faf6ec;
    border: 1.5px solid rgba(26, 16, 8, 0.5);
    border-radius: var(--radius-pill, 100px);
    padding: 7px 14px;
  }
  .hold-badge b {
    font-size: 13px;
    color: var(--ink, #1a1008);
  }
  .hb-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill, 100px);
    background: #2f7d4f;
    box-shadow: 0 0 0 3px rgba(47, 125, 79, 0.22);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .run {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }
  .step {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .step-read {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    color: rgba(26, 16, 8, 0.72);
    min-width: 116px;
    text-align: center;
  }
  .btn {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    border-radius: var(--radius-round, 12px);
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.18s, border-color 0.18s, opacity 0.18s;
  }
  .btn.primary {
    background: var(--ink, #1a1008);
    color: #f1ead6;
    border: 1.5px solid var(--ink, #1a1008);
  }
  .btn.primary:hover:not(:disabled) {
    background: #000;
  }
  .btn.ghost {
    background: #faf6ec;
    color: var(--ink, #1a1008);
    border: 1.5px solid rgba(26, 16, 8, 0.45);
    padding: 8px 12px;
    line-height: 1;
  }
  .btn.ghost:hover:not(:disabled) {
    border-color: var(--ink, #1a1008);
  }
  .btn.link {
    background: transparent;
    border: none;
    color: rgba(26, 16, 8, 0.72);
    text-decoration: underline;
    text-underline-offset: 3px;
    padding: 8px 4px;
    font-size: 12px;
  }
  .btn.link:hover:not(:disabled) {
    color: var(--accent, #c4570a);
  }
  .btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: rgba(26, 16, 8, 0.82);
    background: #faf6ec;
    border: 1.5px solid rgba(26, 16, 8, 0.45);
    border-radius: var(--radius-pill, 100px);
    padding: 7px 14px 7px 11px;
    cursor: pointer;
    transition: border-color 0.18s, color 0.18s;
  }
  .toggle .tg-box {
    width: 30px;
    height: 17px;
    border-radius: var(--radius-pill, 100px);
    background: rgba(26, 16, 8, 0.28);
    position: relative;
    transition: background 0.18s;
    flex: 0 0 auto;
  }
  .toggle .tg-box::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 13px;
    height: 13px;
    border-radius: var(--radius-pill, 100px);
    background: #faf6ec;
    transition: transform 0.18s;
  }
  .toggle.on {
    border-color: #2f7d4f;
    color: #2f7d4f;
  }
  .toggle.on .tg-box {
    background: #2f7d4f;
  }
  .toggle.on .tg-box::after {
    transform: translateX(13px);
  }

  .inspector {
    background: #ffffff;
    border: 1.5px solid rgba(26, 16, 8, 0.5);
    border-left: 5px solid var(--gc);
    border-radius: var(--radius-round, 12px);
    padding: 14px 16px 16px;
  }
  .ins-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .ins-eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--gc);
  }
  .ins-head h4 {
    margin: 3px 0 2px;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 18px;
    color: var(--ink, #1a1008);
  }
  .ins-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.03em;
    color: rgba(26, 16, 8, 0.72);
  }
  .ins-close {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-pill, 100px);
    background: #faf6ec;
    border: 1.5px solid rgba(26, 16, 8, 0.45);
    color: var(--ink, #1a1008);
    font-size: 13px;
    cursor: pointer;
  }
  .ins-close:hover {
    border-color: var(--ink, #1a1008);
  }
  .ins-desc {
    margin: 10px 0 12px;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: rgba(26, 16, 8, 0.82);
  }
  .ins-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px dashed rgba(26, 16, 8, 0.28);
    padding-top: 10px;
  }
  .im-row {
    display: grid;
    grid-template-columns: 92px 1fr;
    gap: 10px;
    align-items: baseline;
  }
  .im-k {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.6);
  }
  .im-v {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink, #1a1008);
  }
  .im-v.mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    color: rgba(26, 16, 8, 0.82);
  }

  .takeaway {
    margin: 0;
    font-family: 'DM Sans', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: rgba(26, 16, 8, 0.82);
    border-left: 3px solid var(--accent-ink, #0e5b66);
    padding-left: 12px;
  }
  .takeaway b {
    color: var(--ink, #1a1008);
  }

  .eli-note {
    margin: 0;
    font-size: 13px;
    font-style: italic;
    line-height: 1.6;
    color: rgba(26, 16, 8, 0.72);
  }

  @media (max-width: 640px) {
    .controls {
      flex-direction: column;
      align-items: stretch;
    }
    .run {
      justify-content: space-between;
    }
  }
</style>
