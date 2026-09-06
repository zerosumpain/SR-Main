/**
 * The feature-store columns worth correlating, with the units they are in.
 *
 * Identifiers, coverage fractions and the `sources` map are deliberately absent
 * — they describe the record rather than the day. `trailFixes` is out for the
 * same reason `placesVisited` had to be fixed: it measures how much we looked,
 * not what happened.
 */
export const MIRRORED_FEATURES: ReadonlyArray<{
  column: string;
  label: string;
  unit: string | null;
}> = [
  { column: 'steps', label: 'Steps', unit: 'steps' },
  { column: 'activeEnergyKj', label: 'Active energy', unit: 'kJ' },
  { column: 'meanHeartRate', label: 'Mean heart rate', unit: 'bpm' },
  { column: 'hrvMs', label: 'HRV', unit: 'ms' },
  { column: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm' },
  { column: 'recoveryScore', label: 'Recovery', unit: '%' },
  { column: 'strain', label: 'Strain', unit: null },
  { column: 'sleepMinutes', label: 'Sleep', unit: 'min' },
  { column: 'sleepPerformance', label: 'Sleep performance', unit: '%' },
  { column: 'sleepEfficiency', label: 'Sleep efficiency', unit: '%' },
  { column: 'disturbanceCount', label: 'Sleep disturbances', unit: null },
  { column: 'workouts', label: 'Workouts', unit: null },
  { column: 'activeMinutes', label: 'Active minutes', unit: 'min' },
  { column: 'activityDistanceM', label: 'Activity distance', unit: 'm' },
  { column: 'minutesAtHome', label: 'Time at home', unit: 'min' },
  { column: 'minutesOut', label: 'Time out', unit: 'min' },
  { column: 'placesVisited', label: 'Visits', unit: null },
  { column: 'distinctPlaces', label: 'Distinct places', unit: null },
  { column: 'firstOutAtMins', label: 'First out', unit: 'min past midnight' },
  { column: 'lastHomeAtMins', label: 'Last home', unit: 'min past midnight' },
  { column: 'calendarEvents', label: 'Calendar events', unit: null },
  { column: 'calendarBusyMinutes', label: 'Calendar busy time', unit: 'min' },
  { column: 'verifiedSpendMinor', label: 'Verified spend', unit: 'p' },
];


/** Labels and units for recorded values; unknown signals must not acquire guessed units. */
export function metricHeading(key: string): string {
  const metric = MIRRORED_FEATURES.find((m) => m.column === key);
  if (!metric) return `${key} (unit not recorded)`;
  const unit = metric.unit === 'p' ? 'pence' : metric.unit;
  return unit ? `${metric.label} (${unit})` : metric.label;
}
