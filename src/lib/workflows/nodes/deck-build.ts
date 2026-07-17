import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { slugify } from '$lib/canvas/slug';

export { deckBuildDef } from './deck-build.def';

/**
 * Deep-interpolate {{input.*}} into every string leaf of the spec. Non-string
 * leaves are walked but passed through unchanged so the tool still receives real
 * arrays/numbers. ({{state.*}} / {{today}} / {{now}} are resolved by the engine
 * before this executor runs.)
 */
function interpolateDeep(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') return interpolateTemplate(value, input);
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, input));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, input);
    }
    return out;
  }
  return value;
}

/** Coerce the spec config (JSON string or object) into a slides array. */
function resolveSlides(specConfig: unknown): unknown[] {
  let parsed: unknown = specConfig;
  if (typeof specConfig === 'string') {
    const trimmed = specConfig.trim();
    if (!trimmed) throw new Error('deck-build: spec is empty — provide a JSON array of slides.');
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`deck-build: spec is not valid JSON — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const slides = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as { slides?: unknown }).slides
      : undefined;
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error('deck-build: spec must resolve to a non-empty array of slides (or an object with a `slides` array).');
  }
  return slides;
}

export const deckBuildExecutor: NodeExecutor = {
  type: 'deck-build',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const title = interpolateTemplate(String(config.title ?? ''), input).trim();
    if (!title) {
      throw new Error('deck-build: title is required (supports {{input.field}} templates)');
    }
    const description = interpolateTemplate(String(config.description ?? ''), input).trim();
    const slides = (interpolateDeep(resolveSlides(config.spec), input) as unknown[]);
    const isPublic = config.isPublic === true;
    const wantShare = config.share !== false;

    // DRY RUN: never persist a deck. Return a simulated result so wiring can be
    // verified without creating anything.
    if (context.dryRun) {
      const slug = slugify(title) || 'deck';
      const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
      const url = `${baseUrl}/decks/${slug}`;
      return {
        output: {
          dryRun: true,
          deckId: 'dry-run',
          slug,
          url,
          ...(wantShare ? { shareUrl: `${url}?t=dry-run` } : {}),
          slideCount: slides.length,
        },
        rowCount: 1,
        metadata: { dryRun: true },
      };
    }

    // Lazy dynamic import — the site-tools registry pulls server-only domain
    // modules and MUST NOT be imported at module-init time (circular-init hazard).
    const { getTool } = await import('$lib/workflows/site-tools/registry');
    const tool = getTool('presentation_build_from_spec');
    if (!tool) {
      throw new Error('deck-build: presentation_build_from_spec tool is not registered.');
    }

    // Bridge the tool's progress-emit onto the workflow event stream as a log.
    const toolCtx = {
      emit: (text: string) => {
        context.emit({
          type: 'log',
          runId: context.runId,
          nodeId: context._currentNodeId,
          data: { message: text, source: 'deck-build' },
          timestamp: new Date().toISOString(),
        });
      },
    };

    const result = await tool.handler(
      {
        title,
        ...(description ? { description } : {}),
        is_public: isPublic,
        slides,
      },
      toolCtx,
    );

    if (!result.success) {
      // Route through the node error path so the node's On-failure config governs.
      throw new Error(result.error || 'deck-build: presentation_build_from_spec failed');
    }

    const data = (result.data ?? {}) as {
      deckId?: string;
      slug?: string;
      url?: string;
      shareUrl?: string;
      slideCount?: number;
      summaryMarkdown?: string;
    };

    return {
      output: {
        deckId: data.deckId,
        slug: data.slug,
        url: data.url,
        ...(wantShare ? { shareUrl: data.shareUrl } : {}),
        slideCount: data.slideCount,
        summaryMarkdown: data.summaryMarkdown,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in the title and spec' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        deckId: { type: 'string' },
        slug: { type: 'string' },
        url: { type: 'string', description: 'Absolute deck URL (https://strangeramblings.com/decks/<slug>)' },
        shareUrl: { type: 'string', description: 'View-granting share link (when share=true)' },
        slideCount: { type: 'number' },
        summaryMarkdown: { type: 'string', description: 'Human-readable build summary from the tool' },
        dryRun: { type: 'boolean', description: 'true only on a dry run (no deck created)' },
      },
    };
  },
};
