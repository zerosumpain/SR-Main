import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for `page` from $app/state: `data` is whatever the test sets, and
// `throws` reproduces what the real one does with no router context.
const fake = vi.hoisted(() => ({ data: undefined as unknown, throws: false }));

vi.mock('$app/state', () => ({
  page: {
    get data() {
      if (fake.throws) throw new TypeError("Cannot read properties of undefined (reading 'page')");
      return fake.data;
    },
  },
}));

import { currentIsMember } from './member-mode';

describe('currentIsMember', () => {
  beforeEach(() => {
    fake.data = undefined;
    fake.throws = false;
  });

  it('is true only when the layout says member: true', () => {
    fake.data = { member: true };
    expect(currentIsMember()).toBe(true);
  });

  it('keeps owner behaviour when the flag is false or absent (chat, other pages)', () => {
    fake.data = { member: false };
    expect(currentIsMember()).toBe(false);
    fake.data = {};
    expect(currentIsMember()).toBe(false);
    fake.data = undefined;
    expect(currentIsMember()).toBe(false);
  });

  it('does not treat a truthy non-boolean as a member', () => {
    fake.data = { member: 'yes' };
    expect(currentIsMember()).toBe(false);
  });

  it('answers false instead of throwing outside a request', () => {
    fake.throws = true;
    expect(currentIsMember()).toBe(false);
  });
});
