import { describe, expect, it } from 'vitest';
import { jkaiCoreOwner, workflowOwner } from './extraction-owner';

describe('extraction service owners', () => {
  it('keeps Main as the default owner', () => {
    expect(workflowOwner({})).toBe('main');
    expect(jkaiCoreOwner({})).toBe('main');
  });

  it('accepts explicit handoffs and rejects misspelled owners', () => {
    expect(workflowOwner({ SR_WORKFLOWS_OWNER: 'workflows' })).toBe('workflows');
    expect(jkaiCoreOwner({ SR_JKAI_CORE_OWNER: 'core' })).toBe('core');
    expect(() => workflowOwner({ SR_WORKFLOWS_OWNER: 'external' })).toThrow(/SR_WORKFLOWS_OWNER/);
    expect(() => jkaiCoreOwner({ SR_JKAI_CORE_OWNER: 'external' })).toThrow(/SR_JKAI_CORE_OWNER/);
  });
});
