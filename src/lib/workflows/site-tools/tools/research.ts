import { register } from '../registry-internal';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

// ==========================================
// Existing Tools (moved)
// ==========================================

register({
  name: 'research_start',
  description: 'Start a new Deep Dive research session on a topic',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Research topic' },
      goals: { type: 'array', items: { type: 'string' }, description: 'Specific research goals' },
    },
    required: ['topic'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async (args) => {
    const { startResearch } = await import('$lib/deepdive/worker');
    const [session] = await db.insert(researchSessions).values({
      topic: args.topic as string,
      goals: (args.goals as string[]) ?? [],
    }).returning();
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
  description: 'List recent research sessions with topic, status, and stats',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Deep Dive Research',
  toolset: 'research',
  handler: async () => {
    const rows = await db.select().from(researchSessions).orderBy(desc(researchSessions.createdAt)).limit(50);
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

    const { getOpenAIClient, getModel } = await import('$lib/deepdive/keys');
    const client = getOpenAIClient();
    const model = getModel();

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

    const { getOpenAIClient, getModel } = await import('$lib/deepdive/keys');
    const client = getOpenAIClient();
    const model = getModel();

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
