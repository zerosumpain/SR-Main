// Registry of interactives a deck slide may embed. Allowlist by design: the
// LLM/editor can only reference what's here, and each entry's config is
// validated by its own zod schema. Render mapping lives client-side in
// $lib/components/presentation/blocks/Embed.svelte (dynamic import keeps
// Three.js out of the deck bundle until an embed slide mounts).

import { z } from 'zod';

export interface EmbedDef {
  label: string;
  /** One-liner surfaced to the LLM via BLOCK_DOCS. */
  doc: string;
  configSchema: z.ZodTypeAny;
}

export const EMBEDS: Record<string, EmbedDef> = {
  'federation-sim': {
    label: 'Retired federation simulator',
    doc: 'A retired interactive retained only so existing decks remain readable.',
    configSchema: z.object({
      scenario: z.string().optional(),
      autoplay: z.boolean().optional(),
    }).strict(),
  },
};
