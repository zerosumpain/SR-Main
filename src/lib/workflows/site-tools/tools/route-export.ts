import { register } from '../registry-internal';
import { createRouteExport } from '$lib/route-exports';
import { OWNER_PHONE } from '$lib/workflows/whatsapp/approval-notify';

function routeMessage(activity: string, distanceMiles: number, downloadUrl: string): string {
  return `${activity === 'mountain-biking' ? 'Mountain-bike' : 'Running'} route ready — ${distanceMiles} mi. Download GPX: ${downloadUrl}`;
}

register({
  name: 'route_export',
  destructive: true,
  description:
    'Save a GPX 1.1 outdoor route under drive/routes/ and send John a WhatsApp download link. Use only after generating snapped OSM geometry and exact route distance.',
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
      const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
      const result = await getWhatsAppService().sendMessage(OWNER_PHONE, routeMessage(activity, distanceMiles, exported.downloadUrl));
      if (!result.sent) return { success: false, error: 'route saved but WhatsApp delivery failed', data: { ...exported, whatsapp: result } };
      whatsapp = result;
    }
    return { success: true, data: { ...exported, whatsapp } };
  },
});

export { routeMessage };
