import type { ToolHandler } from '$lib/platform/types';

interface DashboardArgs {
  days?: number;
  format?: 'map' | 'table' | 'both';
}

interface AggregatedLocation {
  lat: number;
  lon: number;
  count: number;
  address?: string;
  timespent_minutes?: number;
}

interface DashboardResult {
  success: boolean;
  message: string;
  dashboardUrl?: string;
  tableUrl?: string;
  mapUrl?: string;
}

/**
 * Generates a location history dashboard by aggregating recent locations
 * and rendering them as a map and/or table using platform visualisation tools.
 */
export const locationHistoryDashboard: ToolHandler = async (
  args: DashboardArgs,
  platform: { call: (tool: string, args: unknown) => Promise<unknown> }
): Promise<DashboardResult> => {
  const days = args.days ?? 7;
  const format = args.format ?? 'both';

  // Validate days
  if (typeof days !== 'number' || days < 1 || days > 365) {
    return {
      success: false,
      message: '`days` must be a number between 1 and 365',
    };
  }

  // Supported formats
  const validFormats: Array<'map' | 'table' | 'both'> = ['map', 'table', 'both'];
  if (!validFormats.includes(format)) {
    return {
      success: false,
      message: `Invalid format: ${format}. Must be 'map', 'table', or 'both'.`,
    };
  }

  // Call aggregator
  let aggregatorResult: { success: boolean; message: string; locations?: AggregatedLocation[] };
  try {
    aggregatorResult = (await platform.call('location_history_aggregator', {
      days,
    })) as any;
  } catch (err) {
    return {
      success: false,
      message: `location_history_aggregator call failed: ${err}`,
    };
  }

  if (!aggregatorResult.success) {
    return {
      success: false,
      message: aggregatorResult.message || 'Location aggregator returned unsuccessful',
    };
  }

  const locations: AggregatedLocation[] = aggregatorResult.locations ?? [];

  if (locations.length === 0) {
    return {
      success: true,
      message: 'No locations found for the given period.',
    };
  }

  // Prepare data for visualisation
  const tableData = locations.map((loc, i) => ({
    id: i + 1,
    address: loc.address ?? `(${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)})`,
    visits: loc.count,
    time_spent_minutes: loc.timespent_minutes ?? 0,
  }));

  const mapData = locations.map((loc) => ({
    lat: loc.lat,
    lon: loc.lon,
    label: loc.address ?? `(${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)})`,
    weight: loc.count,
  }));

  const result: DashboardResult = {
    success: true,
    message: 'Dashboard generated successfully.',
  };

  // Generate table if requested
  if (format === 'table' || format === 'both') {
    try {
      const tableResult: any = await platform.call('visualise:render_table', {
        title: `Location History (last ${days} days)`,
        headers: ['#', 'Address', 'Visits', 'Time Spent (min)'],
        rows: tableData.map((r) => [r.id, r.address, r.visits, r.time_spent_minutes]),
      });
      result.tableUrl = tableResult?.url ?? tableResult?.id ?? null;
      result.dashboardUrl = result.tableUrl;
    } catch (err) {
      result.message += ` Table render failed: ${err}`;
    }
  }

  // Generate map if requested
  if (format === 'map' || format === 'both') {
    try {
      const mapResult: any = await platform.call('visualise:render_map', {
        title: `Location History Map (last ${days} days)`,
        markers: mapData.map((m) => ({
          latitude: m.lat,
          longitude: m.lon,
          label: m.label,
          weight: m.weight,
        })),
      });
      result.mapUrl = mapResult?.url ?? mapResult?.id ?? null;
      result.dashboardUrl = result.mapUrl || result.dashboardUrl;
    } catch (err) {
      result.message += ` Map render failed: ${err}`;
    }
  }

  return result;
};
