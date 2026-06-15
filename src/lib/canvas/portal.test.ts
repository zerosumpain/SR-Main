// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { portal } from './portal';

describe('portal action', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('toggle-close: restores node to originalParent, leaving zero orphans in the target', () => {
    // A normal mounted component: parent stays connected to the document.
    const parent = document.createElement('div');
    parent.id = 'parent';
    document.body.appendChild(parent);

    const node = document.createElement('div');
    node.className = 'overlay';
    parent.appendChild(node);

    // Portal it to <body> (default target).
    const action = portal(node);
    // While portaled, the node lives directly under <body>, not under parent.
    expect(node.parentNode).toBe(document.body);

    // Toggle-close (normal Svelte unmount): destroy() should restore to parent
    // so Svelte finds the node where it created it.
    action.destroy();
    expect(node.parentNode).toBe(parent);

    // Zero orphaned overlay nodes left directly under <body>.
    const orphans = Array.from(document.body.children).filter(
      (el) => el.classList.contains('overlay'),
    );
    expect(orphans).toHaveLength(0);
  });

  it('nav-teardown: destroy() leaves ZERO orphaned nodes in <body> when originalParent is gone', () => {
    // Simulate client-side navigation: the page (and the original parent) is
    // torn off the document before the action is destroyed.
    const parent = document.createElement('div');
    parent.id = 'parent';
    document.body.appendChild(parent);

    const node = document.createElement('div');
    node.className = 'scrim';
    parent.appendChild(node);

    const action = portal(node);
    expect(node.parentNode).toBe(document.body);

    // Page torn down: originalParent detached from the document.
    parent.remove();
    expect(parent.isConnected).toBe(false);

    // destroy() must NOT leave the scrim orphaned in <body> (the freeze bug).
    action.destroy();

    const orphans = Array.from(document.body.children).filter(
      (el) => el.classList.contains('scrim'),
    );
    expect(orphans).toHaveLength(0);
    expect(node.isConnected).toBe(false);
  });
});
