export const HERO_SLOTS = [
  { id: 'default', label: 'Default' },
  { id: 'weekday-inactive', label: 'Weekday · Inactive' },
  { id: 'weekday-average', label: 'Weekday · Averagely active' },
  { id: 'weekday-very-active', label: 'Weekday · Very active' },
  { id: 'weekend-inactive', label: 'Weekend · Inactive' },
  { id: 'weekend-average', label: 'Weekend · Averagely active' },
  { id: 'weekend-very-active', label: 'Weekend · Very active' },
] as const;
export type HeroSlot = typeof HERO_SLOTS[number]['id'];
export function isHeroSlot(value: unknown): value is HeroSlot {
  return HERO_SLOTS.some(slot => slot.id === value);
}
export interface HeroActivityRules { averageSteps: number; veryActiveSteps: number }
export const HERO_ACTIVITY_DEFAULTS: HeroActivityRules = { averageSteps: 3000, veryActiveSteps: 10000 };
export const heroSlotLabel = (id: HeroSlot) => HERO_SLOTS.find(slot => slot.id === id)!.label;
