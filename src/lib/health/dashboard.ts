import { platform } from '$lib/platform'; // Assume platform.call is exposed

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface HealthDataPoint {
  date: string; // ISO date string YYYY-MM-DD
  sleepScore?: number;
  recoveryScore?: number;
  strainScore?: number;
  workoutCount?: number;
  workoutMinutes?: number;
}

interface ChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
}

interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface HealthDashboardResult {
  todaySummary: {
    sleep: number | null;
    recovery: number | null;
    strain: number | null;
  };
  chartData: ChartData;
}

// --------------------------------------------------------------------------
// Color palette for datasets
// --------------------------------------------------------------------------

const COLORS = {
  sleep: 'rgba(102, 153, 255, 1)',
  recovery: 'rgba(75, 192, 192, 1)',
  strain: 'rgba(255, 99, 132, 1)',
  workout: 'rgba(255, 159, 64, 1)',
};

// --------------------------------------------------------------------------
// Helper: call a health tool with a date parameter
// --------------------------------------------------------------------------

async function callHealthTool<T = unknown>(
  tool: string,
  date: string
): Promise<T> {
  return platform.call(tool, { date }) as Promise<T>;
}

// --------------------------------------------------------------------------
// Fetch data for a single day
// --------------------------------------------------------------------------

async function fetchDayData(date: string): Promise<HealthDataPoint> {
  const [sleep, readiness, trainingLoad, timeline] = await Promise.all([
    callHealthTool<{ sleepScore?: number }>('health_sleep', date).catch(() => ({})),
    callHealthTool<{ recoveryScore?: number }>('health_readiness', date).catch(() => ({})),
    callHealthTool<{ strainScore?: number }>('health_training_load', date).catch(() => ({})),
    callHealthTool<{ events?: Array<{ type: string; duration?: number }> }>('health_timeline', date).catch(() => ({})),
  ]);

  let workoutCount = 0;
  let workoutMinutes = 0;
  if (timeline.events) {
    for (const event of timeline.events) {
      if (event.type === 'workout') {
        workoutCount++;
        workoutMinutes += event.duration ?? 0;
      }
    }
  }

  return {
    date,
    sleepScore: sleep.sleepScore ?? undefined,
    recoveryScore: readiness.recoveryScore ?? undefined,
    strainScore: trainingLoad.strainScore ?? undefined,
    workoutCount: workoutCount > 0 ? workoutCount : undefined,
    workoutMinutes: workoutMinutes > 0 ? workoutMinutes : undefined,
  };
}

// --------------------------------------------------------------------------
// Generate date range array
// --------------------------------------------------------------------------

function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// --------------------------------------------------------------------------
// Main dashboard function
// --------------------------------------------------------------------------

export async function getHealthDashboard(
  startDate: string,
  endDate: string
): Promise<HealthDashboardResult> {
  const dates = getDateRange(startDate, endDate);
  const dayData = await Promise.all(dates.map((d) => fetchDayData(d)));

  // Today's summary (last day in the range)
  const today = dayData[dayData.length - 1];

  // Build chart data
  const labels = dayData.map((d) => d.date);
  const sleepData = dayData.map((d) => d.sleepScore ?? null);
  const recoveryData = dayData.map((d) => d.recoveryScore ?? null);
  const strainData = dayData.map((d) => d.strainScore ?? null);
  const workoutData = dayData.map((d) => d.workoutMinutes ?? null);

  const datasets: ChartDataset[] = [
    {
      label: 'Sleep Score',
      data: sleepData,
      borderColor: COLORS.sleep,
      backgroundColor: COLORS.sleep.replace('1)', '0.2)'),
    },
    {
      label: 'Recovery Score',
      data: recoveryData,
      borderColor: COLORS.recovery,
      backgroundColor: COLORS.recovery.replace('1)', '0.2)'),
    },
    {
      label: 'Strain Score',
      data: strainData,
      borderColor: COLORS.strain,
      backgroundColor: COLORS.strain.replace('1)', '0.2)'),
    },
    {
      label: 'Workout Minutes',
      data: workoutData,
      borderColor: COLORS.workout,
      backgroundColor: COLORS.workout.replace('1)', '0.2)'),
      yAxisID: 'y1', // assume render_chart supports multiple axes
    },
  ];

  return {
    todaySummary: {
      sleep: today.sleepScore ?? null,
      recovery: today.recoveryScore ?? null,
      strain: today.strainScore ?? null,
    },
    chartData: {
      labels,
      datasets,
    },
  };
}
