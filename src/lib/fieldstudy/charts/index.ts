/**
 * The figure registry.
 *
 * A beat authors a figure as DATA — `{ no, caption, chart, unit, data }` —
 * exactly as it authors everything else, and names a chart by id. This maps
 * that id onto the component that draws it.
 *
 * Before this existed, `T1Argument` reserved a dashed slot for every figure
 * and nothing ever mounted in it, so a study that declared figures rendered
 * captions floating under empty boxes. The reserved slot is still the
 * behaviour for an UNREGISTERED id — a caption with a visible gap is a better
 * failure than a caption with nothing, and it keeps the reference study's
 * existing `A4`/`A5` figures rendering exactly as they did.
 *
 * A chart component takes `{ data, unit }` and draws inline SVG or plain HTML
 * against the site tokens. It never fetches, never animates on mount, and
 * never invents a colour: categorical hues are licensed only inside a legend
 * and the marks that legend labels, and the status trio (built / designed /
 * absent) always ships with a glyph and a word, never colour alone.
 */
import type { Component } from 'svelte';

import GateFlow from './GateFlow.svelte';
import BuildState from './BuildState.svelte';
import ReachSpan from './ReachSpan.svelte';
import CounterRow from './CounterRow.svelte';

export type ChartProps = { data?: unknown; unit?: string };

export const CHARTS: Record<string, Component<ChartProps>> = {
  'gate-flow': GateFlow as unknown as Component<ChartProps>,
  'build-state': BuildState as unknown as Component<ChartProps>,
  'reach-span': ReachSpan as unknown as Component<ChartProps>,
  'counter-row': CounterRow as unknown as Component<ChartProps>,
};

/** The component for a figure's chart id, or undefined to reserve the slot. */
export function chartFor(id: string): Component<ChartProps> | undefined {
  return CHARTS[id];
}
