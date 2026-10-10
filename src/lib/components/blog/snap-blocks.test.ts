// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reachable } from './snap-blocks';

// jsdom lays nothing out, so the observer and the box sizes are stood in for.
let fire: () => void = () => {};
class FakeObserver {
  constructor(cb: () => void) {
    fire = cb;
  }
  observe() {
    fire();
  }
  disconnect() {}
}

function box(tag: 'table' | 'pre', scrollWidth: number, clientWidth: number) {
  const el = document.createElement(tag);
  el.style.overflowX = 'auto';
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
  document.body.append(el);
  return el;
}

describe('reachable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('makes code that scrolls a named, focusable region', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const pre = box('pre', 700, 300);
    const held = reachable(pre);
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.getAttribute('role')).toBe('region');
    expect(pre.getAttribute('aria-label')).toBe('Code, scrolls sideways');
    held.destroy();
    expect(pre.hasAttribute('tabindex')).toBe(false);
    expect(pre.hasAttribute('role')).toBe(false);
  });

  it('keeps a table a table: focusable and named, no role', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const table = box('table', 600, 320);
    reachable(table);
    expect(table.getAttribute('tabindex')).toBe('0');
    expect(table.hasAttribute('role')).toBe(false);
    expect(table.getAttribute('aria-label')).toBe('Table, scrolls sideways');
  });

  it('leaves a box that fits off the tab order', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const pre = box('pre', 300, 300);
    reachable(pre);
    expect(pre.hasAttribute('tabindex')).toBe(false);
    expect(pre.hasAttribute('aria-label')).toBe(false);
  });
});
