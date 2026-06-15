// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { portal } from './portal';

describe('portal action', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('InspectorDrawer scenario (the bug): destroy() fully removes node when originalParent stays connected', () => {
    // Simulate InspectorDrawer: the component container (originalParent) is
    // permanently appended to body and stays connected even when the drawer
    // closes — it is the SvelteKit component mount point, not the overlay.
    const parent = document.createElement('div');
    parent.id = 'component-container';
    document.body.appendChild(parent);

    const node = document.createElement('div');
    node.className = 'insp-root';
    parent.appendChild(node);

    // Portal the node to body (as InspectorDrawer does: use:portal={'body'}).
    const action = portal(node, 'body');

    // While portaled, node lives directly under <body>.
    expect(node.parentNode).toBe(document.body);

    // Svelte closes the {#if open && artefact} block: it detaches the node
    // (node.parentNode → null), then calls destroy().
    // Simulate Svelte detaching the node before destroy (Svelte 5 unmount order).
    node.remove();
    expect(node.parentNode).toBeNull();

    // destroy() must NOT re-append to originalParent (which is still connected).
    // Old code: node.parentNode !== originalParent → true → re-appends to parent → BUG.
    // New code: unconditionally remove → node stays detached.
    action.destroy();

    expect(node.isConnected).toBe(false);
    expect(node.parentNode).not.toBe(parent);
    // Confirm it's also not a child of originalParent.
    expect(Array.from(parent.children)).not.toContain(node);
    // And not in the target (body) either.
    const orphansInBody = Array.from(document.body.querySelectorAll('.insp-root'));
    expect(orphansInBody).toHaveLength(0);
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

  it('detached node: destroy() is a safe no-op (no throw)', () => {
    // If the node is already detached (parentNode is null) before destroy is
    // called, destroy must not throw.
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const node = document.createElement('div');
    parent.appendChild(node);

    const action = portal(node);
    // Already detached before destroy (e.g. Svelte removed it first).
    node.remove();
    expect(node.parentNode).toBeNull();

    expect(() => action.destroy()).not.toThrow();
    expect(node.isConnected).toBe(false);
  });
});
