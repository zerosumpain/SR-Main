export interface BiomeSettings {
  // Particle system
  particleDensity: number;           // 0.1-5.0 (multiplier on count)
  particleSize: number;              // 0.1-5.0 (multiplier on base size)
  particleOpacity: number;           // 0-200 (percentage of base opacity)

  // Pulse / heartbeat
  pulseEnabled: boolean;
  pulseIntensity: number;            // 0-200

  // Fog
  fogEnabled: boolean;
  fogIntensity: number;              // 0-5.0

  // Weather
  weatherEnabled: boolean;
  weatherIntensity: number;          // 0-200

  // Connection lines
  connectionLinesEnabled: boolean;
  connectionLineOpacity: number;     // 0-200

  // Dream mode
  dreamMode: boolean;

  // Blood vessel flow
  bloodVesselEnabled: boolean;
  bloodVesselSpeed: number;          // 0-200 (flow speed multiplier as %)
  bloodVesselSurge: number;          // 0-200 (heartbeat surge intensity as %)

  // Shudder
  shudderEnabled: boolean;
  shudderIntensity: number;          // 0-200

  // Combination amplification
  combinationEnabled: boolean;
  combinationStrength: number;       // 0-200 (how much strain×pulse amplifies)

  // Wind
  windEnabled: boolean;
  windMultiplier: number;            // 0-500 (percentage of real wind speed)
}

export const BIOME_SETTINGS_DEFAULTS: BiomeSettings = {
  particleDensity: 1.0,
  particleSize: 1.0,
  particleOpacity: 100,

  pulseEnabled: true,
  pulseIntensity: 100,

  fogEnabled: true,
  fogIntensity: 1.0,

  weatherEnabled: true,
  weatherIntensity: 100,

  connectionLinesEnabled: true,
  connectionLineOpacity: 100,

  dreamMode: true,

  bloodVesselEnabled: false,
  bloodVesselSpeed: 100,
  bloodVesselSurge: 100,

  shudderEnabled: true,
  shudderIntensity: 100,

  combinationEnabled: true,
  combinationStrength: 100,

  windEnabled: true,
  windMultiplier: 100,
};
