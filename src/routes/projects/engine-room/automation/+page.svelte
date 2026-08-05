<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import FanInTrap from './components/FanInTrap.svelte';
  import { CATEGORIES, ENGINE_FACTS, FANIN_STORY, DOCTOR, NODE_COUNT } from '../lib/automation';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>Automation — the workflow engine and its canvas · The Engine Room</title>
  <meta name="description" content="88 node types, a visual canvas, cron triggers that run in UTC, and the fan-in collision that silently eats a branch of data before any node sees it." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 7 · Automation"
    title="Things that happen without being asked"
    thesis="A node-based engine with eighty-eight node types and a visual editor to wire them together. Mail arrives and something runs. A schedule fires and something runs. An agent decides mid-conversation to hand work to a graph, and something runs. Most of the engineering here is not in making it work — it is in the failure modes that produce no error at all."
    thesisEli5="A drag-and-drop builder for things that should happen automatically: when an email arrives, every morning at seven, or when the assistant decides it needs to. The tricky part is not building it. It is the ways it can go wrong while looking like it worked."
    asks={[
      'What does it take to let one person automate this much without a team?',
      'Why is a scheduled job an hour out for half the year?',
      'What happens when two branches of a workflow meet, and why does the obvious fix not fix it?',
    ]}
  />

  <h2 class="pe-h2">{NODE_COUNT} node types, six categories</h2>
  <div class="cats">
    {#each CATEGORIES as c}
      <div class="cat">
        <b>{c.name}</b>
        <p>{c.what}</p>
      </div>
    {/each}
  </div>

  <div class="grid5">
    {#each ENGINE_FACTS as f}
      <div class="cell"><span class="ce-k">{f.k}</span><b>{f.v}</b><span class="ce-w">{f.why}</span></div>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">The clock problem, which everyone meets exactly once</span>
    <p>The server's clock is set to <b>UTC</b>, and for a long time any schedule that did not explicitly name a
      timezone simply inherited that. The person reading the output lives somewhere with daylight saving, so an
      evening briefing arrived an hour late from late March to late October — every year. There was no crash and
      nothing in a log to find. The interface even <i>displayed</i> the right timezone, and the schedule format
      accepted a timezone field that nothing actually read.</p>
    <p>The fix was to default to a <b>named human timezone rather than the server's setting</b>, and the reasoning is
      the part worth keeping: these schedules are written by a person, for a person, in the hours of their own day.
      Inheriting infrastructure's idea of time is how you get an answer that is technically correct and useless.</p>
  </div>

  <h2 class="pe-h2">Where two branches meet</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Two parts of an automation both feed into the same next step. You would expect both sets of data to arrive.
      One of them silently vanishes — and the obvious fix does not help. Try all three wirings.
    {:else}
      {FANIN_STORY.what}
    {/if}
  </p>

  <FanInTrap />

  <div class="ds-grid two">
    <div class="ds-card">
      <span class="ds-kicker">The incident</span>
      <h3>Nothing flagged it</h3>
      <p class="ds-body">{FANIN_STORY.incident}</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">The trap inside the trap</span>
      <h3>The node named after the problem</h3>
      <p class="ds-body">{FANIN_STORY.trap} <b>Now it is caught statically:</b> {FANIN_STORY.now}</p>
    </div>
  </div>

  <div class="er-lesson">
    <span class="el-lab">The class of bug this belongs to</span>
    <p>Every part of that chain behaved reasonably in isolation. The merge was a merge. The transform, finding
      nothing, returned an empty string rather than throwing — which is defensive programming, and which is exactly
      what destroyed the evidence. The error surfaced three nodes downstream as something that looked completely
      unrelated.</p>
    <p><b>Failing softly moves the error away from its cause.</b> That is usually the wrong trade in a pipeline, and
      it is why the detection now happens statically, before a run starts, rather than being left to the runtime to
      notice.</p>
  </div>

  <h2 class="pe-h2">A doctor with a limit</h2>
  <p class="pe-prose" style="max-width:82ch">
    Something has to look at the failures nobody read. A nightly pass reads the day's failed runs and classifies
    them — a configuration fault, a wiring fault, or the outside world being unreachable.
  </p>
  <div class="ds-grid">
    {#each DOCTOR as d}
      <div class="ds-card compact"><h3>{d.k}</h3><p class="ds-body">{d.why}</p></div>
    {/each}
  </div>

  <a class="pe-next" href="/projects/engine-room/building">Next — the builder, and the engine that improves itself →</a>
</section>

<style>
  .cats { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin: 14px 0; }
  .cat { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 11px 13px; }
  .cat b { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .cat p { margin: 5px 0 0; font-size: 12.5px; line-height: 1.52; color: rgba(28,22,17,0.7); }

  .grid5 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 9px; margin: 14px 0; }
  .cell { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
  .ce-k { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.11em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .cell b { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: var(--accent); }
  .ce-w { font-size: 11.5px; line-height: 1.48; color: rgba(28,22,17,0.65); margin-top: 3px; }
</style>
