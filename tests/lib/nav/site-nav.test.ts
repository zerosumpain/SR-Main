import { describe, it, expect } from 'vitest';
import {
  SECTIONS,
  SITE_ITEMS,
  activeSection,
  isItemActive,
  parentHref,
  parentLabel,
  navCellsFor,
  subnavFor,
  visibleItems,
  wearsSharedChrome,
} from '../../../src/lib/nav/site-nav';

describe('activeSection', () => {
  it('prefers the deepest matching section', () => {
    expect(activeSection('/jkai/intel/notes')?.id).toBe('jkai-intel');
    expect(activeSection('/jkai/codegraph/ask')?.id).toBe('jkai-codegraph');
    expect(activeSection('/jkai/builds/42')?.id).toBe('jkai');
    expect(activeSection('/jkai')?.id).toBe('jkai');
  });

  it('does not match a section on a merely similar prefix', () => {
    // '/heart' must not swallow '/health', nor '/live' swallow '/livestock'.
    expect(activeSection('/health')?.id).toBe('health');
    expect(activeSection('/heart')?.id).toBe('heart');
    expect(activeSection('/livestock')).toBeUndefined();
  });
});

describe('parentHref — the common way back', () => {
  it('walks one level up, never straight home', () => {
    expect(parentHref('/blog/some-post')).toBe('/blog');
    expect(parentHref('/jkai/builds/42')).toBe('/jkai/builds');
    expect(parentHref('/jkai/intel/notes/new')).toBe('/jkai/intel/notes');
    expect(parentHref('/health/activities/17')).toBe('/health/activities');
    expect(parentHref('/projects/engine-room/turn/trace')).toBe('/projects/engine-room/turn');
  });

  it('sends a sub-section back to the family above it', () => {
    expect(parentHref('/jkai/intel')).toBe('/jkai');
    expect(parentHref('/jkai/codegraph')).toBe('/jkai');
    expect(parentHref('/jkai/daydreams')).toBe('/jkai');
    expect(parentHref('/jkai/daydreams/feed')).toBe('/jkai/daydreams');
  });

  it('answers the brief: research goes back to jkai', () => {
    // John's own example. /jkai/research 308s to /research, but where it
    // belongs did not move.
    expect(parentHref('/research')).toBe('/jkai');
    expect(parentLabel('/research')).toBe('jkai');
    expect(parentHref('/research/abc123')).toBe('/research');
  });

  it('has no back link on a top-level section root or on home', () => {
    expect(parentHref('/')).toBeNull();
    expect(parentHref('/jkai')).toBeNull();
    expect(parentHref('/health')).toBeNull();
    expect(parentHref('/blog')).toBeNull();
  });

  it('never walks a path out of its own family', () => {
    for (const s of SECTIONS) {
      for (const item of s.items) {
        const up = parentHref(item.href);
        if (up === null) continue;
        expect(
          up === '/' || item.href.startsWith(up),
          `${item.href} walked up to an unrelated ${up}`,
        ).toBe(true);
      }
    }
  });

  it('labels the back cell with the destination, not the current page', () => {
    expect(parentLabel('/jkai/intel/notes/new')).toBe('Notes');
    expect(parentLabel('/blog/some-post')).toBe('Writing');
    expect(parentLabel('/jkai/intel')).toBe('jkai');
  });
});

describe('owner filtering', () => {
  it('offers a signed-out visitor nothing that would bounce to /login', () => {
    const anon = visibleItems(SITE_ITEMS, false).map((i) => i.href);
    for (const owned of ['/news', '/drive', '/live', '/jkai', '/research']) {
      expect(anon, `${owned} was offered to an anonymous visitor`).not.toContain(owned);
    }
    expect(anon).toContain('/projects');
    expect(anon).toContain('/blog');
  });

  it('keeps /health but drops its children, which are owner-gated', () => {
    // /health is an EXACT hook bypass, never a prefix — see gate-bypasses.ts.
    const anon = subnavFor('/health', false).map((i) => i.href);
    expect(anon).toEqual(['/health']);
    const owner = subnavFor('/health', true).map((i) => i.href);
    expect(owner).toContain('/health/segments');
  });
});

describe('the hidden owner-only surfaces stay hidden', () => {
  it('never emits a route that is deliberately absent from every index', () => {
    const everyHref = [...SITE_ITEMS, ...SECTIONS.flatMap((s) => s.items)]
      .map((i) => i.href)
      .concat(SECTIONS.map((s) => s.rootHref));
    // /projects is a public PREFIX; these two are gated only inside their own
    // loads and carry other people's location history.
    expect(everyHref).not.toContain('/projects/landgrab');
    expect(everyHref).not.toContain('/projects/family-life360-history');
  });
});

describe('wearsSharedChrome', () => {
  it('carves out the routes that cannot hold a sticky bar', () => {
    expect(wearsSharedChrome('/jkai/run')).toBe(false);
    expect(wearsSharedChrome('/capture')).toBe(false);
    expect(wearsSharedChrome('/capture/note')).toBe(false);
    expect(wearsSharedChrome('/login')).toBe(false);
    expect(wearsSharedChrome('/auth-error')).toBe(false);
    expect(wearsSharedChrome('/broads/speed')).toBe(false);
    expect(wearsSharedChrome('/deepdive/share/tok123')).toBe(false);
    expect(wearsSharedChrome('/projects/broads-pilot')).toBe(false);
    expect(wearsSharedChrome('/research/abc/desk')).toBe(false);
    expect(wearsSharedChrome('/decks/my-deck/print')).toBe(false);
  });

  it('keeps the shared-conversation page ON the bar', () => {
    // It was carved out while it inherited the hub masthead, which showed a
    // share-link holder the day's spend and credit balance. It is a
    // `+page@.svelte` now — reset to the root layout, the way /jkai/run is — so
    // the leak is gone and it wears the ordinary bar like everything else.
    expect(wearsSharedChrome('/jkai/shared/tok123')).toBe(true);
  });

  it('carves out the deck PLAYER but not the index or the editor', () => {
    expect(wearsSharedChrome('/decks/my-deck')).toBe(false);
    expect(wearsSharedChrome('/decks')).toBe(true);
    expect(wearsSharedChrome('/decks/my-deck/edit')).toBe(true);
  });

  it('leaves every ordinary page wearing the bar', () => {
    for (const p of ['/', '/blog', '/blog/a-post', '/jkai', '/jkai/intel/mail', '/health', '/health/plan', '/research', '/projects/engine-room/turn', '/admin/ops/costs']) {
      expect(wearsSharedChrome(p), `${p} lost its header`).toBe(true);
    }
  });
});

describe('isItemActive', () => {
  it('lights the chat cell only on the hub root', () => {
    const chat = SECTIONS.find((s) => s.id === 'jkai')!.items.find((i) => i.label === 'Chat')!;
    expect(isItemActive(chat, '/jkai')).toBe(true);
    expect(isItemActive(chat, '/jkai/builds')).toBe(false);
  });

  it('lights a section cell for its whole subtree', () => {
    const intel = SECTIONS.find((s) => s.id === 'jkai')!.items.find((i) => i.label === 'Intel')!;
    expect(isItemActive(intel, '/jkai/intel/notes/new')).toBe(true);
  });

  it('lights exactly one cell per section on every page it serves', () => {
    for (const s of SECTIONS) {
      for (const item of s.items) {
        const lit = s.items.filter((i) => isItemActive(i, item.href));
        expect(lit.length, `${item.href} lit ${lit.length} cells in ${s.id}`).toBe(1);
      }
    }
  });
});

describe('the bar is never empty', () => {
  it('shows the site strip on the main page and every top-level page', () => {
    // The regression this guards: sections without children rendered an empty
    // band, so /, /blog, /projects, /decks and /releases lost the nav the site
    // has always had. The brief opens by naming that bar as the thing to keep.
    for (const p of ['/', '/blog', '/projects', '/decks', '/releases', '/heart']) {
      const cells = navCellsFor(p, true).map((i) => i.href);
      expect(cells.length, `${p} rendered an empty nav bar`).toBeGreaterThan(3);
      expect(cells).toContain('/projects');
    }
  });

  it('shows the SECTION strip where a section has one', () => {
    expect(navCellsFor('/jkai/intel/mail', true).map((i) => i.href)).toContain(
      '/jkai/intel/notes',
    );
    expect(navCellsFor('/health/plan', true).map((i) => i.href)).toContain('/health/segments');
  });

  it('offers an anonymous visitor nothing behind the auth gate', () => {
    // /jkai/shared/<token> is public and its section is the owner-only jkai
    // hub, whose nine items carry no per-item flag.
    expect(subnavFor('/jkai/shared/tok', false)).toEqual([]);
    for (const href of navCellsFor('/jkai/shared/tok', false).map((i) => i.href)) {
      expect(['/news', '/drive', '/live', '/jkai', '/research']).not.toContain(href);
    }
  });
});
