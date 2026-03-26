<script lang="ts">
  import { Chart, Svg, Area, Spline } from 'layerchart';
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';

  let { sparklines }: { sparklines: any[] } = $props();

  function parseSparkline(s: any) {
    return s.values.map((v: any) => ({
      date: new Date(v.date),
      value: v.value,
    }));
  }

  const labels: Record<string, string> = {
    recovery: 'Recovery',
    sleep: 'Sleep',
    heart_rate: 'Heart Rate',
    strain: 'Strain',
  };

  const units: Record<string, string> = {
    recovery: '%',
    sleep: '%',
    heart_rate: 'bpm',
    strain: '',
  };
</script>

<section class="max-w-3xl mx-auto px-6 sm:px-8">
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    {#each sparklines || [] as sparkline}
      <div class="backdrop-blur-md border rounded-xl p-4" style="background: var(--card-bg); border-color: var(--card-border);">
        <p class="text-[9px] uppercase tracking-[0.2em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
          {labels[sparkline.metric] || sparkline.metric}
        </p>
        <p class="text-lg font-light" style="color: var(--text-primary);">
          {Math.round(sparkline.current)}<span class="text-xs ml-1" style="color: var(--text-ghost);">{units[sparkline.metric] || ''}</span>
        </p>
        <div class="h-[40px] mt-2">
          {#if sparkline.values.length > 1}
            <Chart
              data={parseSparkline(sparkline)}
              x="date"
              xScale={scaleTime()}
              y="value"
              yScale={scaleLinear()}
              yNice={true}
              padding={{ top: 2, bottom: 2, left: 0, right: 0 }}
            >
              <Svg>
                <Area fill="var(--accent)" fillOpacity={0.1} curve={curveMonotoneX} />
                <Spline stroke="var(--accent)" strokeWidth={1.5} curve={curveMonotoneX} />
              </Svg>
            </Chart>
          {/if}
        </div>
        <p class="text-[9px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
          {sparkline.trend === 'up' ? '↑' : sparkline.trend === 'down' ? '↓' : '→'} 7d
        </p>
      </div>
    {/each}
  </div>
</section>
