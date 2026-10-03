<script lang="ts">
  // TwoRooms — why a web search can't carry my data out with it. Two rooms with a sealed wall
  // between them: one holds my own data, the other opens on the internet. A thinking cycle is
  // the spark, and it is let into exactly one. Switch the cycle and watch the spark cross, the
  // other door lock behind it, and the tools it holds change.
  //
  // Built in HTML rather than one SVG so every label stays readable on a phone; on a narrow
  // screen the rooms stack and the wall lies down between them.
  interface Props {
    /** Channel labels a private cycle may start from (the research channel is the web room's). */
    privateChannels: string[];
    privateTools: number;
    webTools: number;
  }
  let { privateChannels, privateTools, webTools }: Props = $props();
  let mode = $state<'private' | 'web'>('private');
</script>

<div class="tr" data-mode={mode}>
  <div class="ctl" role="group" aria-label="Which kind of cycle">
    <button class:on={mode === 'private'} aria-pressed={mode === 'private'} onclick={() => (mode = 'private')}>A private cycle</button>
    <button class:on={mode === 'web'} aria-pressed={mode === 'web'} onclick={() => (mode = 'web')}>A research cycle</button>
  </div>

  <div class="rooms">
    <section class="room mine" class:in={mode === 'private'} aria-label="My own data">
      <span class="here" aria-hidden="true"></span>
      <header><span class="r-k">Room one</span><b>My own data</b></header>
      <ul class="things">{#each privateChannels as c}<li>{c}</li>{/each}</ul>
      <p class="tools"><b>{privateTools}</b> read-only tools</p>
      <span class="door" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11 V7 a4 4 0 0 1 8 0 V11" class="shackle" /></svg>
      </span>
    </section>

    <div class="wall" aria-hidden="true"><span>sealed</span></div>

    <section class="room web" class:in={mode === 'web'} aria-label="The open web">
      <span class="here" aria-hidden="true"></span>
      <header><span class="r-k">Room two</span><b>The open web</b></header>
      <svg class="globe" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="32" /><ellipse cx="40" cy="40" rx="14" ry="32" /><path d="M8 40 H72 M14 24 H66 M14 56 H66" />
      </svg>
      <p class="tools"><b>{webTools}</b> tools to search and read</p>
      <span class="door" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11 V7 a4 4 0 0 1 8 0 V11" class="shackle" /></svg>
      </span>
    </section>

    <span class="spark" aria-hidden="true"><span></span></span>
  </div>

  <p class="say" aria-live="polite">
    {#if mode === 'private'}
      This cycle can look at my own data and nothing else. It has no way to search the web, so nothing it reads can leave.
    {:else}
      This cycle can search and read the web, and holds none of my data, so there is nothing of mine for it to give away.
    {/if}
  </p>
</div>

<style>
  .ctl { display: inline-flex; padding: 3px; border: 1px solid var(--rule-strong); border-radius: var(--radius-pill); margin-bottom: 22px; }
  .ctl button { border: none; background: none; color: var(--fg-2); font-family: var(--er-mono); font-size: var(--fs-label); padding: 9px 18px; border-radius: var(--radius-pill); cursor: pointer; transition: background 0.25s, color 0.25s; }
  .ctl button.on { background: var(--tone); color: var(--er-ink); }

  .rooms { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 54px minmax(0, 1fr); align-items: stretch; }
  .room { position: relative; padding: clamp(18px, 2.4vw, 32px); border: 2px solid var(--rule-strong); min-height: 260px; display: flex; flex-direction: column; gap: 16px;
    transition: border-color 0.5s, background 0.5s, opacity 0.5s; opacity: 0.45; }
  .room.in { border-color: var(--tone-text); background: var(--wash); opacity: 1; }
  header { display: flex; flex-direction: column; gap: 4px; }
  .r-k { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-3); }
  header b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(22px, 2.4vw, 32px); line-height: 1; color: var(--fg); }
  .things { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .things li { font-size: var(--fs-label); padding: 5px 11px; border: 1px solid var(--rule-strong); border-radius: var(--radius-pill); color: var(--fg-2); }
  .globe { width: 76px; height: 76px; }
  .globe * { fill: none; stroke: var(--fg-2); stroke-width: 2.5; }
  .room.in .globe { animation: spin 14s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tools { margin: auto 0 0; font-size: var(--fs-label); color: var(--fg-2); }
  .tools b { font-family: var(--er-display); font-weight: 400; font-size: 34px; color: var(--tone-text); margin-right: 6px; vertical-align: -4px; }

  .door { position: absolute; top: 50%; width: 36px; height: 36px; margin-top: -18px; display: grid; place-items: center; background: var(--ground);
    border: 2px solid var(--rule-strong); border-radius: var(--radius-pill); transition: border-color 0.4s; }
  .mine .door { right: -20px; } .web .door { left: -20px; }
  .door svg { width: 20px; height: 20px; }
  .door rect { fill: var(--fg-3); }
  .door .shackle { fill: none; stroke: var(--fg-3); stroke-width: 2.5; transition: transform 0.4s var(--er-ease); }
  .room:not(.in) .door { border-color: var(--fail); }
  .room:not(.in) .door rect { fill: var(--fail); }
  .room:not(.in) .door .shackle { stroke: var(--fail); }
  .room.in .door .shackle { transform: translateY(-3px); }

  .wall { display: grid; place-items: center; background: repeating-linear-gradient(0deg, var(--rule-strong) 0 2px, transparent 2px 14px), var(--wash); }
  .wall span { writing-mode: vertical-rl; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.3em; text-transform: uppercase; color: var(--fg-3); background: var(--ground); padding: 8px 2px; }

  .spark { position: absolute; top: 74px; left: 0; width: calc((100% - 54px) / 2); display: flex; justify-content: flex-end; padding-right: 30px; pointer-events: none;
    transition: transform 0.9s var(--er-ease); }
  .spark span { width: 26px; height: 26px; border-radius: var(--radius-pill); background: var(--tone); animation: pulse 1.6s ease-in-out infinite; }
  [data-mode='web'] .spark { transform: translateX(calc(100% + 54px)); }
  @keyframes pulse { 50% { transform: scale(1.35); opacity: 0.7; } }

  .here { display: none; }
  .say { margin: 22px 0 0; font-size: clamp(16px, 1.3vw, 18px); line-height: 1.55; color: var(--fg); max-width: 60ch; }

  @media (max-width: 680px) {
    .rooms { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 40px auto; }
    .wall span { writing-mode: horizontal-tb; padding: 2px 8px; }
    .wall { background: repeating-linear-gradient(90deg, var(--rule-strong) 0 2px, transparent 2px 14px), var(--wash); }
    .mine .door { right: 50%; margin-right: -18px; top: auto; bottom: -20px; margin-top: 0; }
    .web .door { left: 50%; margin-left: -18px; top: -20px; margin-top: 0; }
    .room { min-height: 0; }
    .spark { display: none; }
    .room.in .here { display: block; position: absolute; top: 18px; right: 18px; width: 26px; height: 26px; border-radius: var(--radius-pill); background: var(--tone); animation: pulse 1.6s ease-in-out infinite; }
  }
</style>
