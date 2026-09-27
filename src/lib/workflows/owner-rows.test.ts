import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Owner automations must read only the owner's workflows (principal 'owner'):
// a member's workflow never enters an owner LLM context, never gets "fixed"
// with owner authority, and never counts as the site's public work.
const OWNER_AUTOMATIONS = [
  'src/lib/workflowdoctor/triage.ts',
  'src/lib/heartbeat/activities/workflow-review.ts',
  'src/lib/workflows/orchestrator/workspace-grounding.ts',
  'src/routes/api/landing/vitals/+server.ts',
];

describe('owner automations read owner workflows only', () => {
  it.each(OWNER_AUTOMATIONS)('%s filters on ownerWorkflows()', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/ownerWorkflows\(\)/);
  });
});
