// @vitest-environment jsdom
//
// The peek controller's DOM behaviour — its own file because the rest of the
// shaping suite runs in node, and these three need a document to focus into.
import { describe, expect, it } from 'vitest';
import { policyPeek } from './peek.svelte';

describe('a scroll treats a pinned card differently from a hover card', () => {
  it('re-anchors a PINNED card on scroll instead of dismissing it', () => {
    // The bug: tabbing to an explainer below the fold makes the browser scroll
    // it into view, and a blanket scroll-dismiss closed the card that the focus
    // had just opened. Every off-screen explainer was pointer-only while looking
    // perfectly correct to a mouse.
    const el = document.createElement('button');
    el.setAttribute('data-pa-peek', 'term:incentive');
    document.body.appendChild(el);
    try {
      policyPeek.pin('term', 'incentive', el);
      el.focus();
      policyPeek.rescroll();
      expect(policyPeek.current, 'a pinned card must survive the scroll its own focus caused').not.toBeNull();
      expect(policyPeek.current?.subject).toBe('incentive');
    } finally {
      el.remove();
      policyPeek.close();
    }
  });

  it('closes a pinned card when focus has moved to a DIFFERENT subject', () => {
    const el = document.createElement('button');
    el.setAttribute('data-pa-peek', 'term:ease');
    document.body.appendChild(el);
    try {
      policyPeek.pin('term', 'incentive', el);
      el.focus();
      policyPeek.rescroll();
      // Never re-point a card at something it is not about.
      expect(policyPeek.current).toBeNull();
    } finally {
      el.remove();
      policyPeek.close();
    }
  });

  it('dismisses an unpinned hover card on scroll, which is what that rule is for', () => {
    const el = document.createElement('button');
    el.setAttribute('data-pa-peek', 'term:impact');
    document.body.appendChild(el);
    try {
      policyPeek.pin('term', 'impact', el);
      policyPeek.current = { ...policyPeek.current!, pinned: false };
      policyPeek.rescroll();
      expect(policyPeek.current).toBeNull();
    } finally {
      el.remove();
      policyPeek.close();
    }
  });

});
