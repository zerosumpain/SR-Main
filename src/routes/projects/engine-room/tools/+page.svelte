<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import ManifestBudget from './components/ManifestBudget.svelte';
  import TtftWaterfall from './components/TtftWaterfall.svelte';
  import { LESSONS, MCP_FACTS, MANIFEST, GATEWAY } from '../lib/tools';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>Tools — the toolkit and the cost of context · The Engine Room</title>
  <meta name="description" content="155 tools, 21 shown: how an agent's capabilities are exposed without their descriptions consuming the prompt, and why the model prices your instructions." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 4 · Tools"
    title="What it can do, and what that costs to say"
    thesis="An agent's abilities have to be described to it — in full, in the prompt, before you have typed anything. This system has 155 tools. Described in full they come to about twenty-five thousand tokens of pure prefill on every message, including 'hi'. It shows the model twenty-one. The other hundred and thirty-five sit behind a single door costing three hundred tokens, and the capability is unchanged."
    thesisEli5="An AI assistant has to be told about every ability it has, every time you message it — and you pay for that explanation each time. This one has 155 abilities but only mentions 21, with a single 'ask me for the rest' option. It can still do everything; it just stops paying to list it all."
    asks={[
      'What does an agent’s capability actually cost, before it does anything?',
      'Why does a model ignore an instruction that its prompt calls mandatory?',
      'Where does the time in a request go, once you actually measure it?',
    ]}
  />

  <h2 class="pe-h2">{MANIFEST.registered} tools, {MANIFEST.shown} shown</h2>
  <ManifestBudget />

  <h2 class="pe-h2">Where the 4.4 seconds went</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      It is tempting to assume a slow assistant means slow software. Here is the actual measurement of the gap
      between pressing enter and seeing the first letter.
    {:else}
      The instinct is to optimise the code. The measurement says otherwise, and it says it emphatically enough that
      the bar needs a magnifier to show the code at all.
    {/if}
  </p>
  <TtftWaterfall />

  <h2 class="pe-h2">Five things that were not obvious</h2>
  <div class="lessons">
    {#each LESSONS as l}
      <div class="lsn">
        <h3>{l.title}</h3>
        <p class="l-body">{l.body}</p>
        <p class="l-lesson"><span>▸</span>{l.lesson}</p>
      </div>
    {/each}
  </div>

  <h2 class="pe-h2">The same tools, from outside</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Other AI assistants can plug into this system directly and use the same abilities — not a cut-down version,
      the real ones. That works because there is only ever one list of tools, and everything reads from it.
    {:else}
      The toolkit is exposed over an open protocol, so an external client can drive this system with the same tools
      its own assistant uses. This is the payoff of claim one on the index: a tool written once is available
      everywhere, because there is exactly one registry and nothing is wired twice.
    {/if}
  </p>

  <div class="mcp">
    {#each MCP_FACTS as f}
      <div class="m">
        <span class="m-k">{f.k}</span>
        <b class="m-v">{f.v}</b>
        <span class="m-why">{f.why}</span>
      </div>
    {/each}
  </div>

  <div class="ds-card gw">
    <span class="ds-kicker">The availability gateway</span>
    <h3>A restart should be latency, not an error</h3>
    <p class="ds-body">{GATEWAY.problem}</p>
    <p class="ds-body">{GATEWAY.fix}</p>
    <p class="gw-ev"><b>Measured:</b> {GATEWAY.evidence}</p>
    <p class="gw-le">▸ {GATEWAY.lesson}</p>
  </div>

  <div class="er-lesson">
    <span class="el-lab">The hazard that comes with the door</span>
    <p>Collapsing 135 tools behind one dispatcher is only free at the prompt. Everywhere downstream, a cross-cutting
      concern now has to <b>unwrap the envelope before it can act</b>: the destructive-operation gate must resolve the
      inner tool name or it gates nothing; the audit must attribute the call to the real tool or it reports on a
      wrapper; the interface must render the resolved name or every step card says the same thing.</p>
    <p>Each of those is a separate bug with no shared symptom, which is the honest cost of the design. It is worth
      paying — nineteen thousand tokens a turn is worth paying quite a lot for — but it should be paid knowingly.</p>
  </div>

  <a class="pe-next" href="/projects/engine-room/memory">Next — what it remembers, and how it finds it again →</a>
</section>

<style>
  .lessons { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin: 14px 0; }
  .lsn { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 13px 15px; }
  .lsn h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; margin: 0 0 7px; color: var(--text-primary); line-height: 1.25; }
  .l-body { margin: 0 0 9px; font-size: 13px; line-height: 1.58; color: rgba(28,22,17,0.74); }
  .l-lesson { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--accent-ink); padding-top: 8px;
    border-top: 1px solid rgba(28,22,17,0.09); display: flex; gap: 6px; }
  .l-lesson span { color: var(--accent); }

  .mcp { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin: 14px 0; }
  .m { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; }
  .m-k { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.11em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .m-v { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .m-why { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); margin-top: 3px; }

  .gw { margin: 14px 0; }
  .gw-ev { margin: 9px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78);
    padding: 8px 11px; background: rgba(45,122,58,0.09); border-radius: var(--radius-round); }
  .gw-ev b { color: #2d7a3a; }
  .gw-le { margin: 9px 0 0; font-size: 12px; line-height: 1.52; color: var(--accent-ink);
    padding-top: 8px; border-top: 1px solid rgba(28,22,17,0.09); }
</style>
