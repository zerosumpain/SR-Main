import type { Component } from 'svelte';
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

type PanelModule = { default: Component<PanelProps> };

// Vite turns this into one loader per panel. The former static imports pulled
// every specialised editor (and its SDKs, widgets and styles) into the canvas
// route before the inspector was even opened.
const panelModules = import.meta.glob<PanelModule>([
  './*.svelte',
  '!./LazyPanel.svelte',
]);

const specialized: Record<string, string> = {
  'stealth-scrape': './StealthScrapePanel.svelte',
  'stealth-scrape-llm': './StealthScrapeLlmPanel.svelte',
  'interactive-step': './InteractiveStepPanel.svelte',
  'site-mapper': './SiteMapperPanel.svelte',
  'code-execute': './CodeExecutePanel.svelte',
  'http-request': './HttpRequestPanel.svelte',
  'whatsapp': './WhatsAppPanel.svelte',
  'llm-call': './LlmCallPanel.svelte',
  'llm-agent': './LlmAgentPanel.svelte',
  'gmail-send': './GmailSendPanel.svelte',
  'gmail-fetch': './GmailFetchPanel.svelte',
  'gmail-reply': './GmailReplyPanel.svelte',
  'gmail-search': './GmailSearchPanel.svelte',
  'gmail-trigger': './GmailTriggerPanel.svelte',
  'conditional': './ConditionalPanel.svelte',
  'switch': './SwitchPanel.svelte',
  'transform': './TransformPanel.svelte',
  'data-store': './DataStorePanel.svelte',
  'dedupe': './DedupePanel.svelte',
  'delay': './DelayPanel.svelte',
  'tavily-search': './TavilySearchPanel.svelte',
  'web-scrape': './WebScrapePanel.svelte',
  'email': './EmailPanel.svelte',
  'text-parser': './TextParserPanel.svelte',
  'accumulator': './AccumulatorPanel.svelte',
  'merge': './MergePanel.svelte',
  'file-store': './FileStorePanel.svelte',
  'intel-write': './IntelWritePanel.svelte',
  'intel-query': './IntelQueryPanel.svelte',
  'home-assistant': './HomeAssistantPanel.svelte',
  'gmail-label': './GmailLabelPanel.svelte',
  'think': './ThinkPanel.svelte',
  'error-handler': './ErrorHandlerPanel.svelte',
  'validator': './ValidatorPanel.svelte',
  'llm-router': './LlmRouterPanel.svelte',
  'file-write': './FileWritePanel.svelte',
  'file-extract': './FileExtractPanel.svelte',
  'file-text-extract': './FileTextExtractPanel.svelte',
  'blog-list': './BlogListPanel.svelte',
  'blog-get': './BlogGetPanel.svelte',
  'blog-create': './BlogCreatePanel.svelte',
  'blog-update': './BlogUpdatePanel.svelte',
  'deep-research': './DeepResearchPanel.svelte',
  'deep-dive': './DeepDivePanel.svelte',
  'whoop': './WhoopPanel.svelte',
  'strava': './StravaPanel.svelte',
  'health-query': './HealthQueryPanel.svelte',
  'quick-answer': './QuickAnswerPanel.svelte',
  'research-result': './ResearchResultPanel.svelte',
  'file-build': './FileBuildPanel.svelte',
  'file-read': './FileReadPanel.svelte',
  'file-list': './FileListPanel.svelte',
  'file-delete': './FileDeletePanel.svelte',
  'loop': './LoopPanel.svelte',
  'sub-workflow': './SubWorkflowPanel.svelte',
  'openrouter': './OpenRouterPanel.svelte',
  'jkai': './JkaiPanel.svelte',
  'site-tool': './SiteToolPanel.svelte',
  'api-call': './ApiCallPanel.svelte',
  'api-integration': './ApiIntegrationPanel.svelte',
  'builder-chat': './BuilderChatPanel.svelte',
  'builder-pi': './BuilderPiPanel.svelte',
  'build-view': './BuildViewPanel.svelte',
  'apple-calendar': './AppleCalendarPanel.svelte',
  'research-chat': './ResearchChatPanel.svelte',
  'research-report': './ResearchReportPanel.svelte',
};

/**
 * Resolution order:
 *   1. specialised panel for this type (if registered)
 *   2. BasicConfigForm if the definition declares basicConfig
 *   3. GenericJsonPanel as last resort
 */
export async function loadPanel(type: string, definition?: NodeDefinition): Promise<Component<PanelProps>> {
  const path = specialized[type]
    ?? (definition?.basicConfig?.length ? './BasicConfigForm.svelte' : './GenericJsonPanel.svelte');
  const load = panelModules[path];
  if (!load) throw new Error(`Missing canvas panel module: ${path}`);
  return (await load()).default;
}
