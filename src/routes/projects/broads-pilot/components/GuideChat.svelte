<script lang="ts">
  // The AI day-planner concierge. A short guided Q&A (≤3 questions, clickable
  // answers + free text), then it calls /api/broads-pilot/guide and renders an
  // interactive plan. After that, free-text follow-ups revise the plan.
  import { app } from '../lib/appState.svelte';
  import GuidePlan from './GuidePlan.svelte';
  import type { Plan } from '../lib/guide-types';

  let { onClose, onApply }: { onClose: () => void; onApply: (stopNodeIds: string[]) => void } = $props();

  const TRIP = [
    { label: 'Just today', days: 1 }, { label: 'A weekend · 2 days', days: 2 },
    { label: 'A few days · 3–4', days: 4 }, { label: 'A full week · 7 days', days: 7 },
  ];
  const ACTIVITIES = [
    { label: '🐾 Dog walk', value: 'dog_walk' }, { label: '🍺 Pub lunch', value: 'pub' }, { label: '🎣 Fishing', value: 'fishing' },
    { label: '🏊 Swimming', value: 'swim' }, { label: '🛒 Supermarket', value: 'supermarket' }, { label: '🦢 Wildlife & quiet', value: 'wildlife' }, { label: '📷 Sightseeing', value: 'sights' },
  ];

  type Phase = 'duration' | 'activities' | 'free' | 'planning' | 'done';
  let phase = $state<Phase>('duration');
  let days = $state(1);
  let tripLabel = $state('');
  let activities = $state<string[]>([]);
  let freeText = $state('');
  let followUp = $state('');
  let plan = $state<Plan | null>(null);
  let error = $state<string | null>(null);
  let log = $state<{ role: 'bot' | 'me'; text: string }[]>([]);

  function pickTrip(t: typeof TRIP[number]) {
    days = t.days; tripLabel = t.label;
    log = [...log, { role: 'me', text: t.label }];
    phase = 'activities';
  }
  function toggleAct(v: string) { activities = activities.includes(v) ? activities.filter((a) => a !== v) : [...activities, v]; }
  function activitiesDone() {
    const labels = ACTIVITIES.filter((a) => activities.includes(a.value)).map((a) => a.label).join(', ');
    log = [...log, { role: 'me', text: labels || 'A relaxed cruise' }];
    phase = 'free';
  }
  function freeDone(skip = false) {
    if (!skip && freeText.trim()) log = [...log, { role: 'me', text: freeText.trim() }];
    requestPlan();
  }

  async function requestPlan(followUpText?: string) {
    phase = 'planning'; error = null;
    try {
      const res = await fetch('/api/broads-pilot/guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boat: app.boat?.slug, originNode: app.origin?.nodeId ?? 'staithe-stalham',
          objectives: { days, activities, freeText: freeText.trim() },
          followUp: followUpText, previousPlan: followUpText ? plan : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) error = data.error; else plan = data.plan;
    } catch {
      error = 'Could not reach the planner — check your connection and try again.';
    }
    phase = 'done';
  }

  function sendFollowUp() {
    const t = followUp.trim();
    if (!t) return;
    log = [...log, { role: 'me', text: t }];
    followUp = '';
    requestPlan(t);
  }

  function apply() {
    if (!plan) return;
    onApply(plan.stops.map((s) => s.nodeId));
  }
</script>

<div class="guide-backdrop" onclick={onClose} role="presentation">
  <div class="guide" role="dialog" aria-label="AI day planner" onclick={(e) => e.stopPropagation()}>
    <header class="guide-head">
      <span class="kicker">AI day planner</span>
      <h2>Plan my day on the Broads</h2>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="guide-body">
      <p class="bubble bot">Hi! I'll plan a day for your <strong>{app.boat?.name ?? 'boat'}</strong> from <strong>{app.origin?.label ?? 'your start'}</strong>. A couple of quick questions…</p>

      <p class="bubble bot">How long is your trip?</p>
      {#each log as m}<p class="bubble {m.role}">{m.text}</p>{/each}

      {#if phase === 'duration'}
        <div class="chips">
          {#each TRIP as t}<button class="chip" onclick={() => pickTrip(t)}>{t.label}</button>{/each}
        </div>
      {:else if phase === 'activities'}
        <p class="bubble bot">What are you in the mood for? Pick any — or none for a relaxed cruise.</p>
        <div class="chips">
          {#each ACTIVITIES as a}<button class="chip" class:on={activities.includes(a.value)} onclick={() => toggleAct(a.value)} aria-pressed={activities.includes(a.value)}>{a.label}</button>{/each}
        </div>
        <button class="next" onclick={activitiesDone}>Next →</button>
      {:else if phase === 'free'}
        <p class="bubble bot">Anything specific? e.g. "best spot for fishing", "somewhere with a playground", "quiet moorings". Or skip.</p>
        <div class="free-row">
          <input class="free" bind:value={freeText} placeholder="Type anything (optional)…" onkeydown={(e) => e.key === 'Enter' && freeDone()} />
          <button class="next" onclick={() => freeDone()}>Plan it</button>
          <button class="skip" onclick={() => freeDone(true)}>Skip</button>
        </div>
      {:else if phase === 'planning'}
        <p class="bubble bot planning"><span class="dots"><span></span><span></span><span></span></span> Charting the best day for you…</p>
      {:else if phase === 'done'}
        {#if error}
          <p class="bubble bot err">{error}</p>
          <button class="next" onclick={() => requestPlan()}>Try again</button>
        {:else if plan}
          <div class="bubble bot plan-bubble"><GuidePlan {plan} onApply={apply} /></div>
          <div class="free-row followup">
            <input class="free" bind:value={followUp} placeholder="Change anything? e.g. only 2 hrs, add a swim…" onkeydown={(e) => e.key === 'Enter' && sendFollowUp()} />
            <button class="next" onclick={sendFollowUp}>Send</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .guide-backdrop { position: absolute; inset: 0; z-index: 1000; background: rgba(26, 16, 8, 0.42); display: grid; place-items: center; padding: 0.6rem; }
  .guide { width: min(54rem, 96vw); max-height: calc(100dvh - 1.2rem); display: flex; flex-direction: column; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.7rem; box-shadow: 0 12px 40px rgba(26, 16, 8, 0.35); overflow: hidden; }
  .guide-head { position: relative; padding: 0.9rem 1rem 0.7rem; border-bottom: 1px solid var(--card-border); }
  .kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.58rem; color: var(--accent); }
  .guide-head h2 { margin: 0.15rem 0 0; font-family: var(--font-display); text-transform: uppercase; font-size: 1.05rem; color: var(--text-primary); }
  .close { position: absolute; top: 0.6rem; right: 0.7rem; background: transparent; border: none; color: var(--text-muted); font-size: 1.1rem; cursor: pointer; padding: 0.3rem; min-height: 36px; min-width: 36px; }
  .close:hover { color: var(--text-primary); }

  .guide-body { overflow-y: auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.55rem; }
  .bubble { margin: 0; max-width: 90%; padding: 0.55rem 0.75rem; border-radius: 0.8rem; font-family: var(--font-body); font-size: 0.9rem; line-height: 1.45; }
  /* keep the short Q&A bubbles readable even though the modal is wide; the plan uses the full width */
  .bubble:not(.plan-bubble) { max-width: 36rem; }
  .bubble.bot { align-self: flex-start; background: var(--card-bg); color: var(--text-primary); border-bottom-left-radius: 0.2rem; }
  .bubble.me { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 0.2rem; }
  .bubble.err { background: rgba(198, 40, 40, 0.1); color: #a02020; }
  .plan-bubble { max-width: 100%; width: 100%; background: var(--surface-elevated); border: 1px solid var(--card-border); padding: 0.8rem; }

  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { font-family: var(--font-mono); font-size: 0.74rem; padding: 0.5rem 0.7rem; border-radius: 0.4rem; min-height: 40px; cursor: pointer; background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-secondary); }
  .chip:hover { border-color: var(--accent); color: var(--text-primary); }
  .chip.on { background: color-mix(in srgb, var(--accent) 16%, var(--surface-elevated)); border-color: var(--accent); color: var(--text-primary); }
  .next { align-self: flex-start; background: var(--accent); color: #fff; border: none; border-radius: 0.4rem; padding: 0.55rem 0.9rem; font-family: var(--font-mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; min-height: 40px; }
  .skip { background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); border-radius: 0.4rem; padding: 0.55rem 0.7rem; font-family: var(--font-mono); font-size: 0.7rem; cursor: pointer; min-height: 40px; }
  .free-row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .free-row.followup { position: sticky; bottom: 0; background: var(--surface-elevated); padding-top: 0.3rem; }
  .free { flex: 1 1 10rem; min-height: 40px; font-family: var(--font-body); font-size: 0.85rem; padding: 0.5rem 0.6rem; border: 1px solid var(--card-border); border-radius: 0.4rem; background: var(--bg); color: var(--text-primary); }
  .free:focus { outline: none; border-color: var(--accent); }

  .planning { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--text-secondary); }
  .dots { display: inline-flex; gap: 3px; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: gc-bounce 1.2s infinite ease-in-out; }
  .dots span:nth-child(2) { animation-delay: 0.15s; }
  .dots span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes gc-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .dots span { animation: none; } }
</style>
