<script lang="ts">
  import JsonBlock from '$lib/components/jkai/JsonBlock.svelte';
  import { categorizeTool, resolveDisplayTool } from '$lib/workflows/chat/tool-summary';

  export interface SubAgentStep {
    toolCallId: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    summary?: string;
    expanded?: boolean;
  }

  export interface SubAgent {
    agentId: string;
    task: string;
    status: 'running' | 'done' | 'error';
    summary?: string;
    liveTokens: string;
    toolSteps: SubAgentStep[];
  }

  let { agent, onToggleStep }: {
    agent: SubAgent;
    onToggleStep: (agentId: string, toolCallId: string) => void;
  } = $props();
</script>

<section class="subagent-bubble" data-status={agent.status} aria-label="Sub-agent progress">
  <header class="sa-hdr">
    <span class="sr-label-tight">sub-agent</span>
    <span class="sa-task">{agent.task}</span>
    <span class="sa-status" data-status={agent.status}>
      {#if agent.status === 'running'}<span class="sa-dot"></span> running
      {:else if agent.status === 'error'}✗ error
      {:else}✓ done
      {/if}
    </span>
  </header>

  {#if agent.summary && agent.status !== 'running'}
    <div class="sa-summary">{agent.summary}</div>
  {/if}

  {#if agent.toolSteps.length > 0}
    <ul class="sa-steps">
      {#each agent.toolSteps as step (step.toolCallId)}
        {@const dTool = resolveDisplayTool(step.tool, step.args).tool}
        {@const stepCat = categorizeTool(dTool)}
        <li class="sa-step" data-status={step.status}>
          <header class="sa-step-hdr">
            <span class="sa-step-status" data-status={step.status}>
              {#if step.status === 'running'}<span class="sa-dot"></span>
              {:else if step.status === 'error'}✗
              {:else}✓
              {/if}
            </span>
            <span class="sa-step-cat" data-cat={stepCat}>{stepCat}</span>
            <span class="sa-step-summary">{step.summary || dTool.replace(/_/g, ' ')}{step.status === 'running' && !step.summary ? ' …' : ''}</span>
            {#if step.result !== undefined || Object.keys(step.args).length > 0}
              <button
                type="button"
                class="sa-step-toggle"
                onclick={() => onToggleStep(agent.agentId, step.toolCallId)}
                aria-expanded={step.expanded ? 'true' : 'false'}
              >
                {step.expanded ? 'hide' : 'details'}
              </button>
            {/if}
          </header>
          {#if step.expanded}
            <div class="sa-step-body">
              {#if Object.keys(step.args).length > 0}
                <details open><summary class="sr-label-tight">args</summary><JsonBlock data={step.args} /></details>
              {/if}
              {#if step.result !== undefined}
                <details open><summary class="sr-label-tight">result</summary><JsonBlock data={step.result} /></details>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if agent.status === 'running' && agent.liveTokens}
    <pre class="sa-live">{agent.liveTokens}</pre>
  {/if}
</section>

<style>
  .subagent-bubble {
    border-left: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 3%, transparent);
    padding: 8px 10px;
    margin: 6px 0 6px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: var(--font-mono);
  }
  .subagent-bubble[data-status="error"] { border-left-color: var(--status-error); }
  .subagent-bubble[data-status="done"]  { border-left-color: var(--status-success); }

  .sa-hdr {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sa-task {
    flex: 1;
    font-size: 11px;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sa-status {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .sa-status[data-status="error"] { color: var(--status-error); }
  .sa-status[data-status="done"]  { color: var(--status-success); }
  .sa-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: currentColor;
    animation: hb-pulse 1.4s ease-in-out infinite;
  }

  .sa-summary {
    font-size: 11px;
    color: var(--text-secondary);
    padding: 4px 8px;
    background: var(--bg-section);
    border-left: 2px solid var(--card-border);
  }

  .sa-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sa-step {
    border: 1px solid var(--card-border);
    padding: 4px 8px;
    background: var(--bg-section);
  }
  .sa-step[data-status="running"] { border-color: var(--accent); }
  .sa-step[data-status="error"]   { border-color: var(--status-error); }
  .sa-step-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .sa-step-status {
    width: 14px;
    text-align: center;
    color: var(--text-ghost);
  }
  .sa-step-status[data-status="running"] { color: var(--accent); }
  .sa-step-status[data-status="error"]   { color: var(--status-error); }
  .sa-step-status[data-status="done"]    { color: var(--status-success); }
  .sa-step-tool { color: var(--text-primary); flex-shrink: 0; }
  .sa-step-cat {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    padding: 0 4px;
    border-radius: var(--radius-sharp);
    border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
    color: var(--text-muted);
  }
  .sa-step-cat[data-cat="WEB"],
  .sa-step-cat[data-cat="MAIL"],
  .sa-step-cat[data-cat="AGENT"] { color: var(--accent-ink); }
  .sa-step-cat[data-cat="RUN"] { color: var(--accent); }
  .sa-step-cat[data-cat="HOME"] { color: var(--status-success); }
  .sa-step-cat[data-cat="SCHED"] { color: var(--warn); }
  .sa-step-summary {
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sa-step-toggle {
    background: transparent;
    border: 0;
    color: var(--text-ghost);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 2px 4px;
  }
  .sa-step-toggle:hover { color: var(--text-primary); }
  .sa-step-body { margin-top: 6px; }

  .sa-live {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-section);
    padding: 6px 8px;
    margin: 0;
    max-height: 180px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  @keyframes hb-pulse {
    0%, 100% { opacity: 0.25; transform: scale(0.85); }
    50%      { opacity: 1;    transform: scale(1.1);  }
  }
</style>
