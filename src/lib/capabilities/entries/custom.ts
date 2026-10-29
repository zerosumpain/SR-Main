import { CUSTOM_TOOLSET_PREFIX, type CapabilityEntry } from '../types';

// The handful of saved custom tools re-enabled for owner chat (plan P2-0a,
// decision 8). Their toolsets are `custom:<toolset>` and change with the
// allow-list, so this row covers every toolset under the reserved prefix
// rather than naming them; the list itself is `$lib/tools/custom-tools-enabled`.
// Preview, on demand: never in the always-on prompt, never on WhatsApp,
// heartbeat, the bridge or any unattended caller.

export const CUSTOM_ENTRY: CapabilityEntry = {
  id: 'custom',
  title: 'Saved custom tools',
  blurb: `A few saved custom tools John chose to keep, read-only and owner-only, under toolsets named ${CUSTOM_TOOLSET_PREFIX}<name>.`,
  app: 'main',
  repo: 'SR-Main',
  status: 'preview',
  toolsets: [],
  tools: [],
  pages: ['/jkai'],
  memberSafe: false,
  notes: 'Authored by the old toolsmith; each runs in the sandbox and may only call read tools.',
};
