import { describe, it, expect } from 'vitest';
import {
  oauthTokens,
  stravaActivities,
  whoopWorkouts,
  whoopSleep,
  whoopRecovery,
  whoopCycles,
  healthSyncState,
  appleHealthMetrics,
} from '$lib/db/schema';

describe('health database schema', () => {
  describe('oauthTokens', () => {
    it('has expected columns', () => {
      expect(oauthTokens.id).toBeDefined();
      expect(oauthTokens.service).toBeDefined();
      expect(oauthTokens.refreshToken).toBeDefined();
      expect(oauthTokens.accessToken).toBeDefined();
      expect(oauthTokens.expiresAt).toBeDefined();
      expect(oauthTokens.createdAt).toBeDefined();
      expect(oauthTokens.updatedAt).toBeDefined();
    });
  });

  describe('stravaActivities', () => {
    it('has expected core columns', () => {
      expect(stravaActivities.id).toBeDefined();
      expect(stravaActivities.name).toBeDefined();
      expect(stravaActivities.type).toBeDefined();
      expect(stravaActivities.sportType).toBeDefined();
      expect(stravaActivities.startDate).toBeDefined();
      expect(stravaActivities.startDateLocal).toBeDefined();
      expect(stravaActivities.timezone).toBeDefined();
    });

    it('has metric columns', () => {
      expect(stravaActivities.distance).toBeDefined();
      expect(stravaActivities.movingTime).toBeDefined();
      expect(stravaActivities.elapsedTime).toBeDefined();
      expect(stravaActivities.totalElevationGain).toBeDefined();
      expect(stravaActivities.averageSpeed).toBeDefined();
      expect(stravaActivities.maxSpeed).toBeDefined();
    });

    it('has heart rate columns', () => {
      expect(stravaActivities.averageHeartrate).toBeDefined();
      expect(stravaActivities.maxHeartrate).toBeDefined();
    });

    it('has map data columns', () => {
      expect(stravaActivities.mapData).toBeDefined();
      expect(stravaActivities.startLatLng).toBeDefined();
      expect(stravaActivities.endLatLng).toBeDefined();
    });

    it('has sync metadata', () => {
      expect(stravaActivities.syncedAt).toBeDefined();
    });
  });

  describe('whoopWorkouts', () => {
    it('has expected core columns', () => {
      expect(whoopWorkouts.id).toBeDefined();
      expect(whoopWorkouts.userId).toBeDefined();
      expect(whoopWorkouts.startDate).toBeDefined();
      expect(whoopWorkouts.endDate).toBeDefined();
      expect(whoopWorkouts.startDateLocal).toBeDefined();
      expect(whoopWorkouts.timezone).toBeDefined();
      expect(whoopWorkouts.sportId).toBeDefined();
      expect(whoopWorkouts.sportName).toBeDefined();
    });

    it('has metric columns', () => {
      expect(whoopWorkouts.strain).toBeDefined();
      expect(whoopWorkouts.averageHeartrate).toBeDefined();
      expect(whoopWorkouts.maxHeartrate).toBeDefined();
      expect(whoopWorkouts.kilojoule).toBeDefined();
      expect(whoopWorkouts.distanceMeters).toBeDefined();
      expect(whoopWorkouts.altitudeGainMeters).toBeDefined();
    });

    it('has all 6 zone duration columns', () => {
      expect(whoopWorkouts.zoneZero).toBeDefined();
      expect(whoopWorkouts.zoneOne).toBeDefined();
      expect(whoopWorkouts.zoneTwo).toBeDefined();
      expect(whoopWorkouts.zoneThree).toBeDefined();
      expect(whoopWorkouts.zoneFour).toBeDefined();
      expect(whoopWorkouts.zoneFive).toBeDefined();
    });
  });

  describe('whoopSleep', () => {
    it('has expected core columns', () => {
      expect(whoopSleep.id).toBeDefined();
      expect(whoopSleep.userId).toBeDefined();
      expect(whoopSleep.startDate).toBeDefined();
      expect(whoopSleep.endDate).toBeDefined();
      expect(whoopSleep.startDateLocal).toBeDefined();
      expect(whoopSleep.nap).toBeDefined();
    });

    it('has sleep stage columns', () => {
      expect(whoopSleep.totalInBed).toBeDefined();
      expect(whoopSleep.totalAwake).toBeDefined();
      expect(whoopSleep.totalLight).toBeDefined();
      expect(whoopSleep.totalSlowWave).toBeDefined();
      expect(whoopSleep.totalRem).toBeDefined();
      expect(whoopSleep.sleepCycleCount).toBeDefined();
      expect(whoopSleep.disturbanceCount).toBeDefined();
    });

    it('has sleep need columns', () => {
      expect(whoopSleep.baselineNeed).toBeDefined();
      expect(whoopSleep.needFromDebt).toBeDefined();
      expect(whoopSleep.needFromStrain).toBeDefined();
      expect(whoopSleep.needFromNap).toBeDefined();
    });

    it('has performance metric columns', () => {
      expect(whoopSleep.respiratoryRate).toBeDefined();
      expect(whoopSleep.sleepPerformance).toBeDefined();
      expect(whoopSleep.sleepConsistency).toBeDefined();
      expect(whoopSleep.sleepEfficiency).toBeDefined();
    });
  });

  describe('whoopRecovery', () => {
    it('has expected columns', () => {
      expect(whoopRecovery.id).toBeDefined();
      expect(whoopRecovery.cycleId).toBeDefined();
      expect(whoopRecovery.sleepId).toBeDefined();
      expect(whoopRecovery.userId).toBeDefined();
      expect(whoopRecovery.createdDate).toBeDefined();
    });

    it('has recovery metric columns', () => {
      expect(whoopRecovery.recoveryScore).toBeDefined();
      expect(whoopRecovery.restingHeartRate).toBeDefined();
      expect(whoopRecovery.hrvRmssd).toBeDefined();
      expect(whoopRecovery.spo2).toBeDefined();
      expect(whoopRecovery.skinTemp).toBeDefined();
    });
  });

  describe('whoopCycles', () => {
    it('has expected columns', () => {
      expect(whoopCycles.id).toBeDefined();
      expect(whoopCycles.userId).toBeDefined();
      expect(whoopCycles.startDate).toBeDefined();
      expect(whoopCycles.endDate).toBeDefined();
      expect(whoopCycles.startDateLocal).toBeDefined();
      expect(whoopCycles.timezone).toBeDefined();
      expect(whoopCycles.strain).toBeDefined();
      expect(whoopCycles.kilojoule).toBeDefined();
      expect(whoopCycles.averageHeartrate).toBeDefined();
      expect(whoopCycles.maxHeartrate).toBeDefined();
    });
  });

  describe('healthSyncState', () => {
    it('has expected columns', () => {
      expect(healthSyncState.id).toBeDefined();
      expect(healthSyncState.service).toBeDefined();
      expect(healthSyncState.lastSyncAt).toBeDefined();
      expect(healthSyncState.lastSuccessfulSyncAt).toBeDefined();
      expect(healthSyncState.status).toBeDefined();
      expect(healthSyncState.errorMessage).toBeDefined();
      expect(healthSyncState.recordsSynced).toBeDefined();
    });
  });

  describe('appleHealthMetrics', () => {
    it('has expected columns', () => {
      expect(appleHealthMetrics.id).toBeDefined();
      expect(appleHealthMetrics.metricName).toBeDefined();
      expect(appleHealthMetrics.date).toBeDefined();
      expect(appleHealthMetrics.dateLocal).toBeDefined();
      expect(appleHealthMetrics.value).toBeDefined();
      expect(appleHealthMetrics.minValue).toBeDefined();
      expect(appleHealthMetrics.maxValue).toBeDefined();
      expect(appleHealthMetrics.units).toBeDefined();
      expect(appleHealthMetrics.syncedAt).toBeDefined();
    });
  });
});
