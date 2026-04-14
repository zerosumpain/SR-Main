export const SITE_TOOL_DEFINITIONS = [
  { type: 'function' as const, function: { name: 'site_health_stats', description: 'Get weekly health metrics (activity count, distance, duration, elevation, recovery score, sleep average) and all-time personal records', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'site_health_readiness', description: 'Get composite readiness score with recovery, HRV trend, sleep quality, load balance factors, zone classification, and recommendation', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'site_health_sleep', description: 'Get latest sleep analysis (duration, light/deep/REM percentages, performance score) and 14-day trend', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'site_health_training_load', description: 'Get training load analysis: acute/chronic load ratio, zone (optimal/caution/danger), 30-day history', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'site_health_timeline', description: 'Get paginated timeline of recent health events (activities, workouts, sleep, recovery)', parameters: { type: 'object', properties: { page: { type: 'number', description: 'Page number (default 1)' }, limit: { type: 'number', description: 'Items per page (default 20)' } } } } },
  { type: 'function' as const, function: { name: 'site_blog_list', description: 'List blog posts with title, slug, status (draft/published), excerpt, and timestamps', parameters: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status: "draft" or "published". Omit for all.' } } } } },
  { type: 'function' as const, function: { name: 'site_blog_get', description: 'Get full blog post content, tags, and metadata by ID', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Blog post ID' } }, required: ['id'] } } },
  { type: 'function' as const, function: { name: 'site_blog_create', description: 'Create a new blog post', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Post title' }, content: { type: 'string', description: 'Post content (markdown or HTML)' }, status: { type: 'string', description: '"draft" (default) or "published"' }, tags: { type: 'array', items: { type: 'string' }, description: 'Tag names' } }, required: ['title', 'content'] } } },
  { type: 'function' as const, function: { name: 'site_blog_update', description: 'Update an existing blog post (title, content, status, tags)', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Blog post ID' }, title: { type: 'string', description: 'New title' }, content: { type: 'string', description: 'New content' }, status: { type: 'string', description: '"draft" or "published"' }, tags: { type: 'array', items: { type: 'string' }, description: 'New tag names (replaces existing)' } }, required: ['id'] } } },
  { type: 'function' as const, function: { name: 'jkai_start_build', description: 'Start a new JKAI autonomous build. Provide a prompt describing what to build.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'What to build (e.g. "a countdown timer app")' }, title: { type: 'string', description: 'Build title (auto-generated if omitted)' } }, required: ['prompt'] } } },
  { type: 'function' as const, function: { name: 'jkai_get_build', description: 'Get status and details of a JKAI build by ID', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Build ID' } }, required: ['id'] } } },
  { type: 'function' as const, function: { name: 'jkai_list_builds', description: 'List recent JKAI builds with status (pending/running/completed/failed)', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'jkai_control_build', description: 'Control a JKAI build: pause, resume, stop, or publish it', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Build ID' }, action: { type: 'string', description: 'Action: "pause", "resume", "stop", or "publish"' } }, required: ['id', 'action'] } } },
  { type: 'function' as const, function: { name: 'research_start', description: 'Start a new Deep Dive research session on a topic', parameters: { type: 'object', properties: { topic: { type: 'string', description: 'Research topic' }, goals: { type: 'array', items: { type: 'string' }, description: 'Specific research goals' }, depth: { type: 'string', description: '"shallow", "standard" (default), or "deep"' } }, required: ['topic'] } } },
  { type: 'function' as const, function: { name: 'research_status', description: 'Check the status and stats of a research session', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Research session ID' } }, required: ['id'] } } },
  { type: 'function' as const, function: { name: 'research_list', description: 'List recent research sessions with topic, status, and stats', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function' as const, function: { name: 'research_get_report', description: 'Get the narrative report/findings from a completed research session', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Research session ID' } }, required: ['id'] } } },
  { type: 'function' as const, function: { name: 'research_control', description: 'Control a research session: stop it or skip the current phase', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Research session ID' }, action: { type: 'string', description: '"stop" or "skip"' } }, required: ['id', 'action'] } } },
];

export function buildSiteSystemPromptSection(): string {
  return `\n\n--- Site Capabilities ---
You have access to the user's personal platform (strangeramblings.com):

**Health Data** (site_health_* functions):
- Weekly stats, personal records, readiness score, sleep analysis, training load, activity timeline
- Data sources: Strava (running/cycling), Apple Watch (HR/recovery)

**Blog** (site_blog_* functions):
- List, read, create, and update blog posts
- Can publish drafts or create new posts

**JKAI Builder** (jkai_* functions):
- Start autonomous code builds from a prompt
- Check build status, pause/resume/stop, publish completed builds

**Deep Dive Research** (research_* functions):
- Start multi-phase research on any topic
- Check progress, get narrative reports when complete`;
}
