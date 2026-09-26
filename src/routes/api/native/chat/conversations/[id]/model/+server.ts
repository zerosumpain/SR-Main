import { json } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations, openrouterModels, orchestratorChats } from '$lib/db/schema';
import { withNativeAccess } from '$lib/server/native-handler';
import { requireConversation } from '$lib/jkai/chat-access.server';
import { coerceModelContext } from '$lib/constants/default-models';
import { modelSupportsThinking } from '$lib/server/models/capabilities';
import { resolveChatTurnModel } from '$lib/server/models/workload-settings';
import { toCodexModelId, toCodexSlug } from '$lib/server/models/codex-catalogue';
import { listCodexModels } from '$lib/server/models/codex-discovery';
import { isCodexEnabled } from '$lib/server/models/settings';
import { thinkingLevelsFor } from '$lib/models/thinking';

/**
 * GET /api/native/chat/conversations/[id]/model — what the thread runs on, and
 * what the phone may switch it to.
 *
 * NOT the web's model picker. That is a sortable, scored catalogue of hundreds
 * of OpenRouter rows with a comparison chart, which is a desk tool. A phone gets
 * a short list: the site's chat default, the Codex models when Codex is
 * switched on, and the models this owner has actually run threads on recently.
 * That last group is the honest answer to "which models do I use" — measured,
 * not curated.
 *
 * The model is LOCKED after the first message, exactly as on the web: the
 * price snapshot is taken when it is chosen. The thinking level is not locked,
 * for the web's reason — the turn that came back thin is when you turn it up.
 * Both are written through PATCH on the thread itself.
 */

const RECENT_THREADS = 200;
const RECENT_MODELS = 6;

type Choice = { provider: 'openrouter' | 'codex'; modelId: string; label: string; group: 'default' | 'codex' | 'recent' };

/**
 * A MEMBER gets the same shape with nothing to choose: `locked`, no choices, no
 * thinking levels. The model is the owner's spend and a thinking level would
 * write the owner's default (the PATCH refuses both), and the "recent" group is
 * a list of the models the OWNER runs, which is his to know, not theirs.
 */
export const GET: RequestHandler = withNativeAccess('jkai.chat', async (event, _identity, role) => {
  const { params } = event;
  if (role === 'member') return memberModel(event, params.id);
  const [conv] = await db
    .select({
      modelProvider: conversations.modelProvider,
      modelId: conversations.modelId,
      thinkingLevel: conversations.thinkingLevel,
    })
    .from(conversations)
    .where(eq(conversations.id, params.id))
    .limit(1);
  if (!conv) return json({ error: 'Conversation not found' }, { status: 404 });

  const current = coerceModelContext({ provider: conv.modelProvider, modelId: conv.modelId });

  const [[{ cnt }], fallback, codexOn, recentRows, supports] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)::int` }).from(orchestratorChats).where(eq(orchestratorChats.conversationId, params.id)),
    resolveChatTurnModel(),
    isCodexEnabled(),
    db
      .select({ provider: conversations.modelProvider, modelId: conversations.modelId })
      .from(conversations)
      // The owner's own threads — "the models he uses", not a member's picks.
      .where(eq(conversations.principalId, 'owner'))
      .orderBy(desc(conversations.updatedAt))
      .limit(RECENT_THREADS),
    modelSupportsThinking(current),
  ]);

  const choices: Choice[] = [];
  const seen = new Set<string>();
  const add = (choice: Omit<Choice, 'label'> & { label?: string }) => {
    const key = `${choice.provider}|${choice.modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({ ...choice, label: choice.label ?? choice.modelId });
  };

  const defaultCtx = coerceModelContext(fallback);
  add({ provider: defaultCtx.provider as Choice['provider'], modelId: defaultCtx.modelId, group: 'default' });
  // Static rows plus anything the nightly discovery found; see codex-discovery.
  const codexModels = await listCodexModels();
  const codexName = (modelId: string) => codexModels.find((m) => m.slug === toCodexSlug(modelId))?.name;
  if (codexOn) {
    for (const m of codexModels) add({ provider: 'codex', modelId: toCodexModelId(m.slug), label: m.name, group: 'codex' });
  }
  let recent = 0;
  for (const row of recentRows) {
    if (recent >= RECENT_MODELS) break;
    const ctx = coerceModelContext({ provider: row.provider, modelId: row.modelId });
    if (ctx.provider !== 'openrouter' && ctx.provider !== 'codex') continue;
    const before = choices.length;
    add({ provider: ctx.provider, modelId: ctx.modelId, group: 'recent' });
    if (choices.length > before) recent++;
  }

  // Names from the catalogue, so a row reads "Claude Sonnet 5" rather than a
  // vendor slug. A model the catalogue has never heard of keeps its id.
  const openrouterIds = choices.filter((c) => c.provider === 'openrouter').map((c) => c.modelId);
  if (openrouterIds.length) {
    const names = await db
      .select({ id: openrouterModels.id, name: openrouterModels.name })
      .from(openrouterModels)
      .where(inArray(openrouterModels.id, openrouterIds));
    const byId = new Map(names.map((n) => [n.id, n.name]));
    for (const c of choices) if (c.provider === 'openrouter') c.label = byId.get(c.modelId) ?? c.label;
  }
  for (const c of choices) if (c.provider === 'codex') c.label = codexName(c.modelId) ?? c.label;

  const currentLabel =
    choices.find((c) => c.provider === current.provider && c.modelId === current.modelId)?.label ??
    codexName(current.modelId) ??
    current.modelId;

  return {
    current: { provider: current.provider, modelId: current.modelId, label: currentLabel },
    locked: cnt > 0,
    thinkingLevel: conv.thinkingLevel ?? null,
    supportsThinking: supports,
    levels: supports ? thinkingLevelsFor(current.provider, current.modelId) : [],
    choices,
  };
});

async function memberModel(event: { locals: App.Locals }, id: string) {
  const { conversation } = await requireConversation(event, id, 'read');
  const current = coerceModelContext({ provider: conversation.modelProvider, modelId: conversation.modelId });
  let label = current.modelId;
  if (current.provider === 'openrouter') {
    const [row] = await db
      .select({ name: openrouterModels.name })
      .from(openrouterModels)
      .where(eq(openrouterModels.id, current.modelId))
      .limit(1);
    label = row?.name ?? label;
  } else if (current.provider === 'codex') {
    const codexModels = await listCodexModels();
    label = codexModels.find((m) => m.slug === toCodexSlug(current.modelId))?.name ?? label;
  }
  return {
    current: { provider: current.provider, modelId: current.modelId, label },
    locked: true,
    thinkingLevel: conversation.thinkingLevel ?? null,
    supportsThinking: false,
    levels: [],
    choices: [] as Choice[],
  };
}
