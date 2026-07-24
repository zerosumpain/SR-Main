// GET /api/broads/current
// Returns the current Broads speed journey data for the web dashboard.
// Reads from the broads_speed datastore collection (shared by the sampler workflow).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRecordByKey } from '$lib/datastore';

const COLLECTION = 'broads_speed';
const ACTOR = 'jkai';

interface Sample {
  ts: string;
  mph: number;
  kn: number;
  lat?: number;
  lng?: number;
}

interface LastFix {
  lat: number;
  lng: number;
  rawSpeed: number;
}

interface RollingWindow {
  samples: Sample[];
  lastFix: LastFix | null;
}

interface Journey {
  startTime: string;
  endTime: string | null;
  durationMinutes: number;
  avgMph: number;
  maxMph: number;
  avgKn: number;
  sampleCount: number;
  samples: Sample[];
  isActive: boolean;
}

export const GET: RequestHandler = async () => {
  try {
    const record = await getRecordByKey(COLLECTION, 'current_window', ACTOR);
    const window = record.data as unknown as RollingWindow;
    const now = new Date();

    const samples = (window.samples ?? []) as Sample[];
    const lastFix = window.lastFix as LastFix | null;

    // Sort chronologically
    samples.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    // Group into journeys: gaps > 30 min = new journey
    const journeys: Journey[] = [];
    let currentJourney: Sample[] = [];

    for (const s of samples) {
      if (currentJourney.length === 0) {
        currentJourney.push(s);
      } else {
        const last = currentJourney[currentJourney.length - 1];
        const gap = new Date(s.ts).getTime() - new Date(last.ts).getTime();
        if (gap > 30 * 60 * 1000) {
          // Gap > 30 min — save current journey and start new one
          journeys.push(finalizeJourney(currentJourney, now));
          currentJourney = [s];
        } else {
          currentJourney.push(s);
        }
      }
    }

    if (currentJourney.length > 0) {
      journeys.push(finalizeJourney(currentJourney, now));
    }

    // Mark the last journey as active if its last sample is within 30 min
    const activeJourney = journeys.length > 0 ? journeys[journeys.length - 1] : null;
    if (activeJourney) {
      const lastSampleTime = new Date(activeJourney.samples[activeJourney.samples.length - 1].ts).getTime();
      activeJourney.isActive = (now.getTime() - lastSampleTime) < 30 * 60 * 1000;
    }

    return json({
      success: true,
      data: {
        currentPosition: lastFix ? { lat: lastFix.lat, lng: lastFix.lng, speed: lastFix.rawSpeed } : null,
        activeJourney: activeJourney?.isActive ? activeJourney : null,
        recentJourneys: journeys.filter(j => !j.isActive).slice(-10).reverse(),
        totalSamples: samples.length,
        updatedAt: record.updatedAt,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // If no data yet, return empty state gracefully
    if (msg.includes('not found') || msg.includes('permission')) {
      return json({
        success: true,
        data: {
          currentPosition: null,
          activeJourney: null,
          recentJourneys: [],
          totalSamples: 0,
          updatedAt: null,
        },
      });
    }
    return json({ success: false, error: msg }, { status: 500 });
  }
};

function finalizeJourney(samples: Sample[], now: Date): Journey {
  const startTime = samples[0].ts;
  const endTime = samples[samples.length - 1].ts;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const durationMinutes = Math.round((end - start) / 60000);
  const mphs = samples.map(s => s.mph).filter(m => m != null);
  const avgMph = mphs.length > 0 ? Math.round(mphs.reduce((a, b) => a + b, 0) / mphs.length * 10) / 10 : 0;
  const maxMph = mphs.length > 0 ? Math.round(Math.max(...mphs) * 10) / 10 : 0;
  const kns = samples.map(s => s.kn).filter(k => k != null);
  const avgKn = kns.length > 0 ? Math.round(kns.reduce((a, b) => a + b, 0) / kns.length * 10) / 10 : 0;

  return {
    startTime,
    endTime,
    durationMinutes,
    avgMph,
    maxMph,
    avgKn,
    sampleCount: samples.length,
    samples,
    isActive: false,
  };
}