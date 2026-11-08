// Read-only capability snapshot. This is intentionally a static skeleton;
// future capability discovery can extend the empty tools array without
// exposing runtime configuration or credentials.

import { register, tools } from '../registry-internal';
import { declaredTier } from '../declared-tier';

export const CAPABILITIES_SNAPSHOT = {
  version: '1.0.0',
  tools: [],
} as const;

register({
  name: 'capabilities_snapshot',
  effect: 'read',
  description: 'Return the static jkai capabilities snapshot. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Capabilities',
  toolset: 'capabilities',
  handler: async () => ({ success: true, data: { version: '2.0.0', tools: tools.map(t => ({ name: t.name, toolset: t.toolset, destructive: !!t.destructive || declaredTier(t).effect === 'destructive', effect: declaredTier(t).effect })), note: 'Registered capabilities; provider availability is checked on invocation.' } }),
});
