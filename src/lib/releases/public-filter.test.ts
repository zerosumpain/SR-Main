import { describe, it, expect } from 'vitest';
import {
  isItemPublic,
  isSurfacePublic,
  projectKeyOf,
  publicItems,
  redactItem,
  type FilterableItem,
} from './public-filter';

// Mirrors the real project_visibility table: a row only exists to mark a
// project PRIVATE, so absence means public.
const VIS: Record<string, boolean> = {
  'policy-engine': false,
  'data-spine': false,
  'dfe-data-strategy': false,
  'brass-and-rails': true,
  'terminal-descent': true,
};

function item(over: Partial<FilterableItem> = {}): FilterableItem {
  return {
    kind: 'feature',
    impact: 'user-facing',
    title: 'Live network graph filter',
    summary: 'The network graph now supports a live filter over nodes and edges.',
    surfaces: ['/jkai'],
    ...over,
  };
}

describe('projectKeyOf', () => {
  it('extracts the slug from a /projects surface', () => {
    expect(projectKeyOf('/projects/policy-engine')).toBe('policy-engine');
    expect(projectKeyOf('/projects/policy-engine/monitor')).toBe('policy-engine');
  });

  it('returns null for non-project surfaces and route params', () => {
    expect(projectKeyOf('/jkai/canvas/[slug]')).toBeNull();
    expect(projectKeyOf('workflow engine')).toBeNull();
    expect(projectKeyOf('/projects/[slug]')).toBeNull();
  });
});

describe('isSurfacePublic', () => {
  it('allows public routes and prose capability labels', () => {
    expect(isSurfacePublic('/jkai', VIS)).toBe(true);
    expect(isSurfacePublic('/health', VIS)).toBe(true);
    expect(isSurfacePublic('workflow engine', VIS)).toBe(true);
    expect(isSurfacePublic('/projects/brass-and-rails', VIS)).toBe(true);
  });

  it('blocks admin and api routes wherever they appear in the path', () => {
    expect(isSurfacePublic('/admin', VIS)).toBe(false);
    expect(isSurfacePublic('/admin/ai/improvement', VIS)).toBe(false);
    expect(isSurfacePublic('/api/workflows/orchestrator/chat', VIS)).toBe(false);
  });

  it('blocks projects marked private, and only those', () => {
    expect(isSurfacePublic('/projects/policy-engine', VIS)).toBe(false);
    expect(isSurfacePublic('/projects/policy-engine/neet', VIS)).toBe(false);
    expect(isSurfacePublic('/projects/data-spine', VIS)).toBe(false);
    // Unknown key: absent from the map means public, matching isProjectPublic.
    expect(isSurfacePublic('/projects/broads-pilot', VIS)).toBe(true);
  });

  it('rejects empty surfaces', () => {
    expect(isSurfacePublic('   ', VIS)).toBe(false);
  });
});

describe('isItemPublic', () => {
  it('accepts a clean user-facing item', () => {
    expect(isItemPublic(item(), VIS)).toBe(true);
  });

  it('rejects internal items outright', () => {
    expect(isItemPublic(item({ impact: 'internal' }), VIS)).toBe(false);
  });

  it('rejects entries the summariser was not confident about', () => {
    expect(isItemPublic(item({ confidence: 'low' }), VIS)).toBe(false);
    expect(isItemPublic(item({ confidence: 'medium' }), VIS)).toBe(true);
    expect(isItemPublic(item({ confidence: 'high' }), VIS)).toBe(true);
    // Absent confidence must not be treated as low.
    expect(isItemPublic(item(), VIS)).toBe(true);
  });

  it('rejects items describing security mechanisms, however classified', () => {
    expect(
      isItemPublic(
        item({ title: 'Auth bypass extended for Tailscale clients and env flag' }),
        VIS,
      ),
    ).toBe(false);
    expect(
      isItemPublic(
        item({
          title: 'Harden OG image fetching',
          summary: 'Fixed the isSafeFetchUrl SSRF guard to strip trailing dots from hostnames.',
        }),
        VIS,
      ),
    ).toBe(false);
    expect(
      isItemPublic(item({ title: 'Encrypted credential vault for scraper credentials' }), VIS),
    ).toBe(false);
    expect(
      isItemPublic(
        item({ title: 'Admin page for API integrations and secrets' }),
        VIS,
      ),
    ).toBe(false);
  });

  it('rejects an item that touches any private surface, even alongside public ones', () => {
    expect(isItemPublic(item({ surfaces: ['/jkai', '/admin/ops/releases'] }), VIS)).toBe(false);
    expect(isItemPublic(item({ surfaces: ['/projects/policy-engine'] }), VIS)).toBe(false);
  });

  it('accepts an item with no surfaces when impact and text are clean', () => {
    expect(isItemPublic(item({ surfaces: [] }), VIS)).toBe(true);
  });
});

describe('isItemPublic — structural and infrastructure prose', () => {
  it('rejects prose naming source paths or filenames', () => {
    expect(
      isItemPublic(item({ summary: 'Components moved into src/lib/threlte/ for reuse.' }), VIS),
    ).toBe(false);
    expect(
      isItemPublic(item({ summary: 'The +layout.svelte gained a nav slot.' }), VIS),
    ).toBe(false);
    expect(isItemPublic(item({ summary: 'Updated app.css tokens.' }), VIS)).toBe(false);
  });

  it('rejects prose naming an /api path', () => {
    expect(
      isItemPublic(item({ summary: 'The Run button now POSTs /api/workflows/[id]/run.' }), VIS),
    ).toBe(false);
  });

  it('rejects prose naming environment variables', () => {
    expect(
      isItemPublic(item({ summary: 'Reads CURATE_WORKSPACE_DIR for the worktree target.' }), VIS),
    ).toBe(false);
    expect(isItemPublic(item({ summary: 'Uses PUBLIC_SITE_URL in the OG tag.' }), VIS)).toBe(false);
  });

  it('does not mistake ordinary acronyms for environment variables', () => {
    expect(isItemPublic(item({ summary: 'Improved SSR and API latency in the UK region.' }), VIS)).toBe(
      true,
    );
  });

  it('rejects prose naming hosts, tunnels or daemons', () => {
    expect(isItemPublic(item({ summary: 'Runs on homeserv behind cloudflared.' }), VIS)).toBe(false);
    expect(isItemPublic(item({ summary: 'Extended to Tailscale clients.' }), VIS)).toBe(false);
    expect(isItemPublic(item({ summary: 'Spawns a docker sandbox.' }), VIS)).toBe(false);
  });
});

describe('isSurfacePublic — non-route labels', () => {
  it('allows a short human label', () => {
    expect(isSurfacePublic('workflow engine', VIS)).toBe(true);
    expect(isSurfacePublic('Hero section', VIS)).toBe(true);
  });

  it('rejects a file masquerading as a surface', () => {
    expect(isSurfacePublic('src/app.d.ts', VIS)).toBe(false);
    expect(isSurfacePublic('robots.txt', VIS)).toBe(false);
    expect(isSurfacePublic('/jkai/+layout.server.ts', VIS)).toBe(false);
  });

  it('rejects an over-long prose label', () => {
    expect(isSurfacePublic('a'.repeat(41), VIS)).toBe(false);
  });

  it('fails closed on a drifted project slug', () => {
    // The row is keyed compound-interest-calculator; the surface says
    // /projects/compound-interest/. An exact miss must not read as public.
    expect(isSurfacePublic('/projects/compound-interest/', { 'compound-interest-calculator': false })).toBe(
      false,
    );
  });
});

describe('publicItems', () => {
  it('keeps only the safe subset', () => {
    const list = [
      item({ title: 'Public feature A' }),
      item({ impact: 'internal', title: 'Internal B' }),
      item({ title: 'C', surfaces: ['/admin'] }),
      item({ title: 'Rotate the API key' }),
    ];
    expect(publicItems(list, VIS).map((i) => i.title)).toEqual(['Public feature A']);
  });
});

describe('redactItem', () => {
  it('drops impact and re-filters surfaces', () => {
    const out = redactItem(item({ surfaces: ['/jkai', '/admin/ops', '/projects/policy-engine'] }), VIS);
    expect(out.surfaces).toEqual(['/jkai']);
    expect(out).not.toHaveProperty('impact');
  });

  it('never emits file paths or commit shas', () => {
    const withEvidence = {
      ...item(),
      files: ['src/lib/db/schema.ts'],
      commits: ['deadbee'],
    };
    const out = redactItem(withEvidence, VIS);
    expect(JSON.stringify(out)).not.toContain('schema.ts');
    expect(JSON.stringify(out)).not.toContain('deadbee');
  });
});
