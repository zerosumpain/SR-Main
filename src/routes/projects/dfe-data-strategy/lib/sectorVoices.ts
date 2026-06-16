// sectorVoices.ts — "voices from the system": what the sector is saying, as helpful
// background. Populated from the keystone-sector-voices research workflow (Schools Week,
// Civil Service World, LAs/ADCS/LGA, MATs/CST, third sector & safeguarding). Faithfully
// paraphrased, cited. (Seeded below; the research pass expands/verifies it.)

export type VoiceGroup = 'local-authorities' | 'mats' | 'third-sector' | 'press' | 'central';
export type Stance = 'supportive' | 'cautious' | 'critical' | 'mixed';

export interface SectorVoice {
  id: string;
  who: string;
  role?: string;
  group: VoiceGroup;
  stance: Stance;
  point: string;
  sourceName?: string;
  sourceUrl?: string;
  theme?: string;
}

export interface SectorTheme {
  id: string;
  title: string;
  summary: string;
}

export const VOICE_GROUP_META: Record<VoiceGroup, { label: string; blurb: string; color: string }> = {
  'local-authorities': { label: 'Local authorities', blurb: 'Councils, ADCS, LGA — the bodies that run children’s services and carry the safeguarding duty.', color: '#2f6f97' },
  mats: { label: 'Multi-academy trusts', blurb: 'Trusts and the Confederation of School Trusts — the consolidating delivery layer.', color: '#2f6155' },
  'third-sector': { label: 'Third sector & civil society', blurb: 'Children’s charities, safeguarding bodies and privacy campaigners.', color: '#7a5aa6' },
  press: { label: 'Sector press', blurb: 'Schools Week and Civil Service World — the trade-press read on what’s deliverable.', color: '#b4632e' },
  central: { label: 'Centre & watchdogs', blurb: 'Government, the NAO/PAC and the ICO — the view from the middle.', color: '#8a2d3a' },
};

export const STANCE_META: Record<Stance, { label: string; color: string }> = {
  supportive: { label: 'Supportive', color: '#2f7d4f' },
  cautious: { label: 'Cautious', color: '#9a7b1f' },
  critical: { label: 'Critical', color: '#b1455e' },
  mixed: { label: 'Mixed', color: '#3a5fa8' },
};

// Populated by the research reconciliation pass.
export const SECTOR_THEMES: SectorTheme[] = [];
export const SECTOR_VOICES: SectorVoice[] = [];
export const SECTOR_BACKGROUND: Record<string, string[]> = {};

export const VOICES_BY_GROUP = (): Record<VoiceGroup, SectorVoice[]> => ({
  'local-authorities': SECTOR_VOICES.filter((v) => v.group === 'local-authorities'),
  mats: SECTOR_VOICES.filter((v) => v.group === 'mats'),
  'third-sector': SECTOR_VOICES.filter((v) => v.group === 'third-sector'),
  press: SECTOR_VOICES.filter((v) => v.group === 'press'),
  central: SECTOR_VOICES.filter((v) => v.group === 'central'),
});
