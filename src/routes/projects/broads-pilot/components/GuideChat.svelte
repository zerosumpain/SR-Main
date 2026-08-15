<script lang="ts">
  // The AI day-planner concierge — a thin view over the persistent `guide` store
  // so closing/reopening (or an accidental click-away) never loses the
  // conversation or an in-flight plan. A short guided Q&A (≤3 questions), then it
  // calls /api/broads-pilot/guide and renders an interactive plan; free-text
  // follow-ups revise it.
  import { app } from '../lib/appState.svelte';
  import { guide, TRIP_OPTIONS, ACTIVITY_OPTIONS } from '../lib/guide.svelte';
  import GuidePlan from './GuidePlan.svelte';

  let { onClose, onApply }: { onClose: () => void; onApply: (stopNodeIds: string[]) => void } = $props();

  function apply() {
    if (!guide.plan) return;
    onApply(guide.plan.stops.map((s) => s.nodeId));
  }

  // while the planner is open showing a finished plan, it's been seen — clear the
  // FAB "ready" dot.
  $effect(() => { if (guide.phase === 'done' && guide.plan) guide.markSeen(); });
</script>

<!-- backdrop no longer closes on click — only the ✕ does, so an accidental tap
     outside can't dismiss the planner mid-plan -->
<div class="guide-backdrop" role="presentation">
  <div class="guide" role="dialog" aria-label="AI day planner">
    <header class="guide-head">
      <span class="kicker">AI day planner</span>
      <h2>Plan my day on the Broads</h2>
      <div class="head-actions">
        {#if guide.active}
          <button class="head-btn" onclick={() => guide.reset()} aria-label="Start over">↺ Start over</button>
        {/if}
        <button class="close" onclick={onClose} aria-label="Close">✕</button>
      </div>
    </header>

    <div class="guide-body">
      <p class="bubble bot">Hi! I'll plan a day for your <strong>{app.boat?.name ?? 'boat'}</strong> from <strong>{app.origin?.label ?? 'your start'}</strong>. A couple of quick questions…</p>

      <p class="bubble bot">How long is your trip?</p>
      {#each guide.log as m}<p class="bubble {m.role}">{m.text}</p>{/each}

      {#if guide.phase === 'duration'}
        <div class="chips">
          {#each TRIP_OPTIONS as t}<button class="chip" onclick={() => guide.pickTrip(t.days, t.label)}>{t.label}</button>{/each}
        </div>
      {:else if guide.phase === 'activities'}
        <p class="bubble bot">What are you in the mood for? Pick any — or none for a relaxed cruise.</p>
        <div class="chips">
          {#each ACTIVITY_OPTIONS as a}<button class="chip" class:on={guide.activities.includes(a.value)} onclick={() => guide.toggleActivity(a.value)} aria-pressed={guide.activities.includes(a.value)}>{a.label}</button>{/each}
        </div>
        <button class="next" onclick={() => guide.activitiesDone()}>Next →</button>
      {:else if guide.phase === 'free'}
        <p class="bubble bot">Anything specific? e.g. "best spot for fishing", "somewhere with a playground", "quiet moorings". Or skip.</p>
        <div class="free-row">
          <input class="free" bind:value={guide.freeText} placeholder="Type anything (optional)…" onkeydown={(e) => e.key === 'Enter' && guide.freeDone()} />
          <button class="next" onclick={() => guide.freeDone()}>Plan it</button>
          <button class="skip" onclick={() => guide.freeDone(true)}>Skip</button>
        </div>
      {:else if guide.phase === 'planning'}
        <p class="bubble bot planning"><span class="dots"><span></span><span></span><span></span></span> Charting the best day for you… <span class="planning-note">(you can keep using the map — this stays as you left it)</span></p>
      {:else if guide.phase === 'done'}
        {#if guide.error}
          <p class="bubble bot err">{guide.error}</p>
          <button class="next" onclick={() => guide.requestPlan()}>Try again</button>
        {:else if guide.plan}
          <div class="bubble bot plan-bubble"><GuidePlan plan={guide.plan} onApply={apply} /></div>
          <div class="free-row followup">
            <input class="free" bind:value={guide.followUp} placeholder="Change anything? e.g. only 2 hrs, add a swim…" onkeydown={(e) => e.key === 'Enter' && guide.sendFollowUp()} />
            <button class="next" onclick={() => guide.sendFollowUp()}>Send</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .guide-backdrop { position: absolute; inset: 0; z-index: 1000; background: rgba(26, 16, 8, 0.42); display: grid; place-items: center; padding: 0.6rem; }
  .guide { width: min(54rem, 96vw); max-height: calc(100dvh - 1.2rem); display: flex; flex-direction: column; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: var(--radius-sharp); overflow: hidden; }
  .guide-head { position: relative; padding: 0.9rem 1rem 0.7rem; border-bottom: 1px solid var(--card-border); }
  .kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: var(--fs-label-xs); color: var(--accent); }
  .guide-head h2 { margin: 0.15rem 0 0; font-family: var(--font-display); text-transform: uppercase; font-size: 1.05rem; color: var(--text-primary); }
  .head-actions { position: absolute; top: 0.6rem; right: 0.7rem; display: flex; align-items: center; gap: 0.4rem; }
  .head-btn { background: transparent; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; padding: 0.35rem 0.55rem; min-height: 36px; }
  .head-btn:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .close { background: transparent; border: none; color: var(--text-muted); font-size: 1.1rem; cursor: pointer; padding: 0.3rem; min-height: 36px; min-width: 36px; }
  .close:hover { color: var(--text-primary); }

  .guide-body { overflow-y: auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.55rem; }
  .bubble { margin: 0; max-width: 90%; padding: 0.55rem 0.75rem; border-radius: var(--radius-sharp); font-family: var(--font-body); font-size: 0.9rem; line-height: 1.45; }
  /* keep the short Q&A bubbles readable even though the modal is wide; the plan uses the full width */
  .bubble:not(.plan-bubble) { max-width: 36rem; }
  .bubble.bot { align-self: flex-start; background: var(--card-bg); color: var(--text-primary); border-bottom-left-radius: 0; }
  .bubble.me { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 0; }
  .bubble.err { background: var(--error-bg); color: var(--error); }
  .plan-bubble { max-width: 100%; width: 100%; background: var(--surface-elevated); border: 1px solid var(--card-border); padding: 0.8rem; }

  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 0.5rem 0.7rem; border-radius: var(--radius-sharp); min-height: 40px; cursor: pointer; background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-secondary); }
  .chip:hover { border-color: var(--accent); color: var(--text-primary); }
  .chip.on { background: color-mix(in srgb, var(--accent) 16%, var(--surface-elevated)); border-color: var(--accent); color: var(--text-primary); }
  .next { align-self: flex-start; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sharp); padding: 0.55rem 0.9rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; min-height: 40px; }
  .skip { background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); border-radius: var(--radius-sharp); padding: 0.55rem 0.7rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; min-height: 40px; }
  .free-row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .free-row.followup { position: sticky; bottom: 0; background: var(--surface-elevated); padding-top: 0.3rem; }
  .free { flex: 1 1 10rem; min-height: 40px; font-family: var(--font-body); font-size: 0.85rem; padding: 0.5rem 0.6rem; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); background: var(--bg); color: var(--text-primary); }
  .free:focus { outline: none; border-color: var(--accent); }

  .planning { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--text-secondary); flex-wrap: wrap; }
  .planning-note { font-size: 0.78rem; color: var(--text-muted); }
  .dots { display: inline-flex; gap: 3px; }
  .dots span { width: 6px; height: 6px; border-radius: var(--radius-pill); background: var(--accent); animation: gc-bounce 1.2s infinite ease-in-out; }
  .dots span:nth-child(2) { animation-delay: 0.15s; }
  .dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes gc-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .dots span { animation: none; } }
</style>
