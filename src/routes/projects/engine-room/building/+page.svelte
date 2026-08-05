<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import VerifyGate from './components/VerifyGate.svelte';
  import { PHASES, BUILDER_FACTS, NIGHT_CAPS } from '../lib/building';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let ph = $state(3);
</script>

<svelte:head>
  <title>Building — the builder and the night shift · The Engine Room</title>
  <meta name="description" content="An agent that writes and publishes whole applications, and a nightly engine that reads its own failures and writes its own improvements — with the gate that decides what it may install by itself." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 8 · Building"
    title="The night shift"
    thesis="Two systems write code here. One builds applications on request, in a container, iterating against real failures until they run. The other runs at half past three every morning with nobody watching: it reads how the day went, decides what is missing, writes the missing thing, and then tries very hard to reject its own work. The interesting engineering is entirely in that last part."
    thesisEli5="Two parts of this system write their own software. One builds apps when asked. The other wakes up at 3:30am, looks at what went wrong yesterday, and writes improvements — but it is only allowed to install the small, safe ones, and it has to get them past a strict check first."
    asks={[
      'What can a machine safely be allowed to change about itself, unsupervised?',
      'What stands between text a language model wrote and a running process?',
      'How does a system avoid making the same mistake every night for a week?',
    ]}
  />

  <h2 class="pe-h2">The builder</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      Ask it for an app and it writes one, runs it, looks at what broke, and tries again — over and over — until it
      works. Then it publishes it. The important detail is where all that code runs: inside a sealed container, never
      on the machine itself.
    {:else}
      A build is a loop, not a generation. The agent writes files, executes them, reads the actual failure, and
      revises — which is why it converges rather than producing plausible code that has never run. Everything it
      writes executes inside a sandbox container.
    {/if}
  </p>

  <div class="facts">
    {#each BUILDER_FACTS as f}
      <div class="f">
        <span class="f-k">{f.k}</span>
        <b class="f-v">{f.v}</b>
        <span class="f-why">{f.why}</span>
      </div>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">Why the container is the whole argument</span>
    <p>A prompt asking a model not to do something is a request. A container that cannot reach the host is a
      <b>boundary</b>. Every serious guarantee in this system is of the second kind — the same reasoning appears
      again in the scan below, in the destructive-operation gate, and in the deploy pipeline that physically cannot
      run when its own tests are red.</p>
  </div>

  <h2 class="pe-h2">One night, eight phases</h2>
  <p class="pe-prose" style="max-width:82ch">
    Every phase is caught independently: one failing phase marks the night <i>partial</i> rather than aborting it. If
    someone is still using the system when the run is due, it skips entirely and says so — an improvement engine that
    rewrites tools underneath an active user is not an improvement.
  </p>

  <div class="phases">
    {#each PHASES as p, i}
      <button class="ph" class:on={ph === i} onclick={() => (ph = i)}>
        <span class="p-n">{i + 1}</span>
        <span class="p-name">{p.name}</span>
      </button>
    {/each}
  </div>
  <div class="phase-detail">
    <span class="pd-lab">{PHASES[ph].name}</span>
    <p>{eli ? PHASES[ph].eli5 : PHASES[ph].what}</p>
    {#if PHASES[ph].note}<p class="pd-note">▸ {PHASES[ph].note}</p>{/if}
  </div>

  <h2 class="pe-h2">The gate</h2>
  <p class="pe-prose" style="max-width:82ch">
    Tools the engine builds are <b>registered live</b> — no restart, no deployment, no human approval. That is only
    defensible because of what a candidate has to survive first. Handlers are compiled in full runtime scope, so this
    scan is not one layer of defence among several; it is the layer.
  </p>

  <VerifyGate />

  <div class="er-lesson">
    <span class="el-lab">A constraint that reached back into the prompt</span>
    <p>Because <b>every</b> smoke case must pass, a negative test case — an empty string, a missing record, a
      deliberately malformed input — would fail the gate by succeeding at being a negative test. So the instruction
      to the model that authors these tools says, in capital letters, to supply <b>only happy-path cases</b>.</p>
    <p>That is an odd thing to have to write, and it is honest about the trade: this gate proves a tool works, not
      that it fails gracefully. Worth noticing how a rule in one file propagated into the wording of a prompt in
      another — the sort of coupling that is invisible until you go looking for why a prompt says something strange.</p>
  </div>

  <h2 class="pe-h2">What a night is allowed to spend</h2>
  <p class="pe-prose" style="max-width:82ch">
    Autonomy here is bounded by arithmetic rather than by judgement. The whole nightly run — reading the day,
    deciding what to build, writing it, testing it, repairing what is broken and writing it up — happens under these
    ceilings.
  </p>
  <div class="caps">
    {#each NIGHT_CAPS as c}
      <div class="cap"><b>{c.v}</b><span class="cap-k">{c.k}</span><span class="cap-w">{c.why}</span></div>
    {/each}
  </div>

  <div class="ds-grid two">
    <div class="ds-card">
      <span class="ds-kicker">Memory between nights</span>
      <h3>Yesterday's failure is tomorrow's prompt</h3>
      <p class="ds-body">Ideas persist in a backlog with an attempt count and the text of the last failure. That
        failure text is fed back into the next night's authoring call. Without it the engine cheerfully reattempts the
        same broken approach indefinitely, because each night begins with no knowledge of the last — and it would
        look busy the entire time.</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">Repair</span>
      <h3>Only if it strictly beats the incumbent</h3>
      <p class="ds-body">Tools with high error rates get re-authored. The rewrite is swapped in <b>only</b> if it
        strictly beats the existing one on identical smoke cases; a tie leaves the incumbent in place. Without a
        strict comparison the system happily churns working code for the appearance of progress, and every night
        looks productive while nothing improves.</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">Propose</span>
      <h3>It writes the code. It does not decide.</h3>
      <p class="ds-body">Ideas too large to be a single tool become <b>draft</b> pull requests with the code already
        written. This module has no merge call and cannot acquire one — an explicit decision written at the top of
        the file. The draft says plainly that nothing in it has been run, because the engine cannot run the test
        suite. Whether such a change can ever land without a human is a separate decision, made in the pipeline, by
        classifying what the change <a href="/projects/engine-room/shipping">actually touches</a>.</p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">Order matters</span>
      <h3>Cheaper before newer</h3>
      <p class="ds-body">Reducing the number of model calls an answer costs runs <b>before</b> anything that adds new
        capability, because a saving compounds across every future turn while a new tool only pays when it is used.
        Repair runs after build so that a night which ships nothing new still has something to show for itself —
        which is a small point about morale, and morale matters when the reader is you at breakfast.</p>
    </div>
  </div>

  <a class="pe-next" href="/projects/engine-room/shipping">Next — how any of this reaches production →</a>
</section>

<style>
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin: 14px 0; }
  .f { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; }
  .f-k { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.11em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .f-v { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .f-why { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); margin-top: 3px; }

  .phases { display: flex; gap: 5px; flex-wrap: wrap; margin: 14px 0 0; }
  .ph { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; border: 1px solid rgba(28,22,17,0.2);
    border-radius: var(--radius-round); background: rgba(255,255,255,0.55); padding: 7px 13px; transition: background 0.12s, border-color 0.12s; }
  .ph:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .ph.on { background: var(--accent-ink); border-color: var(--accent-ink); }
  .p-n { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--accent); font-weight: 600; }
  .p-name { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .ph.on .p-n { color: #ffd9b8; }
  .ph.on .p-name { color: #fff; }

  .phase-detail { margin-top: 9px; border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-12);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 10px 14px; }
  .pd-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .phase-detail p { margin: 4px 0 0; font-size: 13.5px; line-height: 1.58; color: rgba(28,22,17,0.78); max-width: 88ch; }
  .pd-note { font-family: 'JetBrains Mono', monospace; font-size: 11px !important; color: var(--accent) !important; margin-top: 7px !important; }

  .caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 9px; margin: 14px 0; }
  .cap { border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 11px 13px; display: flex; flex-direction: column; gap: 2px; }
  .cap b { font-family: 'JetBrains Mono', monospace; font-size: 19px; font-weight: 600; color: var(--accent); line-height: 1.05; }
  .cap-k { font-size: 12.5px; color: var(--text-primary); }
  .cap-w { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.6); margin-top: 3px; }
</style>
