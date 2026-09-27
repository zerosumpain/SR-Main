// The owner's workflows, as opposed to a member's (`workflows.principal_id`,
// SR-Workflows docs/member-workflows.md).
//
// Owner automations — the doctor's triage, the heartbeat's workflow review,
// the orchestrator's workspace grounding, the public landing counts — read
// through this filter, so a member's workflow never enters an owner LLM
// context or gets "fixed" with owner authority, and never counts as the
// owner's public work. The owner's own screens still list everything.
import { eq } from 'drizzle-orm';
import { workflows } from '$lib/db/schema';

export const OWNER_WORKFLOW_PRINCIPAL = 'owner';

export const ownerWorkflows = () => eq(workflows.principalId, OWNER_WORKFLOW_PRINCIPAL);
