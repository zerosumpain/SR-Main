import { describe, it, expect } from 'vitest';
import {
  JKAI_ITEM,
  ROOMS,
  SECTIONS,
  SITE_ITEMS,
  activeSection,
  isItemActive,
  parentHref,
  parentLabel,
  navCellsFor,
  roomFor,
  subnavFor,
  visibleItems,
  visibleRooms,
  wearsRooms,
  wearsSharedChrome,
} from '../../../src/lib/nav/site-nav';

describe('activeSection', () => {
  it('prefers the deepest matching section', () => {
    expect(activeSection('/jkai/intel/sources')?.id).toBe('jkai-intel');
    expect(activeSection('/jkai/codegraph/ask')?.id).toBe('jkai-codegraph');
    expect(activeSection('/jkai/develop/42')?.id).toBe('jkai');
    // The archive console still lives under /jkai/builds and must keep a section.
    expect(activeSection('/jkai/builds/42')?.id).toBe('jkai');
    expect(activeSection('/jkai')?.id).toBe('jkai');
  });

  it('does not match a section on a merely similar prefix', () => {
    // Retired routes must not swallow the nearest live section.
    expect(activeSection('/health')?.id).toBe('health');
    expect(activeSection('/heart')).toBeUndefined();
    expect(activeSection('/livestock')).toBeUndefined();
  });
});

describe('parentHref — the common way back', () => {
  it('walks one level up, never straight home', () => {
    expect(parentHref('/blog/some-post')).toBe('/blog');
    expect(parentHref('/jkai/develop/42')).toBe('/jkai/develop');
    // /jkai/builds is a 308 stub with a +page.server.ts and no component. It has
    // to stay a real route: delete it and this back link points at a 404, which
    // is exactly what nav-parents.test.ts fails on.
    expect(parentHref('/jkai/builds/42')).toBe('/jkai/builds');
    expect(parentHref('/jkai/intel/sources')).toBe('/jkai/intel');
    expect(parentHref('/health/activities/17')).toBe('/health/activities');
    expect(parentHref('/projects/engine-room/daydream/inbox')).toBe('/projects/engine-room/daydream');
  });

  it('sends a sub-section back to the family above it', () => {
    expect(parentHref('/jkai/intel')).toBe('/jkai');
    expect(parentHref('/jkai/codegraph')).toBe('/jkai');
    expect(parentHref('/jkai/daydreams')).toBe('/jkai');
    expect(parentHref('/jkai/daydreams/feed')).toBe('/jkai/daydreams');
  });

  it('files research in a room rather than under jkai', () => {
    // It used to walk up to /jkai, because the jkai strip was the only place
    // that listed it. It is in Know now, and the room cell is the way up.
    expect(parentHref('/research')).toBeNull();
    expect(roomFor('/research')?.id).toBe('know');
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
    expect(parentLabel('/jkai/intel/memory')).toBe('Intel');
    expect(parentLabel('/blog/some-post')).toBe('Writing');
    expect(parentLabel('/jkai/intel')).toBe('jkai');
  });
});

describe('owner filtering', () => {
  it('offers a signed-out visitor nothing that would bounce to /login', () => {
    const anon = visibleItems(SITE_ITEMS, false).map((i) => i.href);
    for (const owned of ['/releases', '/news', '/drive', '/live', '/jkai', '/research', '/home']) {
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
    const everyHref = [...SITE_ITEMS, JKAI_ITEM, ...(JKAI_ITEM.children ?? []), ...SECTIONS.flatMap((s) => s.items)]
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
    expect(wearsSharedChrome('/deepdive/share/tok123')).toBe(false);
    expect(wearsSharedChrome('/research/abc/desk')).toBe(false);
  });

  it('keeps the shared-conversation page ON the bar', () => {
    // It was carved out while it inherited the hub masthead, which showed a
    // share-link holder the day's spend and credit balance. It is a
    // `+page@.svelte` now — reset to the root layout, the way /jkai/run is — so
    // the leak is gone and it wears the ordinary bar like everything else.
    expect(wearsSharedChrome('/jkai/shared/tok123')).toBe(true);
  });

  it('leaves every ordinary page wearing the bar', () => {
    for (const p of ['/', '/blog', '/blog/a-post', '/jkai', '/jkai/intel/sources', '/health', '/health/plan', '/research', '/projects/engine-room/daydream', '/admin/ops/costs']) {
      expect(wearsSharedChrome(p), `${p} lost its header`).toBe(true);
    }
  });
});

describe('isItemActive', () => {
  it('lights the chat cell only on the hub root', () => {
    const chat = SECTIONS.find((s) => s.id === 'jkai')!.items.find((i) => i.label === 'Chat')!;
    expect(isItemActive(chat, '/jkai')).toBe(true);
    expect(isItemActive(chat, '/jkai/develop')).toBe(false);
  });

  it('lights a section cell for its whole subtree', () => {
    const intel = SECTIONS.find((s) => s.id === 'jkai')!.items.find((i) => i.label === 'Intel')!;
    expect(isItemActive(intel, '/jkai/intel/entities/42')).toBe(true);
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
  it('shows a page with no strip of its own its room-mates', () => {
    // The regression this guards: sections without children rendered an empty
    // band, so /blog, /projects and /releases lost their nav.
    expect(navCellsFor('/blog', true).map((i) => i.href)).toEqual(['/projects', '/blog', '/admin/content/blog']);
    expect(navCellsFor('/projects', true).map((i) => i.href)).toContain('/blog');
    expect(navCellsFor('/releases', true).map((i) => i.href)).toContain('/admin');
    expect(navCellsFor('/trips', true).map((i) => i.href)).toContain('/health');
  });

  it('leaves the main page to the room cells', () => {
    // No strip: SiteHeader draws one cell per room there instead, so the bar
    // is five menus wide rather than twenty links long.
    expect(navCellsFor('/', true)).toEqual([]);
    expect(wearsRooms(true)).toBe(true);
  });

  it('shows the SECTION strip where a section has one', () => {
    expect(navCellsFor('/jkai/intel/memory', true).map((i) => i.href)).toContain(
      '/jkai/intel/sources',
    );
    expect(navCellsFor('/health/plan', true).map((i) => i.href)).toContain('/health/segments');
  });

  it('offers an anonymous visitor nothing behind the auth gate', () => {
    // /jkai/shared/<token> is public and its section is the owner-only jkai
    // hub, whose nine items carry no per-item flag.
    expect(subnavFor('/jkai/shared/tok', false)).toEqual([]);
    for (const href of navCellsFor('/jkai/shared/tok', false).map((i) => i.href)) {
      expect(['/releases', '/news', '/drive', '/live', '/jkai', '/research']).not.toContain(href);
    }
  });
});

describe('the jkai cell is the assistant, not a drawer', () => {
  it('carries no menu: what hung under it is filed in a room', () => {
    expect(JKAI_ITEM.children).toBeUndefined();
    expect(roomFor('/trips/abc')?.id).toBe('life');
    expect(roomFor('/home/wishlist')?.id).toBe('life');
    expect(roomFor('/jkai/daydreams/watches')?.id).toBe('know');
  });

  it('lights on jkai only, and a trip walks up to Trips and no further', () => {
    expect(isItemActive(JKAI_ITEM, '/jkai/canvas')).toBe(true);
    expect(isItemActive(JKAI_ITEM, '/trips/abc')).toBe(false);
    expect(activeSection('/trips/abc')?.id).toBe('trips');
    // The room cell is the way up from a room's page; a back cell to jkai
    // would say Trips lives under the assistant, which is the drawer again.
    expect(parentHref('/trips')).toBeNull();
    expect(parentHref('/trips/abc')).toBe('/trips');
  });

  it('keeps jkai out of the strip: every bar renders it on its own', () => {
    expect(navCellsFor('/trips/abc', true).map((c) => c.href)).not.toContain('/jkai');
    expect(navCellsFor('/health', true).map((c) => c.href)).not.toContain('/jkai');
  });

  it('gives a member the cell where their grants reach under it, and none to a visitor', () => {
    expect(visibleItems([JKAI_ITEM], false)).toEqual([]);
    expect(visibleItems([JKAI_ITEM], false, ['/jkai/daydreams/impact'])[0]?.href).toBe('/jkai/daydreams/impact');
  });
});

describe('rooms', () => {
  it('files every destination in exactly one room', () => {
    // `roomFor` takes the first room with a matching item. If two rooms could
    // claim a page, which cell the bar wears would depend on declaration order.
    for (const room of ROOMS) {
      for (const item of room.items) {
        const claimed = ROOMS.filter((r) => r.items.some((i) => isItemActive(i, item.href)));
        expect(claimed.map((r) => r.id), `${item.href} is claimed by more than one room`).toEqual([room.id]);
        const lit = room.items.filter((i) => isItemActive(i, item.href));
        expect(lit.length, `${item.href} lit ${lit.length} rows in ${room.id}`).toBe(1);
      }
    }
  });

  it('gives every section a room, bar the assistant itself', () => {
    // A section outside every room has a bar with no way across the site.
    for (const s of SECTIONS) {
      if (s.id === 'jkai') continue;
      expect(roomFor(s.rootHref), `${s.rootHref} is in no room`).toBeDefined();
    }
    expect(roomFor('/jkai')).toBeUndefined();
    expect(roomFor('/')).toBeUndefined();
  });

  it('splits the two halves of /admin and of /home between rooms', () => {
    expect(roomFor('/admin/ops/costs')?.id).toBe('run');
    expect(roomFor('/admin/content/blog/new')?.id).toBe('show');
    expect(roomFor('/home/people')?.id).toBe('life');
    expect(roomFor('/jkai/canvas/abc')?.id).toBe('make');
    expect(roomFor('/jkai/builds/42')?.id).toBe('make');
    expect(roomFor('/deepdive/abc')?.id).toBe('know');
  });

  it('gives the owner five rooms and a visitor none', () => {
    expect(wearsRooms(true)).toBe(true);
    expect(visibleRooms(true).map((r) => r.id)).toEqual(['show', 'life', 'know', 'make', 'run']);
    // Three pages do not need five menus.
    expect(wearsRooms(false)).toBe(false);
    expect(navCellsFor('/', false).map((i) => i.href)).toEqual(['/projects', '/blog', '/health']);
    expect(navCellsFor('/blog', false).map((i) => i.href)).toEqual(['/projects', '/blog', '/health']);
  });

  it('offers a member only the rooms they can open something in', () => {
    const reach = ['/jkai/notes', '/research', '/news', '/trips'];
    expect(wearsRooms(false, reach)).toBe(true);
    expect(visibleRooms(false, reach).map((r) => r.id)).toEqual(['show', 'life', 'know']);
    expect(visibleRooms(false, reach).find((r) => r.id === 'know')?.items.map((i) => i.href)).toEqual([
      '/news',
      '/research',
      '/jkai/notes',
    ]);
  });
});
