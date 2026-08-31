export type RoutePoint = {
	latitude: number;
	longitude: number;
	elevationMetres?: number;
	time?: string;
};

export type SnappedRoute = {
	title: string;
	points: readonly RoutePoint[];
};

export type RouteMapFeature = {
	type: 'Feature';
	properties: { title: string };
	geometry: {
		type: 'LineString';
		coordinates: Array<[longitude: number, latitude: number, elevationMetres?: number]>;
	};
};

export type RouteUpload = (file: {
	filename: string;
	contentType: 'application/gpx+xml';
	body: Blob;
}) => Promise<{ downloadUrl: string }>;

export type RouteSender = (message: {
	routeTitle: string;
	filename: string;
	downloadUrl: string;
}) => Promise<void>;

export type DeliveredRoute = {
	filename: string;
	gpx: Blob;
	downloadUrl: string;
};

const escapeXml = (value: string): string =>
	value.replace(/[<>&'\"]/g, (character) => {
		const entities: Record<string, string> = {
			'<': '&lt;',
			'>': '&gt;',
			'&': '&amp;',
			"'": '&apos;',
			'\"': '&quot;'
		};
		return entities[character] ?? character;
	});

const assertRoute = (route: SnappedRoute): void => {
	if (route.points.length < 2) {
		throw new Error('A route needs at least two points.');
	}

	for (const point of route.points) {
		if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) {
			throw new Error('Route latitude must be between -90 and 90.');
		}
		if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
			throw new Error('Route longitude must be between -180 and 180.');
		}
	}
};

export const routeFilename = (title: string): string => {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug || 'route'}.gpx`;
};

export const routeToGpx = (route: SnappedRoute): string => {
	assertRoute(route);
	const trackPoints = route.points
		.map((point) => {
			const elevation = point.elevationMetres === undefined ? '' : `<ele>${point.elevationMetres}</ele>`;
			const time = point.time === undefined ? '' : `<time>${escapeXml(point.time)}</time>`;
			return `      <trkpt lat=\"${point.latitude}\" lon=\"${point.longitude}\">${elevation}${time}</trkpt>`;
		})
		.join('\n');

	return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<gpx version=\"1.1\" creator=\"route-planner\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\">
  <trk>
    <name>${escapeXml(route.title)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
};

export const routeToMapFeature = (route: SnappedRoute): RouteMapFeature => {
	assertRoute(route);
	return {
		type: 'Feature',
		properties: { title: route.title },
		geometry: {
			type: 'LineString',
			coordinates: route.points.map((point) =>
				point.elevationMetres === undefined
					? [point.longitude, point.latitude]
					: [point.longitude, point.latitude, point.elevationMetres]
			)
		}
	};
};

export const createRouteDelivery = async (
	route: SnappedRoute,
	dependencies: { upload: RouteUpload; send: RouteSender }
): Promise<DeliveredRoute> => {
	const filename = routeFilename(route.title);
	const gpx = new Blob([routeToGpx(route)], { type: 'application/gpx+xml' });
	const { downloadUrl } = await dependencies.upload({
		filename,
		contentType: 'application/gpx+xml',
		body: gpx
	});
	await dependencies.send({ routeTitle: route.title, filename, downloadUrl });
	return { filename, gpx, downloadUrl };
};
