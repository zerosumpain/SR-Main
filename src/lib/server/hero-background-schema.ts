import { z } from 'zod';
import { HERO_BACKGROUND_DEFAULTS as d } from '$lib/constants/hero-background';

export const heroBackgroundSchema = z.object({
  enabled: z.boolean().default(d.enabled),
  delayMs: z.number().int().min(0).max(10000).default(d.delayMs),
  playbackRate: z.number().min(0.25).max(2).default(d.playbackRate),
  holdMs: z.number().int().min(0).max(15000).default(d.holdMs),
  fadeMs: z.number().int().min(0).max(15000).default(d.fadeMs),
  playingOpacity: z.number().int().min(0).max(100).default(d.playingOpacity),
  finalTransparency: z.number().int().min(0).max(100).default(d.finalTransparency),
  overlayTitle: z.boolean().default(d.overlayTitle),
  fit: z.enum(['cover', 'contain']).default(d.fit),
  positionX: z.number().int().min(0).max(100).default(d.positionX),
  positionY: z.number().int().min(0).max(100).default(d.positionY),
}).strict();
