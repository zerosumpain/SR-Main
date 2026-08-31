import { z } from 'zod';

export const contextLensSchema = z.enum(['general', 'intel', 'research', 'health', 'daydream']);
export type ContextLens = z.infer<typeof contextLensSchema>;

const baseCard = {
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  href: z.string().optional(),
};

export const metricCardSchema = z.object({
  ...baseCard,
  type: z.literal('metrics'),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    detail: z.string().optional(),
    tone: z.enum(['default', 'good', 'warn', 'bad']).optional(),
  })).max(6),
});

export const seriesCardSchema = z.object({
  ...baseCard,
  type: z.literal('series'),
  unit: z.string().optional(),
  series: z.array(z.object({
    key: z.string(),
    label: z.string(),
    colour: z.string().optional(),
    points: z.array(z.object({ x: z.string(), y: z.number().finite() })).max(366),
  })).min(1).max(3),
});

export const barsCardSchema = z.object({
  ...baseCard,
  type: z.literal('bars'),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    value: z.number().finite().nonnegative(),
    display: z.string().optional(),
    href: z.string().optional(),
  })).max(12),
});

export const linksCardSchema = z.object({
  ...baseCard,
  type: z.literal('links'),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    meta: z.string().optional(),
    note: z.string().optional(),
    href: z.string().optional(),
  })).max(12),
});

export const noteCardSchema = z.object({
  ...baseCard,
  type: z.literal('note'),
  body: z.string(),
  tone: z.enum(['default', 'warn']).default('default'),
});

export const contextCardSchema = z.discriminatedUnion('type', [
  metricCardSchema,
  seriesCardSchema,
  barsCardSchema,
  linksCardSchema,
  noteCardSchema,
]);
export type ContextCard = z.infer<typeof contextCardSchema>;

export const contextPanelSchema = z.object({
  revision: z.string(),
  selectedLens: contextLensSchema,
  automaticLens: contextLensSchema,
  focus: z.object({ label: z.string(), reason: z.string() }),
  lenses: z.array(z.object({
    id: contextLensSchema,
    score: z.number().min(0).max(1),
    reason: z.string(),
  })),
  cards: z.array(contextCardSchema).max(8),
});

export type ContextPanel = z.infer<typeof contextPanelSchema>;
