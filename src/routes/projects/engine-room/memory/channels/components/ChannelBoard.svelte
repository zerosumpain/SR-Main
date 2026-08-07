<script lang="ts">
  // ChannelBoard — eight doors, compared on the three things that differ.
  //
  // The temptation with a list of sources is a table, and a table invites the reader to
  // conclude they are interchangeable. They are not: what separates them is who authored the
  // words, whether the knowledge arrives on its own or has to be fetched, and what one item
  // costs. So the chips are laid out by GRADE — the axis nobody expects to be the interesting
  // one — and picking one puts those three answers side by side.
  import { CHANNELS, type Channel } from '../../../lib/channels';

  let sel = $state<string>(CHANNELS[0].id);
  const chosen = $derived(CHANNELS.find((c) => c.id === sel) ?? CHANNELS[0]);

  const ARRIVAL: Record<Channel['arrival'], { label: string; mark: string; what: string }> = {
    pushed: { label: 'pushed', mark: '→', what: 'It arrives on its own. Nothing has to remember to ask.' },
    pulled: { label: 'pulled', mark: '↺', what: 'Something has to go and fetch it, on a schedule, and pay for the trip.' },
    derived: { label: 'derived', mark: '⊙', what: 'It is a by-product of work done for another reason.' },
  };

  /** Grades present, best first — the layout axis. */
  const bands = $derived([...new Set(CHANNELS.map((c) => c.grade))]);
  const inBand = (g: string) => CHANNELS.filter((c) => c.grade === g);

  const BAND_NOTE: Record<string, string> = {
    A: 'first-hand',
    B: 'attributable',
    C: 'unattributed',
    F: 'not yet judged',
  };
</script>

<div class="cb">
  <div class="grid">
    {#each bands as g (g)}
      <div class="band">
        <span class="b-head"><b>{g}</b>{BAND_NOTE[g] ?? ''}</span>
        <div class="b-row" role="group" aria-label="Channels graded {g}">
          {#each inBand(g) as c (c.id)}
            <button type="button" class="chip" class:on={sel === c.id} aria-pressed={sel === c.id}
                    onclick={() => (sel = c.id)}>
              <span class="c-mark" aria-hidden="true">{ARRIVAL[c.arrival].mark}</span>{c.label}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="read" aria-live="polite">
    <div class="r-head">
      <b class="r-title">{chosen.label}</b>
      <span class="r-grade">graded {chosen.grade}</span>
    </div>
    <dl class="facts">
      <div><dt>Who wrote it</dt><dd>{chosen.author}</dd></div>
      <div><dt>How it arrives</dt><dd>{ARRIVAL[chosen.arrival].label} — {ARRIVAL[chosen.arrival].what}</dd></div>
      <div><dt>What one item costs</dt><dd>{chosen.cost}</dd></div>
    </dl>
    <p class="why">{chosen.why}</p>
  </div>
</div>

<style>
  .cb { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  .grid { display: flex; flex-direction: column; gap: 8px; }
  .band { display: grid; grid-template-columns: 108px 1fr; gap: 10px; align-items: start; }
  .b-head { display: flex; align-items: baseline; gap: 6px; padding-top: 5px;
    font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .b-head b { font-size: 13px; letter-spacing: 0; color: var(--accent); }
  .b-row { display: flex; gap: 5px; flex-wrap: wrap; }

  .chip { display: inline-flex; align-items: baseline; gap: 6px; font-family: 'DM Sans', sans-serif;
    font-size: 11.5px; color: var(--text-primary); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round);
    padding: 5px 11px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .chip:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .c-mark { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.4); }
  .chip.on .c-mark { color: rgba(255,255,255,0.7); }

  .read { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: rgba(255,255,255,0.55); padding: 11px 14px; min-width: 0; }
  .r-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .r-title { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .r-grade { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--accent); }

  .facts { margin: 0 0 8px; display: grid; gap: 4px; }
  .facts div { display: grid; grid-template-columns: 148px 1fr; gap: 10px; align-items: baseline; }
  .facts dt { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(28,22,17,0.45); }
  .facts dd { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.8); }

  .why { margin: 0; padding-top: 8px; border-top: 1px dashed rgba(28,22,17,0.16);
    font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.72); max-width: 84ch; }

  @media (max-width: 620px) {
    .band { grid-template-columns: 1fr; gap: 4px; }
    .facts div { grid-template-columns: 1fr; gap: 1px; }
  }
</style>
