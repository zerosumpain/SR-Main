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
import GmailFetchPanel from './GmailFetchPanel.svelte';
import GmailReplyPanel from './GmailReplyPanel.svelte';
import GmailSearchPanel from './GmailSearchPanel.svelte';
import GmailTriggerPanel from './GmailTriggerPanel.svelte';
import ConditionalPanel from './ConditionalPanel.svelte';
import TransformPanel from './TransformPanel.svelte';
import DataStorePanel from './DataStorePanel.svelte';
import DelayPanel from './DelayPanel.svelte';
import TavilySearchPanel from './TavilySearchPanel.svelte';
import WebScrapePanel from './WebScrapePanel.svelte';
import EmailPanel from './EmailPanel.svelte';
import TextParserPanel from './TextParserPanel.svelte';
import AccumulatorPanel from './AccumulatorPanel.svelte';
import MergePanel from './MergePanel.svelte';
import FileStorePanel from './FileStorePanel.svelte';
import IntelWritePanel from './IntelWritePanel.svelte';
import IntelQueryPanel from './IntelQueryPanel.svelte';
import HomeAssistantPanel from './HomeAssistantPanel.svelte';
import GmailLabelPanel from './GmailLabelPanel.svelte';
import ThinkPanel from './ThinkPanel.svelte';
import ErrorHandlerPanel from './ErrorHandlerPanel.svelte';
import ValidatorPanel from './ValidatorPanel.svelte';
import LlmRouterPanel from './LlmRouterPanel.svelte';
import FileWritePanel from './FileWritePanel.svelte';
import FileExtractPanel from './FileExtractPanel.svelte';
import FileTextExtractPanel from './FileTextExtractPanel.svelte';
import BlogListPanel from './BlogListPanel.svelte';
import BlogGetPanel from './BlogGetPanel.svelte';
import BlogCreatePanel from './BlogCreatePanel.svelte';
import BlogUpdatePanel from './BlogUpdatePanel.svelte';
import DeepResearchPanel from './DeepResearchPanel.svelte';
import DeepDivePanel from './DeepDivePanel.svelte';
import WhoopPanel from './WhoopPanel.svelte';
import StravaPanel from './StravaPanel.svelte';
import HealthQueryPanel from './HealthQueryPanel.svelte';
import QuickAnswerPanel from './QuickAnswerPanel.svelte';
import ResearchResultPanel from './ResearchResultPanel.svelte';
import FileBuildPanel from './FileBuildPanel.svelte';
import FileReadPanel from './FileReadPanel.svelte';
import FileListPanel from './FileListPanel.svelte';
import FileDeletePanel from './FileDeletePanel.svelte';
import LoopPanel from './LoopPanel.svelte';
import SubWorkflowPanel from './SubWorkflowPanel.svelte';
import OpenRouterPanel from './OpenRouterPanel.svelte';
import JkaiPanel from './JkaiPanel.svelte';
import BuilderChatPanel from './BuilderChatPanel.svelte';
import BuilderPiPanel from './BuilderPiPanel.svelte';
import BuildViewPanel from './BuildViewPanel.svelte';
import BasicConfigForm from './BasicConfigForm.svelte';
import GenericJsonPanel from './GenericJsonPanel.svelte';
import IcloudCalPanel from './IcloudCalPanel.svelte';
import type { NodeDefinition } from '$lib/workflows/types';

export type PanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  definition?: NodeDefinition;
  /**
   * Context plumbed from the canvas page so panels can offer pickers
   * grounded in real data (instead of forcing the user to type field
   * paths or store keys from memory).
   *
   * - `nodeId`: the workflow_nodes row id of the node being edited.
   * - `workflowId`: the canvas this node belongs to. Lets panels query
   *   workflow-scoped resources like the data-store keys.
   * - `upstreamFields`: dot-paths to every value the upstream nodes have
   *   actually emitted in their most recent run output. e.g.
   *   `["body.results", "body.results.0.id", "currentStates.jemima"]`.
   *   Drives `<UpstreamFieldPicker>` dropdowns. Empty when the upstream
   *   nodes haven't run yet.
   */
  nodeId?: string;
  workflowId?: string;
  upstreamFields?: string[];
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
  'gmail-fetch': GmailFetchPanel as unknown as Component<PanelProps>,
  'gmail-reply': GmailReplyPanel as unknown as Component<PanelProps>,
  'gmail-search': GmailSearchPanel as unknown as Component<PanelProps>,
  'gmail-trigger': GmailTriggerPanel as unknown as Component<PanelProps>,
  'conditional': ConditionalPanel as unknown as Component<PanelProps>,
  'transform': TransformPanel as unknown as Component<PanelProps>,
  'data-store': DataStorePanel as unknown as Component<PanelProps>,
  'delay': DelayPanel as unknown as Component<PanelProps>,
  'tavily-search': TavilySearchPanel as unknown as Component<PanelProps>,
  'web-scrape': WebScrapePanel as unknown as Component<PanelProps>,
  'email': EmailPanel as unknown as Component<PanelProps>,
  'text-parser': TextParserPanel as unknown as Component<PanelProps>,
  'accumulator': AccumulatorPanel as unknown as Component<PanelProps>,
  'merge': MergePanel as unknown as Component<PanelProps>,
  'file-store': FileStorePanel as unknown as Component<PanelProps>,
  'intel-write': IntelWritePanel as unknown as Component<PanelProps>,
  'intel-query': IntelQueryPanel as unknown as Component<PanelProps>,
  'home-assistant': HomeAssistantPanel as unknown as Component<PanelProps>,
  'gmail-label': GmailLabelPanel as unknown as Component<PanelProps>,
  'think': ThinkPanel as unknown as Component<PanelProps>,
  'error-handler': ErrorHandlerPanel as unknown as Component<PanelProps>,
  'validator': ValidatorPanel as unknown as Component<PanelProps>,
  'llm-router': LlmRouterPanel as unknown as Component<PanelProps>,
  'file-write': FileWritePanel as unknown as Component<PanelProps>,
  'file-extract': FileExtractPanel as unknown as Component<PanelProps>,
  'file-text-extract': FileTextExtractPanel as unknown as Component<PanelProps>,
  'blog-list': BlogListPanel as unknown as Component<PanelProps>,
  'blog-get': BlogGetPanel as unknown as Component<PanelProps>,
  'blog-create': BlogCreatePanel as unknown as Component<PanelProps>,
  'blog-update': BlogUpdatePanel as unknown as Component<PanelProps>,
  'deep-research': DeepResearchPanel as unknown as Component<PanelProps>,
  'deep-dive': DeepDivePanel as unknown as Component<PanelProps>,
  'whoop': WhoopPanel as unknown as Component<PanelProps>,
  'strava': StravaPanel as unknown as Component<PanelProps>,
  'health-query': HealthQueryPanel as unknown as Component<PanelProps>,
  'quick-answer': QuickAnswerPanel as unknown as Component<PanelProps>,
  'research-result': ResearchResultPanel as unknown as Component<PanelProps>,
  'file-build': FileBuildPanel as unknown as Component<PanelProps>,
  'file-read': FileReadPanel as unknown as Component<PanelProps>,
  'file-list': FileListPanel as unknown as Component<PanelProps>,
  'file-delete': FileDeletePanel as unknown as Component<PanelProps>,
  'loop': LoopPanel as unknown as Component<PanelProps>,
  'sub-workflow': SubWorkflowPanel as unknown as Component<PanelProps>,
  'openrouter': OpenRouterPanel as unknown as Component<PanelProps>,
  'jkai': JkaiPanel as unknown as Component<PanelProps>,
  'builder-chat': BuilderChatPanel as unknown as Component<PanelProps>,
  'builder-pi': BuilderPiPanel as unknown as Component<PanelProps>,
  'build-view': BuildViewPanel as unknown as Component<PanelProps>,
  'icloud-cal': IcloudCalPanel as unknown as Component<PanelProps>,
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
