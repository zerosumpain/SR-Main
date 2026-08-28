// Fuel-burn estimation for the Broads Pilot engine. Pure, dependency-free.
import type { RouteLeg } from './types';
import { groundSpeedMs } from './passability';

/** Diesel burn (litres/hour) at boat speed `vmph` — cubic in speed, with a
 * fixed idle/hotel term. lph(6) = 1.70, lph(3) ≈ 0.65. */
export const lph = (vmph: number): number => 0.5 + 1.2 * Math.pow(vmph / 6, 3);

/** Total fuel for a route leg, summing per-edge burn at the (≤6 mph) speed. */
export function routeFuel(
  leg: RouteLeg,
  pricePerL = 1.6,
): { litres: number; cost: number } {
  let litres = 0;
  for (const edge of leg.edges) {
    const v = Math.min(edge.limit_mph, 6);
    const hours = edge.length_m / (groundSpeedMs(v) * 0.9) / 3600;
    litres += hours * lph(v);
  }
  return { litres, cost: litres * pricePerL };
}
