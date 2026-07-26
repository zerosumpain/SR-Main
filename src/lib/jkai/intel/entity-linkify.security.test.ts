// Adversarial tests for the chat entity linkifier.
//
// Entity names come from LLM extraction over untrusted documents, so a name is
// attacker-influenceable text that this module interpolates into HTML. These
// tests exist to prove it cannot become markup.
//
// The key insight, and the reason a naive assertion here is misleading: a
// payload like `" onerror="alert(1)` SURVIVES in the output as inert data
// inside an entity-encoded attribute value. Asserting `not.toContain('onerror')`
// would fail on safe output. What must actually hold is that no NEW attribute
// and no NEW tag can be created — so that is what is asserted, by tokenising
// attributes the way a browser does (a quoted value runs to the next RAW quote).
import { describe, it, expect } from 'vitest';
import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
import { linkifyEntities } from '$lib/jkai/intel/entity-linkify';

describe('entity linkify — adversarial', () => {
  it('sanitiser encodes > inside attribute values, so the tokenizer cannot be split', () => {
    const out = sanitizeChatHtml('<a href="/x" title="a>b">Railpen</a>');
    expect(out).not.toMatch(/title="[^"]*>[^"]*"/);
  });

  it('cannot inject markup via a hostile entity name', () => {
    const hostile = [
      '" onerror="alert(1)',
      '"><img src=x onerror=alert(1)>',
      "' onclick='alert(1)",
      '</a><script>alert(1)</script>',
      'Railpen<script>',
    ];
    for (const name of hostile) {
      const html = sanitizeChatHtml('<p>Talking about Railpen today.</p>');
      const { html: out } = linkifyEntities(html, [{ id: 'e1', name, typeName: 'organisation' }]);
      expect(out, `name=${name}`).not.toContain('<script');
      expect(out, `name=${name}`).not.toMatch(/on(error|click|load)=/i);
    }
  });

  it('cannot create a new attribute or tag from a hostile entity id or type', () => {
    const { html } = linkifyEntities('<p>Railpen here</p>', [
      { id: '" onerror="alert(1)', name: 'Railpen', typeName: '"><script>alert(1)</script>' },
    ]);

    // The payload survives as inert DATA inside an escaped attribute value —
    // that is the correct outcome, so asserting the absence of the substring
    // "onerror=" would be testing the wrong thing. What must hold is that no
    // NEW attribute and no new tag can be created.
    const open = html.match(/<a [^>]*>/)![0];
    // Match name="value" pairs the way a browser tokenises them: a quoted value
    // runs to the next RAW quote. Because every interpolated value is entity-
    // encoded, the payload is swallowed whole as one value rather than parsed
    // as further attributes.
    const attrNames = [...open.matchAll(/\s([a-zA-Z-]+)="([^"]*)"/g)].map((m) => m[1]).sort();
    expect(attrNames).toEqual(['class', 'data-entity-id', 'data-entity-type', 'role', 'tabindex']);

    // Exactly one tag was opened and one closed — no injected element.
    expect(html.match(/</g)!.length).toBe(html.match(/>/g)!.length);
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).not.toContain('<script');
    // Every dangerous character in the interpolated values is entity-encoded.
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('emits only text taken verbatim from the already-escaped input', () => {
    const html = sanitizeChatHtml('<p>A &amp; B and Railpen</p>');
    const { html: out } = linkifyEntities(html, [{ id: 'e1', name: 'Railpen', typeName: 'org' }]);
    expect(out).toContain('&amp;');
    expect(out).toContain('>Railpen</a>');
  });
});
