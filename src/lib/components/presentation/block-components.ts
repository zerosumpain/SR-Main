// Block type → render component. Client-side sibling of
// $lib/presentation/registry.ts (which stays Svelte-free for server use).
import type { Component } from 'svelte';
import type { Block, BlockType } from '$lib/presentation/types';
import Masthead from './blocks/Masthead.svelte';
import Prose from './blocks/Prose.svelte';
import BigNumber from './blocks/BigNumber.svelte';
import StatRow from './blocks/StatRow.svelte';
import Quote from './blocks/Quote.svelte';
import Timeline from './blocks/Timeline.svelte';
import Image from './blocks/Image.svelte';
import Chart from './blocks/Chart.svelte';
import Embed from './blocks/Embed.svelte';
import Iframe from './blocks/Iframe.svelte';

// Each component takes its own narrowed block; the map erases to the union.
export const BLOCK_COMPONENTS = {
  masthead: Masthead,
  prose: Prose,
  bigNumber: BigNumber,
  statRow: StatRow,
  quote: Quote,
  timeline: Timeline,
  image: Image,
  chart: Chart,
  embed: Embed,
  iframe: Iframe,
} as unknown as Record<BlockType, Component<{ block: Block }>>;
