<script lang="ts">
  import { Chart, Svg, Spline } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';

  let {
    points,
    height = 40,
    color = 'var(--accent)',
  }: {
    points: { date: Date; value: number }[];
    height?: number;
    color?: string;
  } = $props();
</script>

<div class="ms" style="height: {height}px;">
  {#if points.length > 1}
    <Chart
      data={points}
      x="date"
      xScale={scaleTime()}
      y="value"
      yScale={scaleLinear()}
      yNice={true}
      padding={{ top: 2, bottom: 2, left: 0, right: 0 }}
    >
      <Svg>
        <Spline stroke={color} strokeWidth={1.5} curve={curveMonotoneX} />
      </Svg>
    </Chart>
  {/if}
</div>

<style>
  .ms { width: 100%; }
</style>
