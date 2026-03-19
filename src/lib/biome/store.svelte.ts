import { BIOME_DEFAULTS, POLL_INTERVAL, LERP_DURATION, type BiomeState, type RenderTier } from './state';
import { interpolateBiomeState, easeOut } from './interpolate';

export function createBiomeStore() {
  let state = $state<BiomeState>({ ...BIOME_DEFAULTS });
  let targetState = $state<BiomeState>({ ...BIOME_DEFAULTS });
  let previousState = $state<BiomeState>({ ...BIOME_DEFAULTS });
  let tier = $state<RenderTier>('webgl');
  let lerpStart = $state(0);
  let isLerping = $state(false);

  function setState(newState: BiomeState) {
    previousState = { ...state };
    targetState = newState;
    lerpStart = performance.now();
    isLerping = true;
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
    try {
      const res = await fetch('/api/biome/state');
      if (!res.ok) return;
      const data: BiomeState = await res.json();
      setState(data);
    } catch {
      // Silently fail — keep current state
    }
  }

  let pollInterval: ReturnType<typeof setInterval> | undefined;

  function startPolling() {
    fetchState();
    pollInterval = setInterval(fetchState, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollInterval) clearInterval(pollInterval);
  }

  return {
    get state() { return state; },
    get targetState() { return targetState; },
    get tier() { return tier; },
    get isLerping() { return isLerping; },
    setState,
    tick,
    initTier,
    startPolling,
    stopPolling,
  };
}

export type BiomeStore = ReturnType<typeof createBiomeStore>;
