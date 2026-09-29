import { register } from '../registry-internal';
import { createRouteExport } from '$lib/route-exports';

function routeMessage(activity: string, distanceMiles: number, downloadUrl: string): string {
  return `${activity === 'mountain-biking' ? 'Mountain-bike' : 'Running'} route ready — ${distanceMiles} mi. Download GPX: ${downloadUrl}`;
}

register({
  name: 'route_export',
  destructive: true,
  description:
    'Save a GPX 1.1 outdoor route under drive/routes/ and send John a WhatsApp download link. Call route_plan FIRST and pass its gpx through — never hand-write coordinates, because invented geometry cannot know surface, gradient, or whether a lane is a dead end.',
  parameters: {
    type: 'object',
    properties: {
      gpx: { type: 'string', description: 'Complete GPX 1.1 XML payload.' },
      basename: { type: 'string', description: 'Safe .gpx filename only, e.g. 2026-08-16-running-loop-8.9mi.gpx.' },
      activity: { type: 'string', enum: ['running', 'mountain-biking'], description: 'Route activity.' },
      distanceMiles: { type: 'number', description: 'Exact snapped route distance in miles.' },
      sendWhatsapp: { type: 'boolean', description: 'Send John the download link. Defaults to true.' },
    },
    required: ['gpx', 'basename', 'activity', 'distanceMiles'],
  },
  category: 'Routes',
  toolset: 'files',
  handler: async (args) => {
    const activity = String(args.activity ?? '');
    const distanceMiles = Number(args.distanceMiles);
    const exported = await createRouteExport({
      gpx: String(args.gpx ?? ''),
      basename: String(args.basename ?? ''),
      activity: activity as 'running' | 'mountain-biking',
      distanceMiles,
    });

    let whatsapp: unknown = null;
    if (args.sendWhatsapp !== false) {
      // The owner asked for WhatsApp by name, so it goes there whatever the
      // category routes to; the notifier adds the ledger row and the phone.
      const { notifyOwner, deliveryReport } = await import('$lib/server/notify');
      const text = routeMessage(activity, distanceMiles, exported.downloadUrl);
      const report = deliveryReport(
        await notifyOwner({
          category: 'system',
          title: 'Route ready',
          body: text,
          url: exported.downloadUrl,
          whatsappText: text,
          dedupeKey: `route-export:${exported.fileId}`,
          channels: { whatsapp: true },
        }),
      );
      if (report.whatsapp !== 'sent') {
        return { success: false, error: `route saved but WhatsApp delivery failed (${report.channels})`, data: { ...exported, whatsapp: report } };
      }
      whatsapp = report;
    }
    return { success: true, data: { ...exported, whatsapp } };
  },
});

export { routeMessage };
