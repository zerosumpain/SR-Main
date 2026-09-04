import { BIOME_DEFAULTS, POLL_INTERVAL, LERP_DURATION, type BiomeState, type RenderTier } from './state';
import { interpolateBiomeState, easeOut } from './interpolate';
import { BIOME_SETTINGS_DEFAULTS, type BiomeSettings } from './settings';

export function createBiomeStore() {
  let state = $state<BiomeState>({ ...BIOME_DEFAULTS });
  let targetState = $state<BiomeState>({ ...BIOME_DEFAULTS });
  let previousState = $state<BiomeState>({ ...BIOME_DEFAULTS });
  let tier = $state<RenderTier>('webgl');
  let lerpStart = $state(0);
  let isLerping = $state(false);
  let settings = $state<BiomeSettings>({ ...BIOME_SETTINGS_DEFAULTS });
  let animationFrame: number | undefined;
  let stateFetchGeneration = 0;

  function setState(newState: BiomeState) {
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
    state = interpolateBiomeState(previousState, targetState, easedT);
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

  function detectTier(): RenderTier {
    if (typeof window === 'undefined') return 'webgl';

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return 'static';

    const isMobile = window.innerWidth < 768 || /Mobi|Android/i.test(navigator.userAgent);
    if (isMobile) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) return 'canvas';
      } catch {
        return 'canvas';
      }
    }

    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return 'canvas';
    } catch {
      return 'canvas';
    }

    return 'webgl';
  }

  function initTier() {
    tier = detectTier();
  }

  async function fetchState() {
    const generation = ++stateFetchGeneration;
    try {
      const res = await fetch('/api/biome/state');
      if (!res.ok) return;
      const data: BiomeState = await res.json();
      // An in-flight request can outlive the layout that started it. Do not let
      // its late response restart interpolation after the store was stopped.
      if (generation !== stateFetchGeneration) return;
      setState(data);
    } catch {
      // Silently fail — keep current state
    }
  }

  async function fetchSettings() {
    try {
      const res = await fetch('/api/biome/config');
      if (!res.ok) return;
      const data: BiomeSettings = await res.json();
      settings = { ...BIOME_SETTINGS_DEFAULTS, ...data };
    } catch {
      // Silently fail — keep defaults
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
    // cadence. Configuration is fetched explicitly by the optional biome UI;
    // it changes only through the admin form and must not be polled site-wide.
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
    get tier() { return tier; },
    get isLerping() { return isLerping; },
    get settings() { return settings; },
    set settings(s: BiomeSettings) { settings = s; },
    setState,
    tick,
    initTier,
    startPolling,
    stopPolling,
    fetchState,
    fetchSettings,
  };
}

export type BiomeStore = ReturnType<typeof createBiomeStore>;
