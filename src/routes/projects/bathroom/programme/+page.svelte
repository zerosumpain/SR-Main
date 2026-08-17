<script lang="ts">
  import { JOB_SIZES, LANES, LANE_COLOUR, LANE_LEN } from '../lib/content';
  import { persist, s } from '../lib/state.svelte';

  const lanes = $derived(LANES[s.prog.size]);
  const days = $derived(LANE_LEN[s.prog.size]);
  const cols = $derived(`180px repeat(${days}, minmax(54px, 1fr))`);

  /** Working days only — a start date that lands on a weekend rolls forward. */
  const dates = $derived.by(() => {
    const out: string[] = [];
    if (!s.prog.start) return Array(days).fill('');
    const cur = new Date(s.prog.start + 'T12:00:00');
    for (let i = 0; i < days; i++) {
      while (cur.getDay() === 0 || cur.getDay() === 6) cur.setDate(cur.getDate() + 1);
      out.push(cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  });

  const weeks = $derived(Math.ceil(days / 5));
</script>

<svelte:head>
  <title>Order of play — Bathroom Planner</title>
</svelte:head>

<div class="bth-wrap bth-stack g40">
  <header class="bth-stack g12">
    <span class="bth-eyebrow">06 · Order of play</span>
    <h1 class="bth-h1">The whole thing, in order</h1>
    <p class="bth-lead">
      A bathroom is built in a fixed sequence and each stage has to be dry and correct before the
      next one starts. That's the real reason a bathroom can't be done over a long weekend, and
      it's why a single missing item wrecks a week.
    </p>
  </header>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Before anyone turns up</span>
      <h2 class="bth-h2">The run-up</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-tablewrap">
      <table>
        <thead><tr><th>When</th><th>Stage</th><th>What happens</th></tr></thead>
        <tbody>
          <tr><td class="n">Week −10</td><td><strong>Decide</strong></td><td>Measure, agree the budget, settle the bath question, play with the planner. Half a day, total.</td></tr>
          <tr><td class="n">Week −9 to −7</td><td><strong>Quote</strong></td><td>Three fitters visit, all pricing the same written brief. Allow a week or two for quotes to come back.</td></tr>
          <tr><td class="n">Week −7</td><td><strong>Choose and book</strong></td><td>Pick one, agree the contract and payment stages, pay the deposit, get a date in the diary. Good fitters are 6–12 weeks out.</td></tr>
          <tr><td class="n">Week −6 to −5</td><td><strong>Specify</strong></td><td>Final choices: suite, tiles, brassware, flooring, colours. Every item written down with a model number. Nothing chosen after this point without a written variation.</td></tr>
          <tr><td class="n">Week −5</td><td><strong>Order</strong></td><td>Everything, at once. Lead times below. Get delivery dates in writing and put them in a calendar.</td></tr>
          <tr><td class="n">Week −2</td><td><strong>Take delivery and check</strong></td><td>Unbox everything, count everything, check every item against the spec list. Damaged goods found now are an inconvenience; found on day four they're a fortnight.</td></tr>
          <tr><td class="n">Week −1</td><td><strong>Clear the decks</strong></td><td>Empty the bathroom and the landing, agree parking, agree working hours, sort out where you're washing. Confirm the start date by text.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="bth-grid two">
      <div class="bth-card">
        <h3 class="bth-h3">Lead times to plan around</h3>
        <div class="bth-tablewrap">
          <table>
            <thead><tr><th>Item</th><th>Typical wait</th></tr></thead>
            <tbody>
              <tr><td>Standard suite in stock</td><td class="n">3–7 days</td></tr>
              <tr><td>Tiles from a merchant</td><td class="n">1–3 weeks</td></tr>
              <tr><td>Fitted furniture / vanity units</td><td class="n">3–6 weeks</td></tr>
              <tr><td>Made-to-measure or frameless glass</td><td class="n">2–4 weeks</td></tr>
              <tr><td>Specialist or imported brassware</td><td class="n">2–8 weeks</td></tr>
              <tr><td>A good fitter's next free slot</td><td class="n">6–12 weeks</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="bth-note warn">
        <span class="bth-eyebrow">The single most common way this goes wrong</span>
        <p class="bth-small">
          Everything is ordered except one thing — usually the shower valve, the waste, or a trim.
          It arrives on day six. The tiler has gone to his next job and can't come back for ten
          days. The whole programme slides a fortnight and the fitter can't be blamed for it.
          <strong>One box, one checklist, everything in the house before day one.</strong>
        </p>
      </div>
    </div>
  </section>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">On site</span>
      <h2 class="bth-h2">Day by day</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-row" style="align-items:flex-end; gap:1rem">
      <div class="bth-field" style="max-width:190px">
        <label for="start">Start date</label>
        <input class="bth-input" id="start" type="date" bind:value={s.prog.start} onchange={persist} />
      </div>
      <div class="bth-field" style="max-width:230px">
        <label for="size">Job</label>
        <select class="bth-input" id="size" bind:value={s.prog.size} onchange={persist}>
          {#each JOB_SIZES as j (j.key)}<option value={j.key}>{j.label}</option>{/each}
        </select>
      </div>
      <p class="bth-small bth-muted" style="flex:1 1 240px">
        {days} working days — about {weeks} week{weeks === 1 ? '' : 's'} on site, assuming nothing
        waits on a delivery.
      </p>
    </div>

    <div class="scroller">
      <div class="gantt" style="--cols:{cols}">
        <div class="grow head">
          <div class="glabel">Working day</div>
          {#each dates as d, i (i)}
            <div class="gcell"><span class="d">{i + 1}</span><span class="dt">{d}</span></div>
          {/each}
        </div>
        {#each lanes as [label, trade, a, b] (label)}
          <div class="grow">
            <div class="glabel">
              <span class="dot" style="background:{LANE_COLOUR[trade]}"></span>{label}
            </div>
            {#each Array.from({ length: days }) as _, i (i)}
              {@const on = i + 1 >= a && i + 1 <= b}
              <div class="gcell" style={on ? `background:color-mix(in srgb, ${LANE_COLOUR[trade]} 22%, var(--surface-card))` : ''}></div>
            {/each}
          </div>
        {/each}
      </div>
    </div>

    <div class="bth-grid two">
      <div class="bth-stack g16">
        <h3 class="bth-h3">What's happening, and what you do</h3>
        <dl class="bth-defs">
          <dt>Strip out</dt>
          <dd>Everything comes out, back to brick and joists. This is when surprises appear. <strong>Your job:</strong> be in the house. Look at what's uncovered with the fitter and agree in writing, that day, what any extra work costs.</dd>
          <dt>First fix</dt>
          <dd>Pipes and cables buried in walls and under the floor, waste runs set out with the right fall, shower valve positioned, floor strengthened. <strong>Your job:</strong> stand in the room and check heights — shower valve, rail, towel rail, sockets. Then <strong>photograph every wall</strong> before anything covers it.</dd>
          <dt>Board, tank and plaster</dt>
          <dd>Backer board on the wet walls, tanking if it's a wet room, plaster on the rest, ceiling made good. Then it has to dry. <strong>Your job:</strong> nothing. Resist the urge to hurry the drying.</dd>
          <dt>Tiling</dt>
          <dd>Setting out first — this is the bit that decides whether the room looks right. Then fixing, then grouting a day later. <strong>Your job:</strong> look at the setting-out <em>before</em> he starts sticking. Where do the cuts land? Are they in the corners rather than the middle of the main wall? Say something now, because afterwards is too late.</dd>
          <dt>Second fix</dt>
          <dd>Everything gets connected: suite, taps, shower, rail, lights, fan, door furniture. The room becomes a bathroom in about six hours and it's very exciting. <strong>Your job:</strong> stay out of the way.</dd>
          <dt>Silicone, test and clean</dt>
          <dd>Sealant goes in last and needs 24 hours before it gets wet. Everything gets run, filled, drained and checked. <strong>Your job:</strong> don't use the shower until you're told you can.</dd>
          <dt>Snag and hand over</dt>
          <dd>You walk it properly, list what's wrong, they come back and fix it. <strong>Your job:</strong> the <a href="/projects/bathroom/signoff">snag list</a>. Do it in daylight, with a torch, and don't pay the last 5% until it's clear.</dd>
        </dl>
      </div>
      <div class="bth-stack g16">
        <div class="bth-card">
          <h3 class="bth-h3">Living without a bathroom for a fortnight</h3>
          <p class="bth-small bth-muted">
            This is the bit that makes or breaks how the job feels. Sort it before day one, not on
            day three.
          </p>
          <ul class="bth-ticks">
            <li><strong>Washing.</strong> A gym or leisure centre day pass is the civilised answer — most are cheap and open early. Failing that, a very good friend, a relative, or the understanding neighbour you've just told about the skip.</li>
            <li><strong>The loo.</strong> If there's a downstairs WC you're laughing. If not, ask the fitter to leave the old toilet connected and usable until the last possible day and to reconnect the new one early — most will, if you ask before they start.</li>
            <li><strong>A camping toilet</strong> is about £40 and is a genuinely sensible backstop for the two or three days there's nothing.</li>
            <li><strong>Move the essentials out</strong> now: toothbrushes, towels, medicines, and anything you'd hate to find covered in tile dust. Set up a temporary spot in a bedroom.</li>
            <li><strong>Dust.</strong> Ask for a dust sheet run on the landing and stairs and a zip screen on the bathroom door. It costs them ten minutes and saves you a week of hoovering.</li>
            <li><strong>Agree hours in advance.</strong> 8 to 5 with no radio before nine keeps everyone on speaking terms, including the neighbours through the party wall.</li>
          </ul>
        </div>
        <div class="bth-note good">
          <span class="bth-eyebrow">The five-minute daily habit</span>
          <p class="bth-small">
            Ten minutes at the end of each day: walk the room, take three photos, and write two
            lines in your phone about what got done and anything that was agreed. It takes no time,
            it makes you a better client, and if there's ever a disagreement about what was said on
            day four, you have day four.
          </p>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .scroller { overflow-x: auto; }
  .gantt {
    display: flex;
    flex-direction: column;
    min-width: 720px;
    border-top: 1px solid var(--line-strong);
    border-left: 1px solid var(--line-strong);
  }
  .grow {
    display: grid;
    grid-template-columns: var(--cols);
  }
  .glabel,
  .gcell {
    border-right: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-card);
    min-height: 32px;
    display: flex;
    align-items: center;
    padding: 0.35rem 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    min-width: 0;
  }
  .glabel {
    gap: 0.45rem;
    padding: 0.35rem 0.6rem;
    color: var(--text-primary);
  }
  .glabel .dot { width: 8px; height: 8px; flex: none; border-radius: var(--radius-sharp); }
  .head .gcell {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0;
    background: var(--bg-section);
    line-height: 1.15;
  }
  /* Both lines stay at the 12px floor — the site's accessible minimum. */
  .head .gcell .d { color: var(--text-primary); }
  .head .gcell .dt { color: var(--text-ghost); }
</style>
