import { describe, it, expect } from 'vitest';
import { workflowAuditLog } from '$lib/db/schema';

describe('workflowAuditLog schema', () => {
  it('has expected columns', () => {
    expect(workflowAuditLog.id).toBeDefined();
    expect(workflowAuditLog.workflowId).toBeDefined();
    expect(workflowAuditLog.entity).toBeDefined();
    expect(workflowAuditLog.entityId).toBeDefined();
    expect(workflowAuditLog.action).toBeDefined();
    expect(workflowAuditLog.details).toBeDefined();
    expect(workflowAuditLog.at).toBeDefined();
  });
});
