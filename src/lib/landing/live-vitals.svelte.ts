// live-vitals.svelte.ts — the landing page's one poll of /api/landing/vitals.
//
// Lifted out of the old vitals rail so the capability monitor and the grid
// below it read the same payload instead of polling twice. The cadence rule is
// unchanged: live work (a JKAI job or an active build) earns a 15s poll, an idle
// site a 60s one, and a hidden tab none at all.

export interface LandingVitals {
  jkai: { activeJobs: number };
  builder: {
    stage: string;
    active: boolean;
    shippedCount: number;
    lastShippedTitle: string | null;
    lastShippedHref: string | null;
  };
  canvas: { count: number; lastRunAt: string | null };
  daydream?: { lastRunAt: string | null; nextRunAt: string | null; paused: boolean };
  generatedAt: string;
}

export class LiveVitals {
  v = $state<LandingVitals | null>(null);
  /** Wall clock for relative strings ("ran 4m ago"), re-ticked without a fetch. */
  now = $state(Date.now());

  /** Starts polling. Returns the teardown, so it can be handed straight back from onMount. */
  start(): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const live = () => !!(this.v?.jkai.activeJobs || this.v?.builder.active);
    const schedule = () => {
      if (stopped || document.hidden) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, live() ? 15_000 : 60_000);
    };
    const poll = async () => {
      try {
        const r = await fetch('/api/landing/vitals');
        if (r.ok) this.v = await r.json();
      } catch {
        /* keep last-known; the landing page never errors on a reading */
      } finally {
        schedule();
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        void poll();
      }
    };

    void poll();
    document.addEventListener('visibilitychange', onVisibility);
    const tick = setInterval(() => (this.now = Date.now()), 30_000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(tick);
    };
  }
}

/** "just now", "4m ago", "3h ago", "2d ago". Empty for a missing or unparseable time. */
export function ago(iso: string | null | undefined, ref: number): string {
  if (!iso) return '';
  const secs = Math.round((ref - Date.parse(iso)) / 1000);
  if (!Number.isFinite(secs)) return '';
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** "in 12m", "in 2h", "due now". Empty for a missing time. */
export function until(iso: string | null | undefined, ref: number): string {
  if (!iso) return '';
  const secs = Math.round((Date.parse(iso) - ref) / 1000);
  if (!Number.isFinite(secs)) return '';
  if (secs < 60) return 'due now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `in ${mins}m`;
  return `in ${Math.round(mins / 60)}h`;
}
