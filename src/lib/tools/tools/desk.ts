// src/lib/tools/tools/desk.ts
// `show_in_panel`: the model lays out the /jkai desk page for its answer.
//
// The desk is the right-hand half of /jkai (SR-Jkai-Core). Tool results are
// projected onto it automatically; this tool is for when the MODEL knows the
// shape best — a comparison, a trip, a decision — and wants the page to lead
// with its own layout. Core reads the returned page and draws it above the
// projected blocks.
//
// The page is validated here against the block schema Core draws with
// (`$lib/jkai/panel/schema`, shared byte for byte via shared-with-extracted),
// so the model gets told which blocks were dropped and why in the same turn,
// and can fix them, rather than the desk silently showing less.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { MODEL_ACTION_KINDS, panelBlockSchema, type PanelBlock } from '$lib/jkai/panel/schema';

const BLOCK_TYPES = [
  'figures', 'series', 'bars', 'heat', 'rows', 'table', 'timeline', 'kv', 'prose', 'actions', 'group',
] as const;

const MAX_SECTIONS = 8;
const MAX_BLOCKS = 24;

interface Dropped {
  section: number;
  block: number;
  id: string;
  reason: string;
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

/**
 * A model-written page may only carry `link` and `ask` buttons: a button that
 * posts to the site's API, written by a model that may have just read a
 * hostile page, is a prompt-injection route. Returns why it refused, or null.
 */
function refusedAction(block: PanelBlock): string | null {
  const kinds = block.type === 'actions'
    ? block.items.map((a) => a.kind)
    : block.type === 'group'
      ? block.blocks.flatMap((b) => (b.type === 'actions' ? b.items.map((a) => a.kind) : []))
      : [];
  const bad = kinds.find((k) => !MODEL_ACTION_KINDS.has(k));
  return bad ? `action kind "${bad}" is not allowed; use "ask" or "link"` : null;
}

function issueText(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || 'block'}: ${i.message}`)
    .join('; ');
}

register({
  name: 'show_in_panel',
  description:
    'Lay out the desk (the panel beside the chat) for this answer as sections of blocks. Use it when the answer is a comparison, plan, itinerary, briefing or decision that reads better as structure than prose; then keep the chat reply short and say it is on the desk. Not for casual replies or a single figure. Sources, mail, calendar and charts from other tools already appear on the desk; your page leads above them. Calling it again replaces your previous page.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page headline, ≤60 chars, e.g. "Rome, 26–30 October".' },
      kicker: { type: 'string', description: 'Optional short label above the title (default "Laid out by jkai").' },
      standfirst: { type: 'string', description: 'Optional one-line summary under the title.' },
      sections: {
        type: 'array',
        description: 'Ordered sections, each a short mono label over a 12-column grid of blocks.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string', description: 'e.g. "At a glance", "The choice".' },
            blocks: {
              type: 'array',
              description:
                'Every block: id, type, optional span (12|8|6|4, default 12), title, note, foot (title or foot draws it as a card). ' +
                'figures{items:[{label,value,unit?,delta?,direction?:up|down|flat,spark?:number[]}]} max 6 · ' +
                'series{series:[{key,label,points:[{x,y}]}],zero?:bool,unit?} · ' +
                'bars{rows:[{id,label,value,display?,highlight?}]} · ' +
                'heat{columns:[...],rows:[{label,values:[number|null]}]} · ' +
                'rows{rows:[{id,title,sub?,meta?,href?}],numbered?} · ' +
                'table{columns:[...],rows:[[cell,...]],pick?:column index to highlight} · ' +
                'timeline{events:[{id,when,what,sub?,hot?}]} · ' +
                'kv{items:[{label,value}]} · prose{markdown} · ' +
                'actions{items:[{id,label,kind:"ask",ask:{label,detail}} | {id,label,kind:"link",href}]} · ' +
                'group{blocks:[...]} nests one level. hrefs: https:// or a /site path.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: [...BLOCK_TYPES] },
                  span: { type: 'integer', enum: [12, 8, 6, 4] },
                  title: { type: 'string' },
                },
                required: ['id', 'type'],
                additionalProperties: true,
              },
            },
          },
          required: ['blocks'],
        },
      },
    },
    required: ['title', 'sections'],
  },
  handler: async (args): Promise<ToolResult> => {
    const title = str(args.title, 120);
    if (!title) return { success: false, error: 'title is required' };
    if (!Array.isArray(args.sections) || args.sections.length === 0) {
      return { success: false, error: 'sections must be a non-empty array' };
    }

    const dropped: Dropped[] = [];
    const sections: Array<{ id: string; label: string; blocks: PanelBlock[] }> = [];
    let kept = 0;

    for (const [si, raw] of (args.sections as unknown[]).slice(0, MAX_SECTIONS).entries()) {
      const sec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const blocks: PanelBlock[] = [];
      for (const [bi, rawBlock] of (Array.isArray(sec.blocks) ? sec.blocks : []).entries()) {
        const id = String((rawBlock as Record<string, unknown> | null)?.id ?? `#${bi}`);
        if (kept >= MAX_BLOCKS) {
          dropped.push({ section: si, block: bi, id, reason: `page is full (${MAX_BLOCKS} blocks)` });
          continue;
        }
        const parsed = panelBlockSchema.safeParse(rawBlock);
        if (!parsed.success) {
          dropped.push({ section: si, block: bi, id, reason: issueText(parsed.error) });
          continue;
        }
        const refused = refusedAction(parsed.data);
        if (refused) {
          dropped.push({ section: si, block: bi, id, reason: refused });
          continue;
        }
        blocks.push(parsed.data);
        kept++;
      }
      if (blocks.length) sections.push({ id: str(sec.id, 50) ?? String(si), label: str(sec.label, 60) ?? '', blocks });
    }

    if (kept === 0) {
      return {
        success: false,
        error: `No block was valid, so nothing was drawn. ${dropped.map((d) => `${d.id}: ${d.reason}`).join(' | ')}`.slice(0, 2000),
      };
    }

    const head = {
      title,
      ...(str(args.kicker, 60) ? { kicker: str(args.kicker, 60) } : {}),
      ...(str(args.standfirst, 240) ? { standfirst: str(args.standfirst, 240) } : {}),
    };
    const summary = dropped.length
      ? `Desk page "${title}": ${kept} block(s) drawn, ${dropped.length} dropped — fix and call again if they matter.`
      : `Desk page "${title}": ${kept} block(s) in ${sections.length} section(s) drawn.`;
    return { success: true, data: { panel: { head, sections }, summary, dropped } };
  },
});
