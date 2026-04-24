<script lang="ts">
  import ChatMessage from '$lib/components/jkai/ChatMessage.svelte';
  import Artifact from '$lib/components/jkai/artifacts/Artifact.svelte';
  import type { Artifact as ArtifactT } from '$lib/workflows/site-tools/artifact-types';
  import { isArtifact } from '$lib/workflows/site-tools/artifact-types';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import PromoteToolBanner from '$lib/components/jkai/PromoteToolBanner.svelte';
  import PlanCard from '$lib/components/jkai/PlanCard.svelte';
  import SubAgentBubble from '$lib/components/jkai/SubAgentBubble.svelte';
  import type { PlanPayload } from '$lib/workflows/chat/job-store';
  import { parsePromoteMarkers, stripPromoteMarkers } from '$lib/jkai/promote-marker';
  import ChatModelToggle from '$lib/components/jkai/ChatModelToggle.svelte';
  import MessageAttachments from './MessageAttachments.svelte';
  import ComposerAttachmentTray from './ComposerAttachmentTray.svelte';
  import JsonBlock from '$lib/components/jkai/JsonBlock.svelte';
  import VoiceRecorder from './VoiceRecorder.svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let {
    conversationId,
    initialMessages = [],
    conversation = null,
    defaultGlmModelId,
    altOpenRouterModel = null,
    messageCount = 0,
    onmodelchange,
    modelCapabilities = null,
    useIntelContext = true,
  }: {
    conversationId: string | null;
    initialMessages?: Array<{
      id: string;
      role: string;
      content: string;
      metadata?: any;
      source?: string;
      createdAt?: string;
    }>;
    conversation?: { modelProvider?: string; modelId?: string } | null;
    defaultGlmModelId: string;
    altOpenRouterModel?: ModelContext | null;
    messageCount?: number;
    onmodelchange?: (ctx: ModelContext) => void;
    modelCapabilities?: { image: boolean; audio: boolean; video: boolean; pdf: boolean; documentText: boolean } | null;
    useIntelContext?: boolean;
  } = $props();

  interface ToolStep {
    id?: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    summary?: string;
    expanded?: boolean;
    ephemeral?: {
      handlerCode: string;
      parameters: unknown;
      proposedName?: string;
      proposedDescription?: string;
    };
  }

  interface SubAgentStep {
    toolCallId: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    summary?: string;
    expanded?: boolean;
  }
  interface SubAgentState {
    agentId: string;
    task: string;
    status: 'running' | 'done' | 'error';
    summary?: string;
    liveTokens: string;
    toolSteps: SubAgentStep[];
  }

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
    isProgress?: boolean;
    progressSteps?: string[];
    toolSteps?: ToolStep[];
    source?: string;
    attachments?: Array<{
      id: string;
      kind: 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';
      mimeType: string;
      originalName: string | null;
      sizeBytes: number;
      source: 'web' | 'whatsapp' | 'generated';
    }>;
  }

  function artifactsForMessage(m: Message): ArtifactT[] {
    if (!m.toolSteps) return [];
    const out: ArtifactT[] = [];
    for (const step of m.toolSteps) {
      const r = step.result as { data?: { artifact?: unknown } } | undefined;
      if (r?.data?.artifact && isArtifact(r.data.artifact)) {
        out.push(r.data.artifact);
      }
    }
    return out;
  }

  function promoteMarkersForMessage(m: Message) {
    if (m.role !== 'assistant') return [];
    return parsePromoteMarkers(m.content);
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(true);
  let showToolDrawer = $state(false);
  let expandedTools = $state<Set<number>>(new Set());
  let currentJobId = $state<string | null>(null);
  let heartbeat = $state<{ summary: string; elapsedSec: number } | null>(null);
  let pendingPlan = $state<{ planId: string; plan: PlanPayload } | null>(null);
  let subAgents = $state<Record<string, SubAgentState>>({});
  let chatContainer: HTMLDivElement;
  let eventSource: EventSource | null = null;
  let jobEventSource: EventSource | null = null;

  // Attachment composer state
  interface PendingAttachment {
    id: string;
    kind: string;
    mimeType: string;
    originalName: string | null;
    sizeBytes: number;
    uploading?: boolean;
    error?: string;
    incompatible?: boolean;
  }
  let pendingAttachments = $state<PendingAttachment[]>([]);
  let dragOver = $state(false);
  let fileInputEl: HTMLInputElement | undefined = $state();

  // Toast for rejected file drops/pastes
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = null; }, 4000);
  }

  function kindAllowedByCaps(kind: string): boolean {
    const caps = modelCapabilities;
    if (!caps) return true;
    switch (kind) {
      case 'image': return caps.image;
      case 'audio': return caps.audio;
      case 'video': return caps.video;
      case 'pdf':   return caps.pdf;
      case 'document':
      case 'text':  return caps.documentText;
      default: return false;
    }
  }

  $effect(() => {
    // Re-check compatibility when model capabilities change
    if (modelCapabilities && pendingAttachments.length > 0) {
      pendingAttachments = pendingAttachments.map(a => ({
        ...a,
        incompatible: !kindAllowedByCaps(a.kind),
      }));
    }
  });

  function acceptAttrForCaps(): string {
    const caps = modelCapabilities;
    if (!caps) return '*/*';
    const parts: string[] = [];
    if (caps.image) parts.push('image/*');
    if (caps.audio) parts.push('audio/*');
    if (caps.video) parts.push('video/*');
    if (caps.pdf) parts.push('application/pdf');
    if (caps.documentText) parts.push('text/*', 'application/json');
    return parts.join(',') || '*/*';
  }

  async function uploadFile(file: File): Promise<void> {
    const mimePrefix = file.type.split('/')[0];
    const probableKind = mimePrefix === 'image' ? 'image'
      : mimePrefix === 'audio' ? 'audio'
      : mimePrefix === 'video' ? 'video'
      : file.type === 'application/pdf' ? 'pdf'
      : 'text';
    if (!kindAllowedByCaps(probableKind)) {
      showToast(`This model can't process ${probableKind} files. Switch to a different model.`);
      return;
    }
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    pendingAttachments = [...pendingAttachments, {
      id: tempId, kind: 'unknown', mimeType: file.type, originalName: file.name,
      sizeBytes: file.size, uploading: true,
    }];
    const fd = new FormData();
    fd.append('file', file);
    if (conversationId) fd.append('conversationId', conversationId);
    try {
      const res = await fetch('/api/jkai/attachments', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pendingAttachments = pendingAttachments.map(a =>
          a.id === tempId ? { ...a, uploading: false, error: err.error ?? `upload ${res.status}` } : a
        );
        return;
      }
      const row = await res.json();
      pendingAttachments = pendingAttachments.map(a =>
        a.id === tempId ? { ...row, uploading: false } : a
      );
    } catch (e: any) {
      pendingAttachments = pendingAttachments.map(a =>
        a.id === tempId ? { ...a, uploading: false, error: e?.message ?? 'upload failed' } : a
      );
    }
  }

  async function removeAttachment(id: string): Promise<void> {
    if (!id.startsWith('tmp-')) {
      await fetch(`/api/jkai/attachments/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    pendingAttachments = pendingAttachments.filter(a => a.id !== id);
  }

  function onFilePick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files) return;
    for (const f of Array.from(input.files)) void uploadFile(f);
    input.value = '';
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    if (!e.dataTransfer?.files) return;
    for (const f of Array.from(e.dataTransfer.files)) void uploadFile(f);
  }

  function onPaste(e: ClipboardEvent): void {
    if (!e.clipboardData) return;
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) void uploadFile(f);
      }
    }
  }

  async function handleVoiceBlob(blob: Blob): Promise<void> {
    const f = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
    await uploadFile(f);
  }

  // Aggregate all tool calls across every assistant message in the conversation.
  // Each entry keeps a reference to which message it belongs to.
  let allToolCalls = $derived.by(() => {
    const out: Array<{ messageId: string; messageIndex: number; step: ToolStep }> = [];
    messages.forEach((m, idx) => {
      if (m.toolSteps && m.toolSteps.length > 0) {
        for (const step of m.toolSteps) {
          out.push({ messageId: m.id, messageIndex: idx, step });
        }
      }
    });
    return out;
  });

  function toggleDrawerItem(i: number) {
    const next = new Set(expandedTools);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    expandedTools = next;
  }

  // Sync messages when initialMessages or conversationId changes
  $effect(() => {
    messages = initialMessages.map((m) => {
      const meta = m.metadata as { toolSteps?: ToolStep[]; source?: string } | undefined;
      const raw = m as Record<string, unknown>;
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        metadata: m.metadata,
        // Prefer metadata.source (e.g. 'status_update') over the wrapper source
        source: meta?.source ?? m.source,
        // Hydrate tool steps from stored metadata so the drawer persists across reloads
        toolSteps: meta?.toolSteps,
        attachments: (raw.attachments as Message['attachments']) ?? undefined,
      };
    });
    // Jump instantly to the latest message on initial load / conversation switch.
    // Child content (markdown, tool drawers, attachments) renders across multiple
    // frames, so retry after layout settles to catch the real scrollHeight.
    scrollToBottom('instant');
    setTimeout(() => scrollToBottom('instant'), 50);
    setTimeout(() => scrollToBottom('instant'), 200);
  });

  // SSE connection for real-time follow-up messages
  $effect(() => {
    // Clean up previous connection
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (!conversationId) return;

    const es = new EventSource(`/api/jkai/events?conversationId=${conversationId}`);
    eventSource = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') return; // ignore connection ack

        const newMsg: Message = {
          id: crypto.randomUUID(),
          role: data.role || 'assistant',
          content: data.content,
          source: data.source || 'followup',
        };

        // Status updates are mid-conversation — insert just before the active
        // progress bubble so the user sees them in the right chronological
        // position (before the final answer). Everything else appends.
        if (data.source === 'status_update') {
          const progressIdx = messages.findIndex((m) => m.isProgress);
          if (progressIdx >= 0) {
            messages = [
              ...messages.slice(0, progressIdx),
              newMsg,
              ...messages.slice(progressIdx),
            ];
          } else {
            messages = [...messages, newMsg];
          }
        } else {
          messages = [...messages, newMsg];
        }
        scrollToBottom();
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, no action needed
    };

    return () => {
      es.close();
      eventSource = null;
    };
  });

  async function cancelJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    if (jobEventSource) {
      jobEventSource.close();
      jobEventSource = null;
    }
  }

  function friendlyToolName(name: string): string {
    const labels: Record<string, string> = {
      activate_toolset: 'Loading toolset',
      ha_query_state: 'Querying device',
      ha_call_service: 'Controlling device',
      ha_fire_event: 'Firing event',
      ha_get_history: 'Getting history',
      ha_render_template: 'Running template',
      reverse_geocode: 'Geocoding',
      jkai_help: 'Checking capabilities',
      list_custom_tools: 'Listing tools',
      create_tool: 'Creating tool',
      status_update: 'Status update',
    };
    return labels[name] || name.replace(/_/g, ' ');
  }

  function toggleStepExpanded(stepIndex: number) {
    messages = messages.map((m) => {
      if (!m.isProgress || !m.toolSteps) return m;
      const steps = m.toolSteps.map((s, i) =>
        i === stepIndex ? { ...s, expanded: !s.expanded } : s,
      );
      return { ...m, toolSteps: steps };
    });
  }

  function toggleSubAgentStep(agentId: string, toolCallId: string) {
    const a = subAgents[agentId];
    if (!a) return;
    const step = a.toolSteps.find((s) => s.toolCallId === toolCallId);
    if (step) step.expanded = !step.expanded;
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !conversationId) return;

    input = '';
    loading = true;
    heartbeat = null;
    pendingPlan = null;
    subAgents = {};

    const attachmentIds = pendingAttachments
      .filter(a => !a.uploading && !a.error && !a.incompatible)
      .map(a => a.id);
    const userAttachments = pendingAttachments
      .filter(a => !a.uploading && !a.error && !a.incompatible)
      .map(a => ({ id: a.id, kind: a.kind as any, mimeType: a.mimeType, originalName: a.originalName, sizeBytes: a.sizeBytes, source: 'web' as const }));
    pendingAttachments = [];

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      source: 'web',
      attachments: userAttachments.length > 0 ? userAttachments : undefined,
    };
    messages = [...messages, userMsg];
    scrollToBottom();

    const progressId = crypto.randomUUID();
    // Start with a subtle typing indicator — no progress box yet
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: '',
      isProgress: true,
      progressSteps: [],
      toolSteps: [],
    }];
    scrollToBottom();

    try {
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          useIntelContext,
        }),
      });

      const postData = await postRes.json().catch(() => null);

      if (!postRes.ok) {
        throw new Error(postData?.error || `Server error (${postRes.status})`);
      }

      const jobId = postData?.jobId;
      if (!jobId) throw new Error('No job ID returned');
      currentJobId = jobId;

      // Subscribe to live token + tool events via SSE.
      await new Promise<void>((resolve) => {
        let accumulatedContent = '';
        let finished = false;
        const TIMEOUT = 300000;

        const cleanup = () => {
          if (jobEventSource) {
            jobEventSource.close();
            jobEventSource = null;
          }
          if (timeoutHandle) clearTimeout(timeoutHandle);
        };

        const finalize = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve();
        };

        const timeoutHandle = setTimeout(() => {
          if (finished) return;
          messages = messages.map((m) =>
            m.id === progressId
              ? { ...m, isProgress: false, content: 'Still working... check back shortly.' }
              : m,
          );
          finalize();
        }, TIMEOUT);

        const es = new EventSource(`/api/workflows/orchestrator/chat/stream?jobId=${jobId}`);
        jobEventSource = es;

        es.onmessage = (event) => {
          let data: any;
          try { data = JSON.parse(event.data); } catch { return; }

          if (data.type === 'connected') return;

          if (data.type === 'token') {
            heartbeat = null;
            accumulatedContent += data.delta;
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, content: accumulatedContent } : m,
            );
            scrollToBottom();
            return;
          }

          if (data.type === 'tool_start') {
            heartbeat = null;
            const newStep: ToolStep = {
              tool: data.tool,
              args: data.args || {},
              status: 'running',
            };
            messages = messages.map((m) => {
              if (m.id !== progressId) return m;
              return { ...m, toolSteps: [...(m.toolSteps ?? []), newStep] };
            });
            scrollToBottom();
            return;
          }

          if (data.type === 'tool_result') {
            heartbeat = null;
            messages = messages.map((m) => {
              if (m.id !== progressId || !m.toolSteps) return m;
              // Find the most recent running step for this tool name and finalise it
              const idx = (() => {
                for (let i = m.toolSteps.length - 1; i >= 0; i--) {
                  if (m.toolSteps[i].tool === data.tool && m.toolSteps[i].status === 'running') return i;
                }
                return -1;
              })();
              if (idx < 0) return m;
              const next = m.toolSteps.slice();
              next[idx] = { ...next[idx], result: data.result, status: data.status, summary: data.summary };
              return { ...m, toolSteps: next };
            });
            scrollToBottom();
            return;
          }

          if (data.type === 'status') {
            heartbeat = null;
            // Mid-task working note — same UX as `/api/jkai/events` status_update
            const newMsg: Message = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.text,
              source: 'status_update',
            };
            const progressIdx = messages.findIndex((m) => m.isProgress);
            if (progressIdx >= 0) {
              messages = [
                ...messages.slice(0, progressIdx),
                newMsg,
                ...messages.slice(progressIdx),
              ];
            } else {
              messages = [...messages, newMsg];
            }
            scrollToBottom();
            return;
          }

          if (data.type === 'heartbeat') {
            heartbeat = {
              summary: data.summary,
              elapsedSec: Math.round((data.elapsedMs ?? 0) / 1000),
            };
            return;
          }

          if (data.type === 'plan') {
            pendingPlan = { planId: data.planId, plan: data.plan };
            heartbeat = null;
            return;
          }

          if (data.type === 'plan_ack') {
            pendingPlan = null;
            return;
          }

          if (data.type === 'subagent_start') {
            subAgents[data.agentId] = {
              agentId: data.agentId,
              task: data.task,
              status: 'running',
              liveTokens: '',
              toolSteps: [],
            };
            heartbeat = null;
            return;
          }

          if (data.type === 'subagent_event') {
            const a = subAgents[data.agentId];
            if (!a) return;
            const ev = data.event;
            if (ev.type === 'token') {
              a.liveTokens += ev.delta;
            } else if (ev.type === 'tool_start') {
              a.toolSteps.push({
                toolCallId: ev.toolCallId ?? crypto.randomUUID(),
                tool: ev.tool,
                args: ev.args ?? {},
                status: 'running',
              });
            } else if (ev.type === 'tool_result') {
              const callId = ev.toolCallId;
              let idx = -1;
              if (callId) idx = a.toolSteps.findIndex((s) => s.toolCallId === callId);
              if (idx < 0) {
                for (let i = a.toolSteps.length - 1; i >= 0; i--) {
                  if (a.toolSteps[i].tool === ev.tool && a.toolSteps[i].status === 'running') { idx = i; break; }
                }
              }
              if (idx >= 0) {
                a.toolSteps[idx] = { ...a.toolSteps[idx], status: ev.status, result: ev.result, summary: ev.summary };
              }
            }
            return;
          }

          if (data.type === 'subagent_done') {
            const a = subAgents[data.agentId];
            if (a) {
              a.status = 'done';
              a.summary = data.summary;
              a.liveTokens = '';
            }
            return;
          }

          if (data.type === 'done') {
            heartbeat = null;
            pendingPlan = null;
            const result = (data.result || {}) as {
              message?: string;
              error?: string;
              workflow?: unknown;
              thinking?: OrchestratorThinking;
              attachments?: Message['attachments'];
            };
            const prior = messages.find((m) => m.id === progressId);
            // Authoritative final content from persisted responseText. Fall
            // back to streamed tokens if absent (shouldn't happen).
            const finalContent = result.message || result.error || accumulatedContent || 'No response.';
            const finalMsg: Message = {
              id: progressId,
              role: 'assistant',
              content: finalContent,
              metadata: { workflowGenerated: !!result.workflow },
              thinking: result.thinking || undefined,
              isProgress: false,
              source: 'web',
              toolSteps: prior?.toolSteps,
              attachments: result.attachments ?? undefined,
            };
            messages = messages.map((m) => (m.id === progressId ? finalMsg : m));
            scrollToBottom();
            finalize();
            return;
          }

          if (data.type === 'error') {
            heartbeat = null;
            pendingPlan = null;
            messages = messages.map((m) =>
              m.id === progressId
                ? { ...m, isProgress: false, content: `Error: ${data.message ?? 'Unknown error'}` }
                : m,
            );
            scrollToBottom();
            finalize();
            return;
          }
        };

        es.onerror = () => {
          // Browser may auto-reconnect; if the stream really died, the
          // server-side timeout will fire and we'll show the fallback message.
        };
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messages = messages.map((m) =>
        m.id === progressId ? { ...m, isProgress: false, content: `Error: ${errMsg}` } : m,
      );
    }

    loading = false;
    currentJobId = null;
    heartbeat = null;
    pendingPlan = null;
    scrollToBottom();
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    requestAnimationFrame(() => {
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="flex flex-col h-full relative">
  <!-- Chat header -->
  <div class="px-3 sm:px-4 py-2 border-b flex items-center justify-between gap-2" style="border-color: var(--card-border);">
    <div class="flex items-center gap-2 min-w-0">
      <p class="text-[11px] hidden sm:block" style="color: var(--text-ghost);">
        {#if !conversationId}
          Select or start a conversation
        {:else}
          Chat with the orchestrator — ask anything, build workflows, control your home
        {/if}
      </p>
      {#if conversationId && conversation?.modelId}
        <ChatModelToggle
          {conversationId}
          modelProvider={(conversation.modelProvider ?? 'zai') as 'zai' | 'openrouter'}
          modelId={conversation.modelId}
          {messageCount}
          {altOpenRouterModel}
          {defaultGlmModelId}
          onChanged={(ctx) => onmodelchange?.(ctx)}
        />
      {/if}
    </div>
    {#if conversationId}
      <div class="chat-toolbar">
        {#if allToolCalls.length > 0}
          <button
            type="button"
            onclick={() => { showToolDrawer = !showToolDrawer; }}
            class="nm-btn-ghost"
            data-active={showToolDrawer ? 'true' : 'false'}
            title="View all tool calls in this conversation"
          >
            Tool calls ({allToolCalls.length})
          </button>
        {/if}
        <button
          type="button"
          onclick={() => { showThinking = !showThinking; }}
          class="nm-btn-ghost"
          data-active={showThinking ? 'true' : 'false'}
        >
          {showThinking ? 'Hide' : 'Show'} thinking
        </button>
      </div>
    {/if}
  </div>

  <!-- Messages -->
  <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-3 sm:p-4">
    {#if !conversationId}
      <div class="flex items-center justify-center h-full">
        <p class="text-sm" style="color: var(--text-ghost);">
          Start a new conversation or select one from the sidebar.
        </p>
      </div>
    {:else if messages.length === 0}
      <div class="flex items-center justify-center h-full">
        <div class="text-center max-w-md">
          <p class="text-sm mb-2" style="color: var(--text-ghost);">
            Ask me anything — control your smart home, check health data, manage blog posts, start builds, or create workflows.
          </p>
        </div>
      </div>
    {:else}
      <div class="max-w-3xl mx-auto">
        {#each messages as msg, msgIndex (msg.id)}
          {#if msg.isProgress}
            {#if msg.toolSteps && msg.toolSteps.length > 0}
              <!-- Tool progress box — only shown when tools are actually being used -->
              <div class="progress-bubble mb-3">
                <div class="progress-bubble-hdr">
                  <span class="working-dot" aria-hidden="true"></span>
                  <span class="sr-label-tight working-label">Working</span>
                  <button
                    type="button"
                    onclick={cancelJob}
                    class="nm-btn-ghost cancel-btn"
                  >
                    Cancel
                  </button>
                </div>
                {#if pendingPlan}
                  <PlanCard
                    planId={pendingPlan.planId}
                    plan={pendingPlan.plan}
                    jobId={currentJobId ?? ''}
                    onresolve={() => { pendingPlan = null; }}
                  />
                {/if}
                {#if heartbeat}
                  <div class="heartbeat-line" role="status" aria-live="polite">
                    <span class="hb-dot"></span>
                    <span class="hb-summary">{heartbeat.summary}</span>
                    <span class="hb-elapsed">{heartbeat.elapsedSec}s</span>
                  </div>
                {/if}
                {#each Object.values(subAgents) as agent (agent.agentId)}
                  <SubAgentBubble {agent} onToggleStep={toggleSubAgentStep} />
                {/each}
                <ul class="step-cards">
                  {#each msg.toolSteps as step, stepIndex}
                    {#if step.tool === 'status_update'}
                      <li class="step-status-update-wrap">
                        <!-- Status updates render inline as plain prose -->
                        <div class="status-update-inline">
                          <div class="sr-label-tight status-update-label">Status update</div>
                          {(step.result as { message?: string })?.message ?? ''}
                        </div>
                      </li>
                    {:else}
                      <li class="step-card" data-status={step.status}>
                        <header class="step-card-hdr">
                          <span class="step-status" data-status={step.status} aria-label={step.status}>
                            {#if step.status === 'running'}
                              <span class="sc-dot"></span>
                            {:else if step.status === 'error'}
                              ✗
                            {:else}
                              ✓
                            {/if}
                          </span>
                          <span class="step-tool">{friendlyToolName(step.tool)}</span>
                          <span class="step-summary">{step.summary ?? (step.status === 'running' ? '…' : '')}</span>
                          {#if step.result !== undefined || Object.keys(step.args).length > 0}
                            <button
                              type="button"
                              class="step-toggle"
                              onclick={() => toggleStepExpanded(stepIndex)}
                              aria-expanded={step.expanded ? 'true' : 'false'}
                            >
                              {step.expanded ? 'hide' : 'details'}
                            </button>
                          {/if}
                        </header>
                        {#if step.expanded}
                          <div class="step-card-body">
                            {#if Object.keys(step.args).length > 0}
                              <details open>
                                <summary class="step-body-label">args</summary>
                                <JsonBlock data={step.args} />
                              </details>
                            {/if}
                            {#if step.result !== undefined}
                              <details open>
                                <summary class="step-body-label">result</summary>
                                <JsonBlock data={step.result} />
                              </details>
                            {/if}
                          </div>
                        {/if}
                      </li>
                    {/if}
                  {/each}
                </ul>
              </div>
            {:else}
              <!-- Subtle typing indicator — no tools yet -->
              {#if pendingPlan}
                <PlanCard
                  planId={pendingPlan.planId}
                  plan={pendingPlan.plan}
                  jobId={currentJobId ?? ''}
                  onresolve={() => { pendingPlan = null; }}
                />
              {/if}
              {#if heartbeat}
                <div class="heartbeat-line mb-3" role="status" aria-live="polite">
                  <span class="hb-dot"></span>
                  <span class="hb-summary">{heartbeat.summary}</span>
                  <span class="hb-elapsed">{heartbeat.elapsedSec}s</span>
                </div>
              {/if}
              {#each Object.values(subAgents) as agent (agent.agentId)}
                <SubAgentBubble {agent} onToggleStep={toggleSubAgentStep} />
              {/each}
              <div class="mb-3 flex items-center gap-1 px-1 py-2">
                <span class="typing-dot" style="background: var(--text-ghost);"></span>
                <span class="typing-dot" style="background: var(--text-ghost); animation-delay: 0.15s;"></span>
                <span class="typing-dot" style="background: var(--text-ghost); animation-delay: 0.3s;"></span>
              </div>
            {/if}
          {:else if msg.source === 'status_update'}
            <!-- Mid-task working note — stylistically distinct from a real reply -->
            <div class="flex justify-start mb-3">
              <div class="status-update-msg">
                <div class="sr-label-tight status-update-label">Working...</div>
                {msg.content}
              </div>
            </div>
          {:else}
            {#if msg.role === 'assistant'}
              {#each artifactsForMessage(msg) as artifact, i (i)}
                <Artifact {artifact} />
              {/each}
              {#each promoteMarkersForMessage(msg) as marker (marker.toolCallId)}
                <PromoteToolBanner messageId={msg.id} {marker} />
              {/each}
            {/if}
            <div class="relative">
              {#if msg.source === 'followup'}
                <span
                  class="absolute -left-6 top-2 text-[9px] px-1 py-0.5 rounded"
                  style="background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent);"
                  title="Async follow-up"
                >
                  FU
                </span>
              {:else if msg.source === 'whatsapp'}
                <span
                  class="absolute -left-6 top-2 text-[9px] px-1 py-0.5 rounded"
                  style="background: rgba(37, 211, 102, 0.15); color: #25d366;"
                  title="From WhatsApp"
                >
                  WA
                </span>
              {/if}
              <ChatMessage
                role={msg.role}
                content={msg.role === 'assistant' ? stripPromoteMarkers(msg.content) : msg.content}
                metadata={msg.metadata}
                thinking={msg.thinking}
                {showThinking}
              />
              {#if msg.attachments && msg.attachments.length > 0}
                <MessageAttachments attachments={msg.attachments} />
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Input -->
  {#if conversationId}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="p-3 sm:p-4 border-t relative"
      style="border-color: var(--card-border);"
      ondragenter={(e) => { e.preventDefault(); dragOver = true; }}
      ondragover={(e) => e.preventDefault()}
      ondragleave={() => { dragOver = false; }}
      ondrop={onDrop}
    >
      {#if dragOver}
        <div class="absolute inset-0 z-10 border-2 border-dashed rounded flex items-center justify-center pointer-events-none" style="border-color: var(--accent, #3498db); background: rgba(0,0,0,0.3); color: white;">
          Drop files to attach
        </div>
      {/if}
      <div class="max-w-3xl mx-auto">
        <ComposerAttachmentTray items={pendingAttachments} onRemove={removeAttachment} />
        <div class="flex gap-2 items-end">
          <button
            type="button"
            onclick={() => fileInputEl?.click()}
            aria-label="Attach file"
            class="p-2 opacity-60 hover:opacity-100 shrink-0 self-end"
            title="Attach file"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input bind:this={fileInputEl} type="file" class="hidden" multiple accept={acceptAttrForCaps()} onchange={onFilePick} />
          <textarea
            bind:value={input}
            onkeydown={handleKeydown}
            onpaste={onPaste}
            placeholder="Ask anything..."
            disabled={loading}
            class="nm-text-input composer-textarea flex-1"
            rows="1"
          ></textarea>
          <VoiceRecorder onRecorded={handleVoiceBlob} disabled={modelCapabilities != null && !modelCapabilities.audio} />
          <button
            type="button"
            onclick={send}
            disabled={loading || !input.trim() || pendingAttachments.some(a => a.uploading || a.incompatible)}
            class="nm-save-btn composer-send self-end"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Tool call drawer -->
  {#if showToolDrawer && conversationId}
    <!-- Backdrop (click to close) -->
    <button
      class="absolute inset-0 z-20 cursor-default"
      style="background: rgba(0, 0, 0, 0.3);"
      onclick={() => { showToolDrawer = false; }}
      aria-label="Close tool call drawer"
    ></button>
    <!-- Drawer -->
    <aside
      class="absolute top-0 right-0 h-full z-30 flex flex-col border-l shadow-xl"
      style="width: min(420px, 90vw); background: var(--bg); border-color: var(--card-border);"
    >
      <div class="drawer-hdr">
        <div class="drawer-hdr-main">
          <div class="sr-label-tight drawer-title">Tool calls</div>
          <div class="drawer-subtitle">{allToolCalls.length} total in this conversation</div>
        </div>
        <button
          type="button"
          onclick={() => { showToolDrawer = false; }}
          class="drawer-close"
          aria-label="Close"
        >&times;</button>
      </div>
      <div class="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {#each allToolCalls as entry, i (i)}
          <div class="drawer-item" data-status={entry.step.status}>
            <button
              type="button"
              class="drawer-item-hdr w-full flex items-center gap-2 px-2 py-1.5 text-left hover:opacity-80"
              onclick={() => toggleDrawerItem(i)}
            >
              <span class="drawer-item-idx">#{i + 1}</span>
              <span class="drawer-item-status" data-status={entry.step.status}>
                {#if entry.step.status === 'running'}&#9679;
                {:else if entry.step.status === 'error'}&#10007;
                {:else}&#10003;
                {/if}
              </span>
              <span class="drawer-item-name flex-1 truncate">
                {friendlyToolName(entry.step.tool)}
              </span>
              <span class="drawer-item-toggle">
                {expandedTools.has(i) ? '-' : '+'}
              </span>
            </button>
            {#if expandedTools.has(i)}
              <div class="px-2 pb-2 space-y-2">
                {#if Object.keys(entry.step.args).length > 0}
                  <div>
                    <div class="sr-label-tight drawer-body-label">Args</div>
                    <JsonBlock data={entry.step.args} />
                  </div>
                {/if}
                {#if entry.step.result !== undefined}
                  <div>
                    <div class="sr-label-tight drawer-body-label">Result</div>
                    <JsonBlock data={entry.step.result} />
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        {#if allToolCalls.length === 0}
          <div class="drawer-empty">
            No tool calls yet.
          </div>
        {/if}
      </div>
    </aside>
  {/if}

  {#if toast}
    <div class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-sm z-50" style="background: #c0392b; color: white;">
      {toast}
    </div>
  {/if}
</div>

<style>
  .typing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
    animation: typing-bounce 1.2s ease-in-out infinite;
    opacity: 0.5;
  }

  @keyframes typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
    30% { transform: translateY(-4px); opacity: 0.7; }
  }

  .heartbeat-line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    border-bottom: 1px solid var(--card-border);
  }
  .heartbeat-line .hb-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: hb-pulse 1.4s ease-in-out infinite;
  }
  .heartbeat-line .hb-summary { flex: 1; }
  .heartbeat-line .hb-elapsed { opacity: 0.7; font-variant-numeric: tabular-nums; }
  @keyframes hb-pulse {
    0%, 100% { opacity: 0.25; transform: scale(0.85); }
    50%      { opacity: 1;    transform: scale(1.1);  }
  }

  .step-cards {
    list-style: none;
    margin: 0;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .step-card {
    padding: 6px 10px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    border-radius: 3px;
    transition: border-color 100ms ease;
  }
  .step-card[data-status="error"] {
    border-color: color-mix(in srgb, var(--status-error) 55%, transparent);
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
  }
  .step-card[data-status="running"] {
    border-color: var(--accent);
  }
  .step-card-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .step-status {
    width: 14px;
    text-align: center;
    color: var(--text-ghost);
  }
  .step-status[data-status="running"] { color: var(--accent); }
  .step-status[data-status="error"]   { color: var(--status-error); }
  .step-status[data-status="done"]    { color: var(--status-success); }
  .sc-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: hb-pulse 1.4s ease-in-out infinite;
  }
  .step-tool {
    color: var(--text-primary);
    flex-shrink: 0;
  }
  .step-summary {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-toggle {
    background: transparent;
    border: 0;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 2px 4px;
  }
  .step-toggle:hover { color: var(--text-primary); }
  .step-card-body {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .step-body-label {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    cursor: pointer;
    padding: 2px 0;
  }
  .step-status-update-wrap {
    list-style: none;
  }

  /* Chat header toolbar — groups the ghost buttons on the right side */
  .chat-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .chat-toolbar :global(.nm-btn-ghost) {
    padding: 4px 10px;
    font-size: 9px;
  }

  /* Progress bubble — outer box for tool step cards */
  .progress-bubble {
    background: var(--card-bg);
    border: 1px solid var(--accent);
    overflow: hidden;
  }
  .progress-bubble-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--accent-tint-08);
    border-bottom: 1px solid var(--card-border);
  }
  .working-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: hb-pulse 1.4s ease-in-out infinite;
  }
  .working-label {
    color: var(--accent);
    letter-spacing: 0.14em;
  }
  .cancel-btn {
    margin-left: auto;
    padding: 3px 10px;
    font-size: 9px;
  }

  /* Inline status-update block inside the step list */
  .status-update-inline {
    padding: 6px 10px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text-primary);
    border-left: 2px solid var(--accent);
    font-size: 12px;
    line-height: 1.45;
  }
  .status-update-label {
    color: var(--accent);
    margin-bottom: 3px;
    letter-spacing: 0.14em;
  }

  /* Mid-task working note (separate message, not inside the progress box) */
  .status-update-msg {
    max-width: 85%;
    padding-left: 10px;
    padding-top: 2px;
    padding-bottom: 2px;
    color: var(--text-secondary);
    border-left: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
    font-size: 12px;
    font-style: italic;
    line-height: 1.5;
  }
  .status-update-msg .status-update-label {
    font-style: normal;
    margin-bottom: 1px;
  }

  /* Composer textarea + send — scoped sizing on top of .nm-text-input / .nm-save-btn */
  .composer-textarea {
    font-family: var(--font-body);
    font-size: 13px;
    min-height: 44px;
    max-height: 160px;
    padding: 9px 12px;
    resize: none;
  }
  .composer-send {
    padding: 10px 16px;
    font-size: 11px;
    letter-spacing: 0.14em;
  }

  /* Tool call drawer */
  .drawer-hdr {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 10px 14px;
    border-bottom: 1px solid var(--card-border);
  }
  .drawer-hdr-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .drawer-title {
    color: var(--accent);
    letter-spacing: 0.14em;
  }
  .drawer-subtitle {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
  .drawer-close {
    margin-left: auto;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    color: var(--text-ghost);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .drawer-close:hover { color: var(--text-primary); }

  .drawer-item {
    border: 1px solid var(--card-border);
    background: rgba(26, 16, 8, 0.04);
  }
  .drawer-item[data-status="running"] { border-color: var(--accent); }
  .drawer-item[data-status="error"]   { border-color: color-mix(in srgb, var(--status-error) 55%, transparent); }
  .drawer-item-hdr {
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .drawer-item-idx {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
    width: 20px;
    flex-shrink: 0;
    text-align: right;
  }
  .drawer-item-status {
    font-size: 10px;
    flex-shrink: 0;
    color: var(--text-ghost);
  }
  .drawer-item-status[data-status="running"] { color: var(--accent); }
  .drawer-item-status[data-status="error"]   { color: var(--status-error); }
  .drawer-item-status[data-status="done"]    { color: var(--status-success); }
  .drawer-item-name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
  }
  .drawer-item-toggle {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .drawer-body-label {
    margin-bottom: 3px;
  }
  .drawer-empty {
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: center;
    padding: 2rem 0;
    color: var(--text-ghost);
  }
</style>
