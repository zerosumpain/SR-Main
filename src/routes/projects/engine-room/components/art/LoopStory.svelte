<script lang="ts">
  // LoopStory — the overview's scroll story. A drawing pinned on one side changes scene as
  // the reader scrolls the five beats on the other: a thought noticed, a verdict given, an
  // idea queued, a build run, a phone lit up.
  //
  // Each scene is one SVG group. The one in the reading line is `.on`, and its parts animate
  // in with CSS keyed off that class, so scrolling back replays it. Under reduced motion the
  // scenes simply swap. The words are lib/story.ts; the figures in the drawing are facts.
  import { app } from '../../lib/appState.svelte';
  import { STORY } from '../../lib/story';
  import { href } from '../../lib/nav';
  import { steps } from '../../lib/motion';

  interface Props {
    /** The real next question the think loop will ask, from facts. */
    question: { channel: string; outcome: string } | null;
    /** The daydream stage labels, from facts. */
    stages: string[];
    cadence: number;
    /** Gate names a build passes, from facts. Only the first few are drawn. */
    gates: string[];
    tabs: number;
  }
  let { question, stages, cadence, gates, tabs }: Props = $props();

  let active = $state(0);
  const eli = $derived(app.narrative === 'eli5');
  const beat = $derived(STORY[active]);
  const SOURCES = ['daydream', 'my questions', 'its own faults'];
</script>

<div class="story">
  <div class="stage" data-part={beat.part}>
    <div class="stage-in">
      <div class="dots" aria-hidden="true">
        {#each STORY as b, i}<span class:on={i === active} class:past={i < active} data-part={b.part}></span>{/each}
      </div>
      <svg viewBox="0 0 520 440" role="img" aria-label="{beat.title}. {beat.plain}">
        <!-- 1 · it notices -->
        <g class="scene" class:on={active === 0} data-part="daydream">
          <circle class="dial" cx="160" cy="230" r="112" />
          {#each Array(12) as _, i}
            <line class="tick" x1="160" y1="128" x2="160" y2={i % 3 === 0 ? 146 : 138} transform="rotate({i * 30} 160 230)" />
          {/each}
          <g class="hand-wrap"><line class="hand" x1="160" y1="230" x2="160" y2="146" /></g>
          <circle class="pin" cx="160" cy="230" r="7" />
          <text class="cap" x="160" y="378" text-anchor="middle">every {cadence} min</text>
          <path class="wire" d="M262 186 C 310 150, 330 150, 352 160" pathLength="1" />
          <g class="card c1">
            <rect x="340" y="96" width="150" height="128" rx="2" />
            <rect class="tag" x="354" y="110" width="78" height="22" rx="11" />
            <text class="tag-t" x="393" y="125" text-anchor="middle">a note</text>
            <line class="ln" x1="354" y1="150" x2="474" y2="150" /><line class="ln" x1="354" y1="168" x2="460" y2="168" />
            <line class="ln" x1="354" y1="186" x2="430" y2="186" /><line class="ln" x1="354" y1="204" x2="448" y2="204" />
          </g>
          {#if question}
            <g class="q">
              <rect x="300" y="262" width="200" height="86" rx="2" />
              <text class="q-k" x="314" y="286">next question</text>
              <text class="q-t" x="314" y="310">{question.channel}</text>
              <text class="q-t dim" x="314" y="332">→ {question.outcome}</text>
            </g>
          {/if}
        </g>

        <!-- 2 · I decide -->
        <g class="scene" class:on={active === 1} data-part="daydream">
          <g class="track">
            {#each stages as s, i}
              <circle class="st" class:lit={i < 2} cx={70 + i * 127} cy="58" r="12" />
              {#if i}<line class="st-l" class:lit={i < 2} x1={70 + (i - 1) * 127 + 14} y1="58" x2={70 + i * 127 - 14} y2="58" />{/if}
              <text class="st-t" x={70 + i * 127} y="94" text-anchor="middle">{s}</text>
            {/each}
          </g>
          <g class="card big">
            <rect x="110" y="130" width="300" height="170" rx="2" />
            <rect class="tag" x="128" y="148" width="92" height="22" rx="11" />
            <text class="tag-t" x="174" y="163" text-anchor="middle">a note</text>
            <line class="ln" x1="128" y1="192" x2="390" y2="192" /><line class="ln" x1="128" y1="214" x2="370" y2="214" />
            <line class="ln" x1="128" y1="236" x2="330" y2="236" />
          </g>
          <g class="btns">
            <g class="b yes"><rect x="96" y="326" width="104" height="40" rx="20" /><text x="148" y="351" text-anchor="middle">useful</text></g>
            <g class="b"><rect x="210" y="326" width="120" height="40" rx="20" /><text x="270" y="351" text-anchor="middle">not useful</text></g>
            <g class="b"><rect x="340" y="326" width="112" height="40" rx="20" /><text x="396" y="351" text-anchor="middle">not for me</text></g>
          </g>
          <g class="finger"><path d="M0 0 L0 30 L8 23 L14 36 L20 33 L14 21 L24 21Z" /></g>
          <text class="cap you" x="260" y="410" text-anchor="middle">my move</text>
        </g>

        <!-- 3 · ideas join one queue -->
        <g class="scene" class:on={active === 2} data-part="build">
          {#each SOURCES as s, i}
            <path class="stream" d="M40 {110 + i * 110} C 180 {110 + i * 110}, 220 220, 330 220" pathLength="1" style="--d:{i * 0.15}s" />
            <text class="src" x="40" y={96 + i * 110}>{s}</text>
            <circle class="drop" r="7" style="--d:{i * 0.6}s"><animateMotion dur="2.4s" repeatCount="indefinite" begin="{i * 0.6}s" path="M40 {110 + i * 110} C 180 {110 + i * 110}, 220 220, 330 220" /></circle>
          {/each}
          <g class="queue">
            {#each Array(5) as _, i}
              <rect class="tkt" class:mine={i === 0} x="340" y={130 + i * 38} width="150" height="30" rx="2" style="--d:{0.3 + i * 0.1}s" />
            {/each}
            <text class="cap" x="415" y="340" text-anchor="middle">one backlog</text>
          </g>
          <g class="moon"><circle cx="450" cy="64" r="22" /><circle class="moon-cut" cx="462" cy="56" r="20" /></g>
          <text class="cap" x="404" y="70" text-anchor="end">overnight</text>
        </g>

        <!-- 4 · it builds it -->
        <g class="scene" class:on={active === 3} data-part="build">
          <line class="belt" x1="20" y1="300" x2="500" y2="300" />
          {#each Array(12) as _, i}<circle class="roller" cx={30 + i * 42} cy="312" r="9" />{/each}
          <g class="parcel"><rect x="-26" y="-22" width="52" height="44" rx="2" /><path d="M-26 -6 H26 M0 -22 V22" /></g>
          <g class="box-brief"><rect x="40" y="150" width="110" height="80" rx="2" /><text x="95" y="196" text-anchor="middle">brief</text></g>
          <g class="box-gear">
            <g class="mini-gear"><path d="M0 -34 L8 -26 L18 -30 L22 -18 L34 -14 L30 -2 L36 8 L26 16 L26 28 L14 28 L6 38 L-4 30 L-16 34 L-20 22 L-32 18 L-28 6 L-36 -4 L-26 -12 L-26 -24 L-14 -24 L-6 -34Z" /></g>
            <circle class="mini-hub" r="11" />
          </g>
          <g class="checks">
            {#each gates.slice(0, 3) as g, i}
              <g class="chk" style="--d:{0.7 + i * 0.35}s" transform="translate(330 {130 + i * 42})">
                <circle r="13" /><path d="M-6 0 L-2 5 L7 -5" /><text x="24" y="5">{g}</text>
              </g>
            {/each}
          </g>
          <text class="cap" x="260" y="380" text-anchor="middle">a private copy, then the same checks as mine</text>
        </g>

        <!-- 5 · it reaches my pocket -->
        <g class="scene" class:on={active === 4} data-part="app">
          <g class="phone">
            <rect class="ph-body" x="150" y="40" width="190" height="370" rx="28" />
            <rect class="ph-screen" x="164" y="56" width="162" height="338" rx="18" />
            <rect class="ph-notch" x="215" y="66" width="60" height="16" rx="8" />
            <g class="notif"><rect x="176" y="100" width="138" height="56" rx="10" /><line x1="190" y1="120" x2="290" y2="120" /><line x1="190" y1="138" x2="260" y2="138" /></g>
            {#each Array(6) as _, i}<rect class="app-ico" x={182 + (i % 3) * 44} y={186 + Math.floor(i / 3) * 46} width="34" height="34" rx="8" style="--d:{0.4 + i * 0.07}s" />{/each}
            <rect class="widget" x="182" y="282" width="122" height="78" rx="12" />
          </g>
          <g class="watch">
            <rect class="w-strap" x="396" y="150" width="56" height="190" rx="10" />
            <rect class="w-body" x="380" y="196" width="88" height="100" rx="22" />
            <circle class="w-ring" cx="424" cy="246" r="28" pathLength="1" />
          </g>
          <text class="cap" x="260" y="434" text-anchor="middle">{tabs} tabs, widgets, the Lock Screen and the watch</text>
        </g>
      </svg>
    </div>
  </div>

  <ol class="beats" {@attach steps((i) => (active = i), { line: 0.55 })}>
    {#each STORY as b, i (b.id)}
      <li class="beat" class:on={i === active} data-step data-part={b.part}>
        <span class="b-no">{String(i + 1).padStart(2, '0')}</span>
        <h3 class="b-title">{b.title}</h3>
        <p class="b-text">{eli ? b.plain : b.eng}</p>
        <a class="b-more" href={href(b.more.part, b.more.slug)}>{b.more.label} <span aria-hidden="true">→</span></a>
      </li>
    {/each}
  </ol>
</div>

<style>
  .story { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: clamp(24px, 5vw, 80px); align-items: start; }
  .stage { position: sticky; top: calc(var(--topH, 0px) + 24px); }
  .stage-in { position: relative; border: 1px solid var(--rule); background: var(--lift); padding: clamp(14px, 2vw, 26px); }
  .dots { display: flex; gap: 6px; margin-bottom: 10px; }
  .dots span { flex: 1; height: 3px; background: var(--rule); transition: background 0.4s; }
  .dots span.past, .dots span.on { background: var(--tone); }
  svg { display: block; width: 100%; height: auto; }

  .beats { list-style: none; margin: 0; padding: 0 0 20vh; }
  .beat { min-height: 62vh; display: flex; flex-direction: column; justify-content: center; gap: 12px; opacity: 0.32; transition: opacity 0.5s; }
  .beat.on { opacity: 1; }
  .b-no { font-family: var(--er-display); font-size: clamp(44px, 5vw, 72px); line-height: 1; color: var(--tone-text); }
  .b-title { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(28px, 3.2vw, 46px); line-height: 0.95; margin: 0; color: var(--fg); }
  .b-text { margin: 0; font-size: clamp(16px, 1.3vw, 19px); line-height: 1.6; color: var(--fg-2); max-width: 46ch; }
  .b-more { align-self: flex-start; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--tone-text); text-decoration: none; border-bottom: 2px solid currentColor; padding-bottom: 2px; }

  @media (max-width: 860px) {
    .story { grid-template-columns: minmax(0, 1fr); }
    .stage { top: var(--topH, 0px); z-index: 2; margin: 0 calc(-1 * var(--er-gutter)); }
    .stage-in { border-left: none; border-right: none; padding: 10px var(--er-gutter); }
    svg { max-height: 36vh; margin: 0 auto; }
    .beat { min-height: 70vh; justify-content: flex-start; padding-top: 6vh; }
  }

  /* ── scene system ── */
  .scene { opacity: 0; transition: opacity 0.45s; pointer-events: none; }
  .scene.on { opacity: 1; }
  text { font-family: var(--er-mono); font-size: 14px; fill: var(--fg-2); }
  .cap { font-size: 14px; fill: var(--fg-3); letter-spacing: 0.04em; }
  .cap.you { fill: var(--you); }
  .card rect:first-child, .q rect { fill: var(--ground); stroke: var(--fg); stroke-width: 2; }
  .tag { fill: var(--tone); }
  .tag-t { fill: var(--er-ink); font-size: 13px; font-weight: 600; }
  .ln { stroke: var(--rule-strong); stroke-width: 6; stroke-linecap: square; }

  /* 1 */
  .dial { fill: none; stroke: var(--fg); stroke-width: 3; }
  .tick { stroke: var(--fg-3); stroke-width: 3; }
  .hand-wrap { transform-origin: 160px 230px; transform-box: view-box; }
  .scene.on .hand-wrap { animation: sweep 6s linear infinite; }
  @keyframes sweep { to { transform: rotate(360deg); } }
  .hand { stroke: var(--tone); stroke-width: 6; stroke-linecap: round; }
  .pin { fill: var(--fg); }
  .wire { fill: none; stroke: var(--tone); stroke-width: 2.5; stroke-dasharray: 1; stroke-dashoffset: 1; }
  .scene.on .wire { animation: draw 1s 0.4s var(--er-ease) forwards; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .c1 { transform-box: fill-box; transform-origin: center; }
  .scene.on .c1 { animation: pop 0.7s 1s var(--er-ease) both; }
  @keyframes pop { from { opacity: 0; transform: scale(0.7) translateY(20px); } }
  .q-k { font-size: 12px; fill: var(--fg-3); text-transform: uppercase; letter-spacing: 0.1em; }
  .q-t { font-family: var(--er-body); font-size: 17px; font-weight: 600; fill: var(--fg); }
  .q-t.dim { font-weight: 400; fill: var(--tone-text); }
  .scene.on .q { animation: rise 0.6s 1.4s var(--er-ease) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } }

  /* 2 */
  .st { fill: var(--ground); stroke: var(--rule-strong); stroke-width: 3; }
  .st.lit { fill: var(--tone); stroke: var(--tone); }
  .st-l { stroke: var(--rule-strong); stroke-width: 3; }
  .st-l.lit { stroke: var(--tone); }
  .st-t { font-size: 13px; fill: var(--fg-2); }
  .b rect { fill: var(--ground); stroke: var(--fg-3); stroke-width: 2; transition: fill 0.3s, stroke 0.3s; }
  .b text { font-size: 14px; fill: var(--fg-2); }
  .scene.on .b.yes rect { animation: press 0.4s 1.5s both; }
  .scene.on .b.yes text { animation: presst 0.4s 1.5s both; }
  @keyframes press { to { fill: var(--you); stroke: var(--you); } }
  @keyframes presst { to { fill: #fff; } }
  .finger path { fill: var(--fg); stroke: var(--ground); stroke-width: 2; }
  .finger { transform: translate(420px, 420px); }
  .scene.on .finger { animation: point 1.4s 0.3s var(--er-ease) both; }
  @keyframes point { from { transform: translate(430px, 440px); opacity: 0; } to { transform: translate(150px, 344px); opacity: 1; } }

  /* 3 */
  .stream { fill: none; stroke: var(--rule-strong); stroke-width: 2; stroke-dasharray: 1; stroke-dashoffset: 1; }
  .scene.on .stream { animation: draw 1.2s var(--d) var(--er-ease) forwards; }
  .src { font-size: 14px; fill: var(--fg-2); }
  .drop { fill: var(--tone); }
  .drop:first-of-type { fill: var(--er-amber); }
  .tkt { fill: var(--ground); stroke: var(--fg-3); stroke-width: 2; }
  .tkt.mine { fill: var(--er-amber); stroke: var(--er-amber); }
  .scene.on .tkt { animation: slide 0.6s var(--d) var(--er-ease) both; }
  @keyframes slide { from { opacity: 0; transform: translateX(40px); } }
  .moon circle { fill: var(--er-amber); }
  .moon .moon-cut { fill: var(--lift); }

  /* 4 */
  .belt { stroke: var(--fg); stroke-width: 4; }
  .roller { fill: none; stroke: var(--fg-3); stroke-width: 2; }
  .parcel rect { fill: var(--er-amber); stroke: var(--fg); stroke-width: 2; }
  .parcel path { stroke: var(--fg); stroke-width: 2; fill: none; }
  .parcel { transform: translate(60px, 274px); }
  .scene.on .parcel { animation: ride 4s 0.2s linear infinite; }
  @keyframes ride { from { transform: translate(40px, 274px); } to { transform: translate(480px, 274px); } }
  .box-brief rect { fill: var(--ground); stroke: var(--fg); stroke-width: 2; }
  .box-brief text { font-size: 15px; fill: var(--fg); }
  .box-gear { transform: translate(230px, 190px); }
  .mini-gear path { fill: var(--tone); }
  .scene.on .mini-gear { animation: spin2 3s linear infinite; }
  @keyframes spin2 { to { transform: rotate(360deg); } }
  .mini-hub { fill: var(--lift); }
  .chk circle { fill: var(--tone); }
  .chk path { fill: none; stroke: #fff; stroke-width: 3; }
  .chk text { font-size: 14px; fill: var(--fg); }
  .scene.on .chk { animation: rise 0.5s var(--d) var(--er-ease) both; }

  /* 5 */
  .ph-body { fill: var(--fg); }
  .ph-screen { fill: var(--lift); }
  .ph-notch { fill: var(--fg); }
  .notif rect { fill: var(--tone); }
  .notif line { stroke: #fff; stroke-width: 6; stroke-linecap: round; opacity: 0.85; }
  .scene.on .notif { animation: drop 0.7s 0.5s var(--er-ease) both; }
  @keyframes drop { from { opacity: 0; transform: translateY(-40px); } }
  .app-ico { fill: var(--rule-strong); }
  .scene.on .app-ico { animation: rise 0.4s var(--d) var(--er-ease) both; }
  .widget { fill: none; stroke: var(--tone); stroke-width: 3; }
  .w-strap { fill: var(--fg-3); }
  .w-body { fill: var(--fg); }
  .w-ring { fill: none; stroke: var(--er-amber); stroke-width: 7; stroke-dasharray: 1; stroke-dashoffset: 1; transform: rotate(-90deg); transform-origin: 424px 246px; transform-box: view-box; }
  .scene.on .w-ring { animation: draw 1.6s 0.9s var(--er-ease) forwards; }

  @media (prefers-reduced-motion: reduce) {
    .wire, .stream, .w-ring { stroke-dashoffset: 0; }
    .parcel { transform: translate(260px, 274px); }
    .finger { transform: translate(150px, 344px); }
    .b.yes rect { fill: var(--you); stroke: var(--you); }
  }
</style>
