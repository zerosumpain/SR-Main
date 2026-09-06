export interface HeroBackgroundSettings {
  enabled: boolean;
  delayMs: number;
  playbackRate: number;
  holdMs: number;
  fadeMs: number;
  playingOpacity: number;
  finalTransparency: number;
  overlayTitle: boolean;
  fit: 'cover' | 'contain';
  positionX: number;
  positionY: number;
}

export const HERO_BACKGROUND_DEFAULTS: HeroBackgroundSettings = {
  enabled: true, delayMs: 0, playbackRate: 1, holdMs: 1000, fadeMs: 4000,
  playingOpacity: 100, finalTransparency: 80, overlayTitle: true,
  fit: 'cover', positionX: 50, positionY: 50,
};

export interface HeroBackgroundAsset {
  desktop: string;
  mobile: string;
  poster: string;
  duration: number;
  desktopBytes: number;
  mobileBytes: number;
}
