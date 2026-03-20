export interface BiomeSettings {
  pulseIntensity: number;        // 0-100
  particleDensity: number;       // 0.5-2.0
  fogIntensity: number;          // 0.5-2.0
  weatherEffects: boolean;
  connectionLines: boolean;
  dreamMode: boolean;
  bloodVessel: boolean;
  bloodFlowRate: number;         // 0-100
  shudderEffect: boolean;
  combinationEffects: boolean;
}

export const BIOME_SETTINGS_DEFAULTS: BiomeSettings = {
  pulseIntensity: 100,
  particleDensity: 1.0,
  fogIntensity: 1.0,
  weatherEffects: true,
  connectionLines: true,
  dreamMode: true,
  bloodVessel: false,
  bloodFlowRate: 50,
  shudderEffect: true,
  combinationEffects: true,
};
