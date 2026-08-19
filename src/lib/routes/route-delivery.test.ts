import { describe, expect, it, vi } from 'vitest';
import { createRouteDelivery, routeFilename, routeToGpx, routeToMapFeature } from '$lib/routes/route-delivery';

const route = {
	title: 'Woodland & River <Loop>',
	points: [
		{ latitude: 54.5236, longitude: -1.5595, elevationMetres: 45 },
		{ latitude: 54.524, longitude: -1.558, time: '2026-08-19T09:00:00Z' }
	]
};

describe('route delivery', () => {
	it('creates a safe GPX track and filename', () => {
		expect(routeFilename(route.title)).toBe('woodland-river-loop.gpx');
		const gpx = routeToGpx(route);
		expect(gpx).toContain('<name>Woodland &amp; River &lt;Loop&gt;</name>');
		expect(gpx).toContain('<trkpt lat=\"54.5236\" lon=\"-1.5595\"><ele>45</ele></trkpt>');
	});

	it('converts the snapped route to a GeoJSON line feature', () => {
		expect(routeToMapFeature(route)).toEqual({
			type: 'Feature',
			properties: { title: route.title },
			geometry: { type: 'LineString', coordinates: [[-1.5595, 54.5236, 45], [-1.558, 54.524]] }
		});
	});

	it('uploads GPX and sends its downloadable link', async () => {
		const upload = vi.fn().mockResolvedValue({ downloadUrl: 'https://files.example/routes/woodland.gpx' });
		const send = vi.fn().mockResolvedValue(undefined);
		const result = await createRouteDelivery(route, { upload, send });
		expect(result.downloadUrl).toBe('https://files.example/routes/woodland.gpx');
		expect(upload).toHaveBeenCalledWith(expect.objectContaining({ filename: 'woodland-river-loop.gpx' }));
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ downloadUrl: result.downloadUrl }));
	});
});
