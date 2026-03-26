// src/lib/biome/actions.ts
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
