import { describe, it, expect } from 'vitest';
import { createKeymap } from './keymap';

/** Minimal KeyboardEvent stand-in — the registry only reads whatever the handlers read. */
function key(k: string): KeyboardEvent {
  return { key: k } as unknown as KeyboardEvent;
}

describe('createKeymap', () => {
  it('runs handlers in priority-descending order', () => {
    const km = createKeymap();
    const order: string[] = [];
    km.register('low', () => { order.push('low'); return false; }, { priority: 10 });
    km.register('high', () => { order.push('high'); return false; }, { priority: 100 });
    km.register('mid', () => { order.push('mid'); return false; }, { priority: 50 });
    km.handleKeydown(key('Escape'));
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('short-circuits once a handler returns true', () => {
    const km = createKeymap();
    const order: string[] = [];
    km.register('a', () => { order.push('a'); return true; }, { priority: 100 });
    km.register('b', () => { order.push('b'); return false; }, { priority: 50 });
    const handled = km.handleKeydown(key('x'));
    expect(handled).toBe(true);
    expect(order).toEqual(['a']); // 'b' never runs
  });

  it('returns false when no handler consumes the event', () => {
    const km = createKeymap();
    km.register('a', () => false, { priority: 10 });
    km.register('b', () => undefined, { priority: 5 });
    expect(km.handleKeydown(key('q'))).toBe(false);
  });

  it('treats a void return as not-handled (continues the chain)', () => {
    const km = createKeymap();
    const order: string[] = [];
    km.register('a', () => { order.push('a'); /* void */ }, { priority: 100 });
    km.register('b', () => { order.push('b'); return true; }, { priority: 50 });
    const handled = km.handleKeydown(key('x'));
    expect(handled).toBe(true);
    expect(order).toEqual(['a', 'b']);
  });

  it('breaks priority ties by registration order', () => {
    const km = createKeymap();
    const order: string[] = [];
    km.register('first', () => { order.push('first'); return false; }, { priority: 10 });
    km.register('second', () => { order.push('second'); return false; }, { priority: 10 });
    km.register('third', () => { order.push('third'); return false; }, { priority: 10 });
    km.handleKeydown(key('x'));
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('defaults missing priority to 0', () => {
    const km = createKeymap();
    const order: string[] = [];
    km.register('none', () => { order.push('none'); return false; });
    km.register('positive', () => { order.push('positive'); return false; }, { priority: 1 });
    km.register('negative', () => { order.push('negative'); return false; }, { priority: -1 });
    km.handleKeydown(key('x'));
    expect(order).toEqual(['positive', 'none', 'negative']);
  });

  it('unregister removes only its own handler', () => {
    const km = createKeymap();
    const order: string[] = [];
    const off = km.register('a', () => { order.push('a'); return false; }, { priority: 10 });
    km.register('b', () => { order.push('b'); return false; }, { priority: 5 });
    expect(km.size()).toBe(2);
    off();
    expect(km.size()).toBe(1);
    km.handleKeydown(key('x'));
    expect(order).toEqual(['b']);
  });

  it('is stable under double-register: replaces, does not stack, keeps sequence', () => {
    const km = createKeymap();
    const order: string[] = [];
    km.register('a', () => { order.push('a1'); return false; }, { priority: 10 });
    km.register('b', () => { order.push('b'); return false; }, { priority: 10 });
    // Re-register 'a' with a new handler body but same id.
    km.register('a', () => { order.push('a2'); return false; }, { priority: 10 });
    expect(km.size()).toBe(2); // not 3
    km.handleKeydown(key('x'));
    // 'a' keeps its original (earlier) sequence, so it still runs before 'b',
    // and the *new* handler body (a2) is the one invoked.
    expect(order).toEqual(['a2', 'b']);
  });

  it('a stale unregister after re-register does not evict the successor', () => {
    const km = createKeymap();
    const off1 = km.register('a', () => false, { priority: 10 });
    km.register('a', () => false, { priority: 10 }); // replace
    off1(); // stale — must be a no-op
    expect(km.size()).toBe(1);
  });

  it('reflects live handler results across successive dispatches', () => {
    const km = createKeymap();
    let consume = false;
    km.register('gate', () => consume, { priority: 100 });
    km.register('fallback', () => true, { priority: 10 });
    expect(km.handleKeydown(key('x'))).toBe(true); // fallback consumes
    consume = true;
    // gate now consumes; still handled, but short-circuits before fallback
    expect(km.handleKeydown(key('x'))).toBe(true);
  });
});
