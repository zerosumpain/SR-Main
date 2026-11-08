// Great Works (spec §8.8) are milestone M3. This file is the seam WP3 leaves
// for them, so M3 lands by filling it in rather than by rewiring the day:
//   - the Regional Day already calls stepGreatWork at §8.3 step 5, between
//     fixing tomorrow's flows and delivering the day's moves;
//   - the Council's season-week-1 question already asks the family to choose
//     one, and the result waits in county.region.greatWorkChoice;
//   - county.greatWork (GreatWorkState) is the stored shape: stage,
//     progress per input, credit per town, pledges;
//   - the `pledge` move stays refused politely ("isn't ready yet") until then;
//   - A33 is already honoured: an archived town's pledges stay delivered and
//     credited, and archived towns are left out of everything else.
// M3 then needs: stage sizes scaled by max(0.5, (ΣN/20,000)^0.7) (goals.ts
// has countyScale), at least 3 input types per stage, the quarterback rule
// (fairness.greatWorkTownCap: no town over 40% of a stage; the final stage
// needs every ACTIVE mayor, A32: a hello in the last social.activeHelloDays,
// absent mayors excused and credited for their Visitors hosted), credit =
// Σ value / sqrt(1 + N/1,000), ribbon cuttings (offers.ts inviteRibbon), and
// the benefits applied through flows or params.

import type { CountyState, RegionalContext } from './types';

/** STEP §8.3 5 (WP3 → M3): the Great Work. Nothing to do until Great Works land. */
export function stepGreatWork(_c: CountyState, _r: RegionalContext): void {}
