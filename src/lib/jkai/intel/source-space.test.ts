import { describe, expect, it } from 'vitest';
import { DRIVE_SPACES, resolveFolderSpace, type FolderSpaceSetting } from './source-space';
import { HOUSEHOLD_SPACE, OWNER_SPACE } from './scope';

const at = (path: string, spaceId: string | null): FolderSpaceSetting => ({ path, spaceId });

describe('resolveFolderSpace — nearest named ancestor wins, owner by default', () => {
  it("is the owner's when nothing names a space", () => {
    expect(resolveFolderSpace('a/b', [])).toEqual({ spaceId: 'owner', decidedBy: null });
  });

  it('inherits a parent routed to household, and a child can take it back', () => {
    const settings = [at('house', 'household'), at('house/private', 'owner')];
    expect(resolveFolderSpace('house/bills', settings)).toEqual({ spaceId: 'household', decidedBy: 'house' });
    expect(resolveFolderSpace('house/private/x', settings)).toEqual({ spaceId: 'owner', decidedBy: 'house/private' });
  });

  it('treats null as inherit and ignores anything that is not a Drive space', () => {
    const settings = [at('house', 'household'), at('house/sub', null), at('house/sub/deeper', 'u_someone')];
    expect(resolveFolderSpace('house/sub/deeper', settings).spaceId).toBe('household');
  });

  it('keeps its literals equal to the scope constants', () => {
    expect([...DRIVE_SPACES]).toEqual([OWNER_SPACE, HOUSEHOLD_SPACE]);
  });
});
