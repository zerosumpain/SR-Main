import type { Component } from 'svelte';
import StealthScrapePanel from './StealthScrapePanel.svelte';
import StealthScrapeLlmPanel from './StealthScrapeLlmPanel.svelte';
import InteractiveStepPanel from './InteractiveStepPanel.svelte';
import SiteMapperPanel from './SiteMapperPanel.svelte';
import CodeExecutePanel from './CodeExecutePanel.svelte';
import HttpRequestPanel from './HttpRequestPanel.svelte';
import WhatsAppPanel from './WhatsAppPanel.svelte';
import LlmCallPanel from './LlmCallPanel.svelte';
import LlmAgentPanel from './LlmAgentPanel.svelte';
import GmailSendPanel from './GmailSendPanel.svelte';
import ConditionalPanel from './ConditionalPanel.svelte';
import TransformPanel from './TransformPanel.svelte';
import DataStorePanel from './DataStorePanel.svelte';
import BasicConfigForm from './BasicConfigForm.svelte';
import GenericJsonPanel from './GenericJsonPanel.svelte';
import type { NodeDefinition } from '$lib/workflows/types';

export type PanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  definition?: NodeDefinition;
};

const specialized: Record<string, Component<PanelProps>> = {
  'stealth-scrape': StealthScrapePanel,
  'stealth-scrape-llm': StealthScrapeLlmPanel,
  'interactive-step': InteractiveStepPanel,
  'site-mapper': SiteMapperPanel,
  'code-execute': CodeExecutePanel,
  'http-request': HttpRequestPanel as unknown as Component<PanelProps>,
  'whatsapp': WhatsAppPanel as unknown as Component<PanelProps>,
  'llm-call': LlmCallPanel as unknown as Component<PanelProps>,
  'llm-agent': LlmAgentPanel as unknown as Component<PanelProps>,
  'gmail-send': GmailSendPanel as unknown as Component<PanelProps>,
  'conditional': ConditionalPanel as unknown as Component<PanelProps>,
  'transform': TransformPanel as unknown as Component<PanelProps>,
  'data-store': DataStorePanel as unknown as Component<PanelProps>,
};

/**
 * Resolution order:
 *   1. specialized panel for this type (if registered)
 *   2. BasicConfigForm if the definition declares basicConfig
 *   3. GenericJsonPanel as last-resort
 */
export function getPanel(type: string, definition?: NodeDefinition): Component<PanelProps> {
  if (specialized[type]) return specialized[type];
  if (definition?.basicConfig && definition.basicConfig.length > 0) {
    // BasicConfigForm requires `definition` (non-optional in its props), so its
    // own typed Component<...> is narrower than Component<PanelProps>. The
    // resolver only returns it when the caller has a definition to pass, so
    // this cast is sound at the call site.
    return BasicConfigForm as unknown as Component<PanelProps>;
  }
  return GenericJsonPanel;
}
