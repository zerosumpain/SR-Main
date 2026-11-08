/**
 * The tools a WhatsApp turn may use: an EXPLICIT list, never "everything that
 * is not destructive".
 *
 * A WhatsApp turn is unattended: Core runs it on `/api/jkai/service/turn` with
 * no job, so nobody is on a screen to answer a confirmation card, and destructive
 * tools are already refused there. Everything else used to be open — Home
 * Assistant, builds, canvas edits, mail labels, custom-tool authoring — behind a
 * sender filter that let most messages through. The owner's decision (overhaul
 * plan 2026-10-28, decision 2) is reads plus mutates confirmed with a reply code;
 * no commissioning and no destructive tools.
 *
 * The mutates half is `WHATSAPP_CONFIRM_BY_CODE`, kept OUT of this whitelist:
 * those tools are sent to Core separately, offered, and frozen for John's reply
 * code rather than run (`./reply-code.ts`). Being an explicit list is the
 * point: a new tool, including every private read the overhaul adds, reaches
 * WhatsApp only when someone writes its name here.
 *
 * Passed from `orchestrator-bridge.ts`, not inside `chatTurn`: the follow-up
 * queue shares `chatTurn` and runs on web threads, where it must keep its reach.
 * Core honours it three ways (general-chat.ts): only these are offered, a call
 * outside it is refused by `scopeRefusal`, and it travels to Main's invoke route
 * as `allowedTools`, where `executeTool` refuses the rest again.
 *
 * `tool-whitelist.test.ts` pins that every name is registered, none is
 * destructive, and no build, custom-tool or canvas-editing tool is here.
 */

/** Core's own meta tools. Activation only loads; what is OFFERED is still this list. */
const CORE_META = ['activate_toolset', 'jkai_help'] as const;

/** Read-only tools (declared `effect: 'read'`): no side effect outside the turn's own thread. */
export const WHATSAPP_READ_TOOLS = [
	// Discovery
	'tool_search',
	'tool_describe',
	'skills_list',
	'skill_view',
	'evidence_read',
	'capabilities_snapshot',
	// Web and news (api_call is left out: it accepts non-GET methods)
	'fetch_url',
	'research_web_search',
	'news_search',
	'api_search',
	// Calendar and mail
	'apple_calendar_list',
	'gmail_list_accounts',
	'gmail_search',
	'gmail_get_message',
	'gmail_get_thread',
	'gmail_list_labels',
	'mail_search',
	'mail_read',
	// Knowledge, memory and past conversations
	'knowledge_search',
	'intel_find',
	'intel_neighbourhood',
	'intel_path',
	'recall_memories',
	'memory_search',
	'session_search',
	// Files
	'file_list',
	'file_read',
	'file_search',
	// Health and routes (route_plan only computes; route_export is the writer)
	'health_readiness',
	'health_sleep',
	'health_stats',
	'health_timeline',
	'health_training_load',
	'route_plan',
	'route_target_suggest',
	// Home reads (ha_call_service acts, so it is confirm-by-code; ha_fire_event is not offered)
	'ha_find',
	'ha_query_state',
	'ha_get_history',
	'alexa_home_signals',
	'alexa_voice_search',
	'alexa_voice_summary',
	// Activity, research and site reads
	'activity_get',
	'activity_search',
	'activity_sources',
	'activity_summary',
	'research_list',
	'research_status',
	'research_inspect',
	'research_get_report',
	'research_query',
	'research_search',
	'blog_list',
	'blog_get',
	'workflow_list',
	'workflow_inspect',
	'workflow_get_run',
	'monitor_list',
	'datastore_list_collections',
	'datastore_get',
	'datastore_query',
	'followup_status',
	'list_heartbeat_actions',
	'list_scheduled_callbacks',
	'codegraph_query',
] as const;

/**
 * Outputs that land in the WhatsApp thread itself and are sent back as media by
 * the bridge — a document, an image, a voice note. No effect outside the thread.
 *
 * These are the ONLY non-reads on the list, and deliberately so: each declares
 * `effect: 'mutate', confirm: 'never'` (it stores an attachment, two of them
 * spend), and an unattended WhatsApp principal runs a mutate only because it is
 * named here. `tool-whitelist.test.ts` pins that every other entry is a read.
 */
export const WHATSAPP_THREAD_OUTPUTS = ['write_document', 'generate_image', 'generate_audio_tts'] as const;

/**
 * Confirm-by-code: mutates a WhatsApp turn may ask for, which run only when
 * John replies with the one-time code jkai sends (`./reply-code.ts`).
 *
 * NOT part of `WHATSAPP_TOOL_WHITELIST`. They travel to Core as
 * `confirmByCode`, so a Core that predates reply codes never offers them, and
 * the principal Core seals for the turn never lists them, so Main refuses one
 * that reached it without a code. Each must be a mutate on the standard lane
 * that does not always confirm (`tool-whitelist.test.ts` pins it); a
 * destructive, always-confirm or commission-lane tool can never be here.
 *
 * - `ha_call_service`: lights, scenes, the heating. Not `ha_fire_event`, which
 *   can start any automation.
 * - `save_memory`: "remember that …". Not `forget_memory`.
 * - `followup_schedule`: "tell me when the research finishes".
 */
export const WHATSAPP_CONFIRM_BY_CODE = ['ha_call_service', 'save_memory', 'followup_schedule'] as const;

export const WHATSAPP_TOOL_WHITELIST: readonly string[] = [
	...CORE_META,
	...WHATSAPP_READ_TOOLS,
	...WHATSAPP_THREAD_OUTPUTS,
];

export const WHATSAPP_CORE_META_TOOLS: readonly string[] = CORE_META;
