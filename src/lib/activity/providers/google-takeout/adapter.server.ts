import type { ActivityProviderAdapter, ProviderPage } from '../../contracts';
import { inspectYouTubeTakeout } from './archive.server';
import { googleTakeoutManifest } from './manifest';
import { parseYouTubeTakeoutHistory } from './parse';

const PAGE_SIZE = 250;

export const googleTakeoutActivityProvider: ActivityProviderAdapter = {
  manifest: googleTakeoutManifest,
  async inspectImport(input) {
    const { values: _values, ...inspection } = await inspectYouTubeTakeout(input.bytes);
    return inspection;
  },
  async *import(context, input): AsyncIterable<ProviderPage> {
    const inspected = await inspectYouTubeTakeout(input.bytes);
    const reports = inspected.values.map((value) =>
      parseYouTubeTakeoutHistory({ value, context, importId: input.importId }),
    );
    const events = reports.flatMap((report) => report.events);
    const warnings = reports.flatMap((report) =>
      report.rejected.slice(0, 100).map((rejected) => `row ${rejected.index}: ${rejected.reason}`),
    );
    if (events.length === 0) {
      yield { events: [], nextCursor: { complete: true }, hasMore: false, warnings };
      return;
    }
    for (let offset = 0; offset < events.length; offset += PAGE_SIZE) {
      const pageEvents = events.slice(offset, offset + PAGE_SIZE);
      const final = offset + pageEvents.length >= events.length;
      yield {
        events: pageEvents,
        nextCursor: final ? { complete: true, imported: events.length } : undefined,
        hasMore: !final,
        warnings: final ? warnings : undefined,
      };
    }
  },
};
