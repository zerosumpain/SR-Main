import { register } from '../registry-internal';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { searchResearch } from '$lib/deepdive/research-search';
import { coerceDepth, depthPreset, RESEARCH_DEPTHS } from '$lib/deepdive/depth';
import { coerceScope } from '$lib/deepdive/scope';

// ==========================================
// Existing Tools (moved)
// ==========================================

register({
  name: 'research_start',
  description:
    'Start a research session on a topic. `depth` picks how much work to do: ' +
    "'instant' answers from model knowledge with no sources (seconds); " +
    "'scan' is one round of web search with citations (under 90s); " +
    "'brief' adds extracted facts and entities (under 2 minutes); " +
    "'investigation' is the full multi-phase engine with red-teaming (20+ minutes). " +
    'Use `scope` to bind the search to particular domains.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Research topic' },
      goals: { type: 'array', items: { type: 'string' }, description: 'Specific research goals' },
      depth: {
        type: 'string',
        enum: [...RESEARCH_DEPTHS],
        description: 'How much research to do. Defaults to brief.',
      },
      scope: {
        type: 'object',
        description:
          "Optional source binding. mode 'open' (anywhere), 'bounded' (prefer these domains), " +
          "'exclusive' (only these domains).",
        properties: {
          mode: { type: 'string', enum: ['open', 'bounded', 'exclusive'] },
          includeDomains: { type: 'array', items: { type: 'string' } },
          excludeDomains: { type: 'array', items: { type: 'string' } },
          seedUrls: { type: 'array', items: { type: 'string' } },
          recency: { type: 'object', properties: { days: { type: 'number' } } },
        },
      },
    },
    required: ['topic'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  producesLongRunningTask: { kind: 'research', idPath: 'id', cadenceSeconds: 60 },
  handler: async (args) => {
    const { startResearch, runResearchSync } = await import('$lib/deepdive/worker');
    const depth = coerceDepth(args.depth);
    const preset = depthPreset(depth);

    const [session] = await db
      .insert(researchSessions)
      .values({
        topic: args.topic as string,
        goals: (args.goals as string[]) ?? [],
        depth,
        scope: coerceScope(args.scope),
        budgetMs: preset.budgetMs,
        config: preset.config,
      })
      .returning();

    // A budgeted tier finishes inside the caller's patience, so returning the
    // ANSWER beats returning an id and making the caller poll for it. Only the
    // unbounded investigation goes to the background.
    if (preset.budgetMs != null) {
      const finished = await runResearchSync(session.id);
      const report = finished.report as { executive_summary?: string } | null;
      return {
        success: finished.status === 'complete',
        data: {
          id: finished.id,
          depth,
          status: finished.status,
          durationMs: finished.durationMs,
          answer: report?.executive_summary ?? '',
          error: finished.errorMessage ?? undefined,
        },
      };
    }

    startResearch(session.id);
    return { success: true, data: session };
  },
});

register({
  name: 'research_status',
  description: 'Check the status and stats of a research session',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Research session ID' } },
    required: ['id'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    return session ? { success: true, data: session } : { success: false, error: 'Session not found' };
  },
});

register({
  name: 'research_list',
  description:
    'List recent research sessions with topic, status, and stats. ' +
    'Compact by default — returns only the identifying fields (id, topic, status, createdAt) to keep token usage low. ' +
    'Pass verbose:true to return the full rows including heavy columns (goals, config, report, seedContext).',
  parameters: {
    type: 'object',
    properties: {
      verbose: { type: 'boolean', description: 'Set true to return full rows including heavy columns; defaults to compact identifying fields only' },
    },
    required: [],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const verbose = (args?.verbose as boolean) === true;
    if (verbose) {
      const rows = await db.select().from(researchSessions).orderBy(desc(researchSessions.createdAt)).limit(50);
      return { success: true, data: rows };
    }
    const rows = await db
      .select({
        id: researchSessions.id,
        topic: researchSessions.topic,
        status: researchSessions.status,
        createdAt: researchSessions.createdAt,
      })
      .from(researchSessions)
      .orderBy(desc(researchSessions.createdAt))
      .limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'research_get_report',
  description: 'Get the narrative report/findings from a completed research session',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Research session ID' } },
    required: ['id'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };
    return { success: true, data: { topic: session.topic, status: session.status, report: session.report } };
  },
});

register({
  name: 'research_control',
  description: 'Control a research session: stop it or skip the current phase',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research session ID' },
      action: { type: 'string', description: '"stop" or "skip"' },
    },
    required: ['id', 'action'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const action = args.action as string;
    if (action === 'stop') {
      await db.update(researchSessions).set({ status: 'cancelled' }).where(eq(researchSessions.id, args.id as string));
    }
    return { success: true, data: { action, id: args.id } };
  },
});

// ==========================================
// Inspection Tools
// ==========================================

register({
  name: 'research_inspect',
  description: 'Full view of a research session — topic, goals, status, config, parent session (if branched), report summary, timestamps',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Research session ID' } },
    required: ['id'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };

    let parentTopic: string | null = null;
    if (session.parentSessionId) {
      const [parent] = await db
        .select({ topic: researchSessions.topic })
        .from(researchSessions)
        .where(eq(researchSessions.id, session.parentSessionId))
        .limit(1);
      parentTopic = parent?.topic ?? null;
    }

    const report = session.report as Record<string, unknown> | null;
    let reportSummary: string | null = null;
    if (report) {
      const reportStr = typeof report === 'string' ? report : JSON.stringify(report);
      reportSummary = reportStr.length > 500 ? reportStr.slice(0, 500) + '...' : reportStr;
    }

    return {
      success: true,
      data: {
        ...session,
        parentTopic,
        reportSummary,
      },
    };
  },
});

// ==========================================
// Capability Tools
// ==========================================

register({
  name: 'research_query',
  description: "Ask a question answered from a research session's findings. Returns the answer and confidence level. If the research lacks sufficient information, suggests follow-up options (branch research or web search).",
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research session ID' },
      question: { type: 'string', description: 'Question to answer from the research' },
    },
    required: ['id', 'question'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };
    if (!session.report) return { success: false, error: 'Session has no report yet — it may still be running' };

    const reportText = typeof session.report === 'string'
      ? session.report
      : JSON.stringify(session.report);

    const { getLLMClient } = await import('$lib/llm/client');
    const { resolveResearchDeepModel } = await import('$lib/server/models/workload-settings');
    const { currentSessionModel } = await import('$lib/context/chat');
    const { client, model } = await getLLMClient(
      currentSessionModel() ?? (await resolveResearchDeepModel()),
    );

    const systemPrompt = `You are answering a question using ONLY the research findings provided below. Do not use any external knowledge.

Research Topic: ${session.topic}
Research Findings:
${reportText}

Instructions:
1. Answer the question using only information from the research above.
2. After your answer, on a new line write exactly one of:
   CONFIDENCE: high — if the research clearly answers this
   CONFIDENCE: low — if the research only partially covers this or you're extrapolating
   CONFIDENCE: none — if the research doesn't contain relevant information
3. If confidence is "low" or "none", on a new line suggest ONE follow-up action:
   SUGGEST: branch "<subtopic>" — to research a specific subtopic in depth
   SUGGEST: web_search "<query>" — for a quick factual lookup`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: args.question as string },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';

    const confidenceMatch = text.match(/CONFIDENCE:\s*(high|low|none)/i);
    const confidence = confidenceMatch ? confidenceMatch[1].toLowerCase() : 'low';

    const suggestMatch = text.match(/SUGGEST:\s*(branch|web_search)\s+"([^"]+)"/i);
    const suggestions = suggestMatch
      ? [{ type: suggestMatch[1] as 'branch' | 'web_search', description: suggestMatch[2] }]
      : undefined;

    const answer = text
      .replace(/\nCONFIDENCE:.*$/gm, '')
      .replace(/\nSUGGEST:.*$/gm, '')
      .trim();

    return {
      success: true,
      data: {
        answer,
        confident: confidence === 'high',
        confidence,
        suggestions,
      },
    };
  },
});

register({
  name: 'research_branch',
  description: "Spawn a focused follow-up research session from an existing one. Inherits the parent's findings as seed context and digs deeper into a specific subtopic.",
  parameters: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Parent research session ID' },
      subtopic: { type: 'string', description: 'Specific subtopic to research deeper' },
      goals: { type: 'array', items: { type: 'string' }, description: 'Specific goals for the branch' },
    },
    required: ['parentId', 'subtopic'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  // A branched session is a fresh long-running research job — auto-attach the
  // durable heartbeat watcher (new session id → its own watch), same as
  // research_start, so the branch's completion is reported without the model
  // having to remember to watch it.
  producesLongRunningTask: { kind: 'research', idPath: 'id', cadenceSeconds: 60 },
  handler: async (args) => {
    const parentId = args.parentId as string;
    const [parent] = await db.select().from(researchSessions).where(eq(researchSessions.id, parentId)).limit(1);
    if (!parent) return { success: false, error: 'Parent session not found' };

    const parentReport = parent.report
      ? typeof parent.report === 'string' ? parent.report : JSON.stringify(parent.report)
      : null;

    const seedContext = {
      parentTopic: parent.topic,
      parentGoals: parent.goals,
      parentFindings: parentReport ? parentReport.slice(0, 3000) : null,
      instruction: `This is a follow-up research session branched from "${parent.topic}". Focus specifically on: ${args.subtopic}. Avoid re-covering ground already established in the parent findings.`,
    };

    const { startResearch } = await import('$lib/deepdive/worker');
    const [session] = await db.insert(researchSessions).values({
      topic: `${args.subtopic} (branched from: ${parent.topic})`,
      goals: (args.goals as string[]) ?? [`Deep dive into: ${args.subtopic}`],
      parentSessionId: parentId,
      seedContext,
    }).returning();

    startResearch(session.id);
    return { success: true, data: session };
  },
});

register({
  name: 'research_extract',
  description: 'Extract findings from a research session into another format: blog_draft, build_prompt, workflow_description, or summary. Optionally focus on a specific area.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research session ID' },
      format: { type: 'string', description: 'Output format: "blog_draft", "build_prompt", "workflow_description", or "summary"' },
      focus: { type: 'string', description: 'Optional: focus extraction on a specific finding or section' },
    },
    required: ['id', 'format'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };
    if (!session.report) return { success: false, error: 'Session has no report yet' };

    const reportText = typeof session.report === 'string'
      ? session.report
      : JSON.stringify(session.report);

    const format = args.format as string;
    const focus = args.focus as string | undefined;

    const formatInstructions: Record<string, string> = {
      blog_draft: 'Write a blog post draft based on these research findings. Use an engaging tone, include key insights, and structure with clear headings. Output in markdown.',
      build_prompt: 'Write a clear, detailed prompt for an autonomous AI builder based on these findings. The prompt should describe exactly what to build, what data sources to use, and what the output should look like.',
      workflow_description: 'Write a natural language description of an automation workflow that could be built based on these findings. Describe the trigger, conditions, and actions clearly.',
      summary: 'Write a concise executive summary of the key findings. Focus on actionable insights and clear conclusions. Keep it under 500 words.',
    };

    const instruction = formatInstructions[format];
    if (!instruction) return { success: false, error: `Unknown format: ${format}. Use: blog_draft, build_prompt, workflow_description, or summary` };

    const { getLLMClient } = await import('$lib/llm/client');
    const { resolveResearchDeepModel } = await import('$lib/server/models/workload-settings');
    const { currentSessionModel } = await import('$lib/context/chat');
    const { client, model } = await getLLMClient(
      currentSessionModel() ?? (await resolveResearchDeepModel()),
    );

    const systemPrompt = `Research Topic: ${session.topic}\n\nResearch Findings:\n${reportText}\n\n${instruction}${focus ? `\n\nFocus specifically on: ${focus}` : ''}`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract the research into ${format} format.` },
      ],
      temperature: 0.5,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    return { success: true, data: { format, content } };
  },
});

register({
  name: 'research_web_search',
  description: 'Quick web search for a fact-check or to fill a knowledge gap — lighter than starting a full research session. Returns summarised results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      context: { type: 'string', description: 'Optional context to help interpret results (e.g. "related to our research on X")' },
    },
    required: ['query'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const { search } = await import('$lib/deepdive/tavily');
    const results = await search(args.query as string, { maxResults: 5, searchDepth: 'basic' });

    const summarised = results.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
      score: r.score,
    }));

    return {
      success: true,
      data: {
        query: args.query,
        context: args.context || null,
        results: summarised,
      },
    };
  },
});

register({
  name: 'research_search',
  description:
    'Semantic search across the MATERIALS of ALL deep-dive research sessions at once, ' +
    'searched by meaning (not keywords). Covers BOTH the extracted facts (distilled claims) ' +
    'AND the raw source-material passages the sources contained — so it can surface detail ' +
    'the fact layer never distilled. Use this to ground an answer in what past research ' +
    'actually found, when the user does not name a specific session — e.g. "what has my ' +
    'research turned up about X", "pull anything from my research on Y". Returns ranked ' +
    'passages, each with a `kind` ("fact" = distilled claim, "source" = raw source passage), ' +
    'the source title/url, the research session it came from, and a relevance score. To ask a ' +
    'question of ONE known session use research_query instead. ' +
    'When the user writes "@research" in their message, use this tool.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language description of what to find across the research materials.' },
      limit: { type: 'number', description: 'Max passages to return (default 8, max 30).' },
      sessionId: { type: 'string', description: 'Optional — restrict the search to a single research session id.' },
    },
    required: ['query'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) return { success: false, error: 'query is required' };
    const limit = args.limit !== undefined ? Number(args.limit) : undefined;
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined;
    try {
      const hits = await searchResearch(query, { topK: limit, sessionId });
      return {
        success: true,
        data: {
          query,
          count: hits.length,
          hits,
          note: hits.length === 0
            ? 'No embedded research materials matched. Sessions may still be running, or nothing relevant has been gathered yet.'
            : undefined,
        },
      };
    } catch (err) {
      return { success: false, error: `research_search failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});
