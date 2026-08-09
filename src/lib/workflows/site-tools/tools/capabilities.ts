// Read-only capability snapshot. This is intentionally a static skeleton;
// future capability discovery can extend the empty tools array without
// exposing runtime configuration or credentials.

import { register } from '../registry-internal';

export const CAPABILITIES_SNAPSHOT = {
  version: '1.0.0',
  tools: [],
} as const;

register({
  name: 'capabilities_snapshot',
  description: 'Return the static jkai capabilities snapshot. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Capabilities',
  toolset: 'capabilities',
  handler: async () => ({ success: true, data: CAPABILITIES_SNAPSHOT }),
});
