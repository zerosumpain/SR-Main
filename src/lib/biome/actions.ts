// src/lib/biome/actions.ts
import { cardiacPulse } from './state';
import type { BiomeStore } from './store.svelte';

const MAX_SKEW_DEG = 3;
const MAX_WIND_SPEED = 30;

/**
 * Compute wind skew in degrees from wind direction and speed.
 * Uses the east-west component only (sin of direction).
 * Meteorological convention: direction is "from", so we negate
 * to get the direction the wind pushes (text leans with the wind).
 */
export function computeWindSkew(directionDeg: number, speed: number): number {
  if (speed <= 0) return 0;
  const rad = (directionDeg * Math.PI) / 180;
  const ewComponent = -Math.sin(rad);
  const speedFactor = Math.min(speed, MAX_WIND_SPEED) / MAX_WIND_SPEED;
  return MAX_SKEW_DEG * ewComponent * speedFactor;
}

const BASE_LETTER_SPACING = -0.02; // em — matches .display in app.css
const BREATH_RANGE = 0.01; // em — max expansion at peak beat
const NORMAL_INTENSITY = 40;
const STALE_INTENSITY = 20;
const WIND_LERP_SPEED = 0.002; // per ms — ~2s to reach target

export function livingType(
  node: HTMLElement,
  params: () => { store: BiomeStore; enabled: boolean }
): { destroy: () => void } {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    node.style.letterSpacing = '';
    node.style.transform = '';
    return { destroy: () => {} };
  }

  let rafHandle = 0;
  let lastTime = 0;
  let currentSkew = 0;
  let startTime = 0;

  function loop(time: number) {
    if (startTime === 0) startTime = time;
    const { store, enabled } = params();

    if (!enabled) {
      node.style.letterSpacing = '';
      node.style.transform = '';
      currentSkew = 0;
      lastTime = time;
      rafHandle = requestAnimationFrame(loop);
      return;
    }

    const dt = lastTime > 0 ? time - lastTime : 16;
    lastTime = time;
    const elapsed = (time - startTime) / 1000;

    // --- Breathing ---
    const { pulse, stale, sources } = store.state;
    const intensity = (stale || !sources.heartRate) ? STALE_INTENSITY : NORMAL_INTENSITY;
    const beat = cardiacPulse(elapsed, pulse, intensity);
    const letterSpacing = BASE_LETTER_SPACING + beat * BREATH_RANGE;
    node.style.letterSpacing = `${letterSpacing}em`;

    // --- Wind skew (manual lerp) ---
    const { windSpeed, windDirection } = store.state.weather;
    const targetSkew = computeWindSkew(windDirection, windSpeed);
    const lerpFactor = 1 - Math.exp(-WIND_LERP_SPEED * dt);
    currentSkew += (targetSkew - currentSkew) * lerpFactor;
    if (Math.abs(currentSkew) > 0.01) {
      node.style.transform = `skewX(${currentSkew.toFixed(3)}deg)`;
    } else {
      node.style.transform = '';
    }

    rafHandle = requestAnimationFrame(loop);
  }

  rafHandle = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafHandle);
      node.style.letterSpacing = '';
      node.style.transform = '';
    },
  };
}
