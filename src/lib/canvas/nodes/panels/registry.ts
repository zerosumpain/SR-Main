import type { Component } from 'svelte';
import StealthScrapePanel from './StealthScrapePanel.svelte';
import StealthScrapeLlmPanel from './StealthScrapeLlmPanel.svelte';
import InteractiveStepPanel from './InteractiveStepPanel.svelte';
import SiteMapperPanel from './SiteMapperPanel.svelte';
import CodeExecutePanel from './CodeExecutePanel.svelte';
import GenericJsonPanel from './GenericJsonPanel.svelte';

export type PanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
};

const panels: Record<string, Component<PanelProps>> = {
  'stealth-scrape': StealthScrapePanel,
  'stealth-scrape-llm': StealthScrapeLlmPanel,
  'interactive-step': InteractiveStepPanel,
  'site-mapper': SiteMapperPanel,
  'code-execute': CodeExecutePanel,
};

export function getPanel(type: string): Component<PanelProps> {
  return panels[type] ?? GenericJsonPanel;
}
