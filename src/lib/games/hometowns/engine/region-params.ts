// The county layer's tunables (WP3, spec §8). They live in the `county` group
// of the params file (params.v1.json), like every other tunable (§11.5, A38):
// versioned by params version, frozen, and walked by the Lab. Each leaf's doc
// names its section.
//
// The link table itself is content (content.ts LINKS); everything that is a
// rate, a cap or a share is in the params file.

import { paramsFor, type Params, type ParamsVersion } from './params';

export type RegionParams = Params['county'];

/** The county layer's tunables for a params version. */
export function regionParams(version: ParamsVersion): RegionParams {
  return paramsFor(version).county;
}
