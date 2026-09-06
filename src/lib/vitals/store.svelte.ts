import { VITALS_DEFAULTS, POLL_INTERVAL, LERP_DURATION, type VitalsState } from './state';
import { interpolateVitalsState, easeOut } from './interpolate';

export function createVitalsStore() {
  let state = $state<VitalsState>({ ...VITALS_DEFAULTS });
  let targetState = $state<VitalsState>({ ...VITALS_DEFAULTS });
  let previousState = $state<VitalsState>({ ...VITALS_DEFAULTS });
  let lerpStart = $state(0);
  let isLerping = $state(false);
  let animationFrame: number | undefined;
  let stateFetchGeneration = 0;

  function setState(newState: VitalsState) {
    previousState = { ...state };
    targetState = newState;
    lerpStart = performance.now();
    isLerping = true;
    startAnimation();
  }

  function tick() {
    if (!isLerping) return;
    const elapsed = performance.now() - lerpStart;
    const rawT = Math.min(1, elapsed / LERP_DURATION);
    const easedT = easeOut(rawT);
    state = interpolateVitalsState(previousState, targetState, easedT);
    if (rawT >= 1) {
      isLerping = false;
    }
  }

  /**
   * Interpolation is a five-second transition, not a site-wide animation.
   * Schedule frames only while a transition is active instead of asking every
   * open page to call tick() for its entire lifetime.
   */
  function animate() {
    animationFrame = undefined;
    // Browsers throttle hidden-tab frames rather than eliminating them. Stop
    // the chain completely; the visibility handler resumes it on return.
    if (typeof document !== 'undefined' && document.hidden) return;
    tick();
    if (isLerping) animationFrame = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (
      typeof requestAnimationFrame === 'undefined' ||
      animationFrame !== undefined ||
      (typeof document !== 'undefined' && document.hidden)
    ) return;
    animationFrame = requestAnimationFrame(animate);
  }

  async function fetchState() {
    const generation = ++stateFetchGeneration;
    try {
      const res = await fetch('/api/vitals/state');
      if (!res.ok) return;
      const data: VitalsState = await res.json();
      // An in-flight request can outlive the layout that started it. Do not let
      // its late response restart interpolation after the store was stopped.
      if (generation !== stateFetchGeneration) return;
      setState(data);
    } catch {
      // Silently fail — keep current state
    }
  }

  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let visibilityHandler: (() => void) | undefined;
  let pollingActive = false;

  function scheduleStatePoll() {
    if (!pollingActive) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      pollTimer = undefined;
      if (typeof document === 'undefined' || !document.hidden) await fetchState();
      if (pollingActive) scheduleStatePoll();
    }, POLL_INTERVAL);
  }

  function startPolling() {
    if (pollingActive) return;
    pollingActive = true;
    void fetchState();
    scheduleStatePoll();

    // A hidden tab does not need a private copy of the same public reading.
    // Refresh once when it returns, then resume the normal fifteen-minute
    // cadence.
    if (typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (document.hidden) {
          if (animationFrame !== undefined && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(animationFrame);
          }
          animationFrame = undefined;
          return;
        }
        startAnimation();
        void fetchState();
        scheduleStatePoll();
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    }
  }

  function stopPolling() {
    pollingActive = false;
    stateFetchGeneration += 1;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
    if (visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler);
    }
    visibilityHandler = undefined;
    if (animationFrame !== undefined && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(animationFrame);
    }
    animationFrame = undefined;
  }

  return {
    get state() { return state; },
    get targetState() { return targetState; },
    get isLerping() { return isLerping; },
    setState,
    tick,
    startPolling,
    stopPolling,
    fetchState,
  };
}

export type VitalsStore = ReturnType<typeof createVitalsStore>;
