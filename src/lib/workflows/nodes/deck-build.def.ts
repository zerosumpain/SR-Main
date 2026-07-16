import type { NodeDefinition } from '../types';

/**
 * Publish workflow results as an sr. decks presentation. Wraps the NON-destructive
 * `presentation_build_from_spec` site tool (builds a NEW deck — never the
 * destructive update tool). The tool does all block/layout/fit validation and
 * mints a share link; this node reuses it rather than reimplementing. dryRun
 * never creates a deck.
 */
export const deckBuildDef: NodeDefinition = {
  type: 'deck-build',
  label: 'Deck build (presentation)',
  category: 'integration',
  description:
    'Publish workflow results as an sr. decks presentation (/decks/<slug>) from a block-deck spec. Returns the deck url + share link so a downstream whatsapp/email node can send it.',
  configSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Deck title (slugified for the URL). Supports {{input.field}} / {{state.KEY}} templates.',
      },
      description: {
        type: 'string',
        description: 'One-line deck description. Template-supported.',
      },
      spec: {
        type: 'string',
        description:
          'The block-deck spec: a JSON array of slides (or an object with a `slides` array). Each slide { title, layout?, blocks: Block[], notes?, journey_label?, children? }. String leaves support {{input.*}} templates.',
      },
      share: { type: 'boolean', description: 'Surface a view-granting share link in the output (default true).' },
      isPublic: { type: 'boolean', description: 'Publish the deck publicly at once (default false — private + share link).' },
    },
    required: ['title', 'spec'],
  },
  defaultConfig: { title: '', description: '', spec: '[]', share: true, isPublic: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Deck' }],
  basicConfig: [
    {
      key: 'title',
      label: 'Title',
      type: 'template-textarea',
      placeholder: 'Weekly Briefing — {{today}}',
      description: 'Deck title. Supports {{input.field}} / {{today}} templates.',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'text',
      placeholder: 'One-line summary of the deck',
      description: 'Optional one-line description. Template-supported.',
    },
    {
      key: 'spec',
      label: 'Slides spec (JSON)',
      type: 'code',
      language: 'json',
      description: 'A JSON array of slides (or { slides: [...] }). String leaves support {{input.*}} templates.',
      cheatsheet: [
        'slide: { title, layout?, blocks: Block[], notes?, journey_label?, children? }',
        'block: { type, ...props } — e.g. { "type": "heading", "text": "..." }',
        'each slide is a fixed 1280×720 page; overfull specs are rejected with fit feedback',
      ],
    },
    { key: 'share', label: 'Include share link', type: 'toggle', description: 'Return a view-granting share URL in the output.' },
    { key: 'isPublic', label: 'Publish publicly', type: 'toggle', description: 'Make the deck public immediately (default private).' },
  ],
  summarize: (config) => {
    const title = String(config.title ?? '').trim();
    return {
      line: title ? `Build deck "${title}"` : 'Build a presentation deck (set a title + spec)',
      preview: { kind: 'db', details: { Title: title || '—', Visibility: config.isPublic ? 'public' : 'private' } },
    };
  },
  llmDescription:
    "Publish workflow results as a presentation deck; send the returned url via whatsapp/email downstream. Wraps presentation_build_from_spec (builds a NEW /decks/<slug> deck — non-destructive; it does NOT overwrite existing decks). Config: `title` (template), optional `description`, `spec` (a JSON array of slides, or an object with a `slides` array — string leaves support {{input.*}} templates), `share` (return a share link, default true), `isPublic` (publish publicly, default false). Output: { deckId, slug, url, shareUrl?, slideCount, summaryMarkdown }. The url is absolute (https://strangeramblings.com/decks/<slug>) — feed url/shareUrl into a whatsapp or email node to deliver it. Each slide is a fixed 1280×720 page; the tool validates blocks/layout/fit and REJECTS an overfull spec (the node then errors with fit feedback). Build the slide blocks upstream (e.g. an llm-call that emits the JSON) or hand-write the spec. Under a dry run this node NEVER creates a deck — it returns a simulated { dryRun: true, slug, url }.",
  llmExamples: [
    {
      title: 'Weekly Briefing — {{today}}',
      description: 'Top stories this week',
      spec: [
        { title: 'This Week', layout: 'default', blocks: [{ type: 'heading', text: 'Weekly Briefing' }] },
        { title: 'Headlines', layout: 'default', blocks: [{ type: 'markdown', md: '{{input.summary}}' }] },
      ],
      share: true,
      isPublic: false,
    },
  ],
};
