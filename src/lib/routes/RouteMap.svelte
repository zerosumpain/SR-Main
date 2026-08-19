<script lang=\"ts\">
	import type { RoutePoint } from '$lib/routes/route-delivery';

	type Props = {
		points: readonly RoutePoint[];
		title?: string;
	};

	let { points, title = 'Route map' }: Props = $props();

	const polyline = $derived.by(() => {
		if (points.length === 0) return '';
		const longitudes = points.map((point) => point.longitude);
		const latitudes = points.map((point) => point.latitude);
		const minLongitude = Math.min(...longitudes);
		const maxLongitude = Math.max(...longitudes);
		const minLatitude = Math.min(...latitudes);
		const maxLatitude = Math.max(...latitudes);
		const width = maxLongitude - minLongitude || 1;
		const height = maxLatitude - minLatitude || 1;
		const padding = 40;
		return points
			.map((point) => {
				const x = padding + ((point.longitude - minLongitude) / width) * (1000 - padding * 2);
				const y = 600 - padding - ((point.latitude - minLatitude) / height) * (600 - padding * 2);
				return `${x},${y}`;
			})
			.join(' ');
	});
</script>

<figure aria-label={title}>
	<svg viewBox=\"0 0 1000 600\" role=\"img\" aria-label={title}>
		<rect width=\"1000\" height=\"600\" fill=\"#eef6f0\" />
		{#if polyline}
			<polyline points={polyline} fill=\"none\" stroke=\"#16794a\" stroke-width=\"8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" />
		{/if}
	</svg>
	<figcaption>{title}</figcaption>
</figure>

<style>
	figure { margin: 0; }
	svg { display: block; width: 100%; height: auto; border-radius: 0.5rem; }
	figcaption { margin-top: 0.5rem; font-weight: 600; }
</style>
