import { describe, expect, it } from 'vitest';
import { isNotFoundError, rethrowScoped } from './not-found';

describe('isNotFoundError', () => {
  it('recognises every out-of-scope message the scoped library throws', () => {
    for (const message of [
      'entity e1 not found', // decisions, unmerge, merge, confirm-link
      'survivor e1 not found', // merge
      'intel note n1 not found', // noteSpace
      'no such entity: e1', // split
      'no such split: k1', // undoSplit
    ]) {
      expect(isNotFoundError(new Error(message)), message).toBe(true);
    }
  });

  it('leaves a genuine bad request alone', () => {
    for (const message of [
      'cannot merge an entity into itself',
      'cannot merge entities from different spaces',
      'e1 is already merged',
      'a split must move at least one relationship',
    ]) {
      expect(isNotFoundError(new Error(message)), message).toBe(false);
    }
    expect(isNotFoundError('entity e1 not found')).toBe(false);
  });
});

describe('rethrowScoped', () => {
  const statusOf = (fn: () => never) => {
    try {
      fn();
    } catch (err) {
      return (err as { status: number }).status;
    }
    return null;
  };

  it('is a 404 for an id outside the scope and the route code otherwise', () => {
    expect(statusOf(() => rethrowScoped(new Error('entity e1 not found'), 400, 'x'))).toBe(404);
    expect(statusOf(() => rethrowScoped(new Error('e1 is already merged'), 400, 'x'))).toBe(400);
    expect(statusOf(() => rethrowScoped('boom', 500, 'x'))).toBe(500);
  });
});
