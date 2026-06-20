// Persistent state for the AI day-planner ("Plan my day"). Lives in a module
// singleton — NOT inside GuideChat.svelte — so closing the modal (or an accidental
// click-away) never loses the conversation or an in-flight plan: the request keeps
// running in the background and reopening resumes exactly where you left off.
import { app } from './appState.svelte';
import type { Plan } from './guide-types';

export type GuidePhase = 'duration' | 'activities' | 'free' | 'planning' | 'done';
export interface GuideMsg { role: 'bot' | 'me'; text: string }

export const TRIP_OPTIONS = [
  { label: 'Just today', days: 1 }, { label: 'A weekend · 2 days', days: 2 },
  { label: 'A few days · 3–4', days: 4 }, { label: 'A full week · 7 days', days: 7 },
] as const;
export const ACTIVITY_OPTIONS = [
  { label: '🐾 Dog walk', value: 'dog_walk' }, { label: '🍺 Pub lunch', value: 'pub' }, { label: '🎣 Fishing', value: 'fishing' },
  { label: '🏊 Swimming', value: 'swim' }, { label: '🛒 Supermarket', value: 'supermarket' }, { label: '🦢 Wildlife & quiet', value: 'wildlife' }, { label: '📷 Sightseeing', value: 'sights' },
] as const;

class GuideState {
  phase = $state<GuidePhase>('duration');
  days = $state(1);
  tripLabel = $state('');
  activities = $state<string[]>([]);
  freeText = $state('');
  followUp = $state('');
  // the last revision text sent, so an argument-less "Try again" re-attempts the
  // SAME follow-up rather than silently falling back to a base plan.
  lastFollowUp = $state<string | null>(null);
  plan = $state<Plan | null>(null);
  error = $state<string | null>(null);
  log = $state<GuideMsg[]>([]);
  // a plan finished while the modal was closed — drives the FAB "ready" dot until
  // the user next opens the planner.
  unseenPlan = $state(false);

  // bumped on every reset/new request so a late-resolving fetch from a previous
  // run can't clobber fresh state.
  private reqId = 0;

  /** true once the user has begun the Q&A — i.e. there's a session worth resuming. */
  get active() { return this.phase !== 'duration' || this.log.length > 0; }
  get planning() { return this.phase === 'planning'; }

  pickTrip(days: number, label: string) {
    this.days = days; this.tripLabel = label;
    this.log = [...this.log, { role: 'me', text: label }];
    this.phase = 'activities';
  }
  toggleActivity(v: string) {
    this.activities = this.activities.includes(v) ? this.activities.filter((a) => a !== v) : [...this.activities, v];
  }
  activitiesDone() {
    const labels = ACTIVITY_OPTIONS.filter((a) => this.activities.includes(a.value)).map((a) => a.label).join(', ');
    this.log = [...this.log, { role: 'me', text: labels || 'A relaxed cruise' }];
    this.phase = 'free';
  }
  freeDone(skip = false) {
    if (!skip && this.freeText.trim()) this.log = [...this.log, { role: 'me', text: this.freeText.trim() }];
    this.lastFollowUp = null; // this is the base plan; a retry here stays base
    this.requestPlan();
  }
  sendFollowUp() {
    const t = this.followUp.trim();
    if (!t) return;
    this.log = [...this.log, { role: 'me', text: t }];
    this.followUp = '';
    this.lastFollowUp = t; // remember so "Try again" re-sends this revision
    this.requestPlan(t);
  }

  async requestPlan(followUpText?: string) {
    // default to the remembered follow-up so an argument-less retry re-attempts
    // the same revision (with previousPlan), not a fresh base plan.
    const fu = followUpText ?? this.lastFollowUp ?? undefined;
    const myReq = ++this.reqId;
    this.phase = 'planning';
    this.error = null;
    try {
      const res = await fetch('/api/broads-pilot/guide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boat: app.boat?.slug, originNode: app.origin?.nodeId ?? 'staithe-stalham',
          objectives: { days: this.days, activities: this.activities, freeText: this.freeText.trim() },
          followUp: fu, previousPlan: fu ? this.plan : undefined,
        }),
      });
      const data = await res.json();
      if (myReq !== this.reqId) return; // superseded by a reset / newer request
      if (data.error) { this.error = data.error; } else { this.plan = data.plan; this.unseenPlan = true; }
    } catch {
      if (myReq !== this.reqId) return;
      this.error = 'Could not reach the planner — check your connection and try again.';
    }
    if (myReq === this.reqId) this.phase = 'done';
  }

  /** Wipe the conversation for a fresh plan (also cancels any in-flight result). */
  reset() {
    this.reqId++;
    this.phase = 'duration';
    this.days = 1; this.tripLabel = '';
    this.activities = [];
    this.freeText = ''; this.followUp = ''; this.lastFollowUp = null;
    this.plan = null; this.error = null;
    this.log = [];
    this.unseenPlan = false;
  }

  /** Mark the current plan as seen (called when the planner is open showing it). */
  markSeen() { this.unseenPlan = false; }
}

export const guide = new GuideState();
