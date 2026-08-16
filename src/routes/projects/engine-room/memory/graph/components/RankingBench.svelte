<script lang="ts">
  // RankingBench — three ways to rank the most connected entities, judged on speed AND on
  // fidelity in the same frame.
  //
  // The whole point of the finding is that those two axes disagree: the fastest option is the
  // only one that answers differently. A pair of separate charts would let a reader take the
  // speed win and walk away, so the answer panel is wired to the same selection as the bars —
  // you cannot pick the quick one without watching eight of the fifty light up.
  //
  // The scale toggle exists because at true scale (0–40s) the two fast runs are slivers, which
  // is the first beat of the story; the close-up (0–2s) is the second, where you see that
  // giving up precision buys about a second and a half.
  import { APPROACHES, TOP_N } from '../data';

  let picked = $state('relaid');
  let zoom = $state(false);

  const sel = $derived(APPROACHES.find((a) => a.id === picked) ?? APPROACHES[1]);
  const max = $derived(zoom ? 2 : 40);
  // Floored at 0.6% so the quarter-second run is still a mark at true scale rather than
  // nothing at all — the same floor the shared Bars primitive uses.
  const pct = (s: number) => Math.min(100, Math.max((s / max) * 100, 0.6));

  const cells = Array.from({ length: TOP_N }, (_, i) => i);
  // Contiguous fill from the end: a count encoding, not a claim about which ranks moved. The
  // cells carry no rank labels for exactly that reason — the source records how many of the
  // top fifty changed place, never which of them.
  const from = $derived(TOP_N - sel.moved);

  const secs = (s: number) => `${s} s`;
</script>

<div class="rb">
  <div class="band-head">
    <span class="band-lab">Time to compute</span>
    <div class="scale" role="group" aria-label="Chart scale">
      <button type="button" class:on={!zoom} aria-pressed={!zoom} onclick={() => (zoom = false)}>0–40 s</button>
      <button type="button" class:on={zoom} aria-pressed={zoom} onclick={() => (zoom = true)}>0–2 s</button>
    </div>
  </div>

  <div class="rows" role="group" aria-label="Three approaches, selectable">
    {#each APPROACHES as a (a.id)}
      <button
        type="button"
        class="row"
        class:on={picked === a.id}
        data-state={a.state}
        aria-pressed={picked === a.id}
        onclick={() => (picked = a.id)}
        title={a.how}
      >
        <span class="r-lab">{a.label}</span>
        <span class="r-track">
          <span class="r-fill" style="width:{pct(a.secs)}%"></span>
          {#if a.secs > max}<span class="r-over" aria-hidden="true">▸</span>{/if}
          <span class="r-val">{secs(a.secs)}</span>
        </span>
        <span class="r-verdict">{a.verdict}</span>
      </button>
    {/each}
  </div>

  <div class="answer">
    <span class="band-lab">The answer it gives · top {TOP_N}</span>

    <div
      class="waffle"
      role="img"
      aria-label={sel.moved === 0
        ? `${TOP_N} cells, none marked. ${sel.label}: the exact ranking, identical bit for bit.`
        : `${TOP_N} cells, ${sel.moved} marked. ${sel.label}: ${sel.moved} of the top ${TOP_N} changed place, rank correlation ${sel.corr}. The marks count how many moved, not which.`}
    >
      {#each cells as i (i)}
        <span class="cell" class:moved={i >= from}></span>
      {/each}
    </div>

    <p class="read" aria-live="polite">
      {#if sel.moved === 0}
        <b>Identical, bit for bit</b> — nothing in the top {TOP_N} moved.
      {:else}
        <b>{sel.moved} of the top {TOP_N} moved</b> — rank correlation {sel.corr}.
      {/if}
    </p>
  </div>
</div>

<style>
  /* No frame of its own — the Instrument wrapper supplies it. */
  .rb { display: flex; flex-direction: column; gap: 13px; min-width: 0; }

  .band-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px 14px; flex-wrap: wrap; }
  .band-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }

  .scale { display: flex; gap: 4px; margin-left: auto; }
  .scale button { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em;
    color: rgba(28,22,17,0.65); background: rgba(255,255,255,0.6);
    border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-pill);
    padding: 3px 10px; cursor: pointer; }
  .scale button:hover { border-color: rgba(28,22,17,0.4); color: var(--text-primary); }
  .scale button.on { background: var(--accent); border-color: var(--accent); color: #fff; }

  .rows { display: flex; flex-direction: column; gap: 5px; }
  .row { display: grid; grid-template-columns: minmax(0, 16ch) minmax(0, 1fr) minmax(0, 18ch);
    gap: 4px 11px; align-items: center; width: 100%; text-align: left; font-family: inherit;
    padding: 7px 11px; cursor: pointer; background: rgba(255,255,255,0.5);
    border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp);
    transition: background 0.13s, border-color 0.13s; }
  .row:hover { background: rgba(255,255,255,0.85); border-color: rgba(28,22,17,0.36); }
  .row.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .row[data-state='rejected'].on { border-color: var(--error); background: color-mix(in srgb, var(--error) 8%, transparent); }

  .r-lab { font-size: var(--fs-label); line-height: 1.3; color: var(--text-primary); min-width: 0;
    overflow: hidden; text-overflow: ellipsis; }

  .r-track { position: relative; display: flex; align-items: center; height: 22px; min-width: 0;
    background: rgba(28,22,17,0.06); border-radius: var(--radius-sharp); overflow: hidden; }
  .r-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); opacity: 0.5;
    border-radius: var(--radius-sharp); transition: width 0.4s cubic-bezier(0.3,0,0.2,1); }
  .row.on .r-fill { opacity: 0.85; }
  .row[data-state='rejected'] .r-fill { background: var(--error); }
  .row[data-state='past'] .r-fill { background: rgba(28,22,17,0.45); }
  .r-over { position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    font-size: var(--fs-label-xs); color: rgba(255,255,255,0.9); }
  .r-val { position: relative; z-index: 1; margin-left: 9px; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); font-weight: 500; color: var(--text-primary); white-space: nowrap;
    text-shadow: 0 0 4px rgba(255,255,255,0.85), 0 0 4px rgba(255,255,255,0.85); }

  .r-verdict { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em;
    text-transform: uppercase; line-height: 1.35; color: rgba(28,22,17,0.62); text-align: right; min-width: 0; }
  .row[data-state='shipped'] .r-verdict { color: var(--accent); }
  .row[data-state='rejected'] .r-verdict { color: var(--error); }

  .answer { display: flex; flex-direction: column; gap: 7px; padding-top: 11px;
    border-top: 1px dashed rgba(28,22,17,0.18); }
  .waffle { display: grid; grid-template-columns: repeat(10, 1fr); gap: 3px; max-width: 300px; }
  .cell { aspect-ratio: 1; border-radius: 2px; background: rgba(28,22,17,0.1);
    border: 1px solid transparent; transition: background 0.25s, border-color 0.25s; }
  .cell.moved { background: color-mix(in srgb, var(--error) 55%, transparent);
    border-color: var(--error); }

  .read { margin: 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.72); }
  .read b { color: var(--text-primary); }

  @media (max-width: 620px) {
    .row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; }
    .r-lab { grid-column: 1; grid-row: 1; }
    .r-verdict { grid-column: 2; grid-row: 1; }
    .r-track { grid-column: 1 / -1; grid-row: 2; }
  }
</style>
