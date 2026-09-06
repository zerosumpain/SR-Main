/**
 * The registry of LLM WORKLOADS — every role on the site that picks a model
 * somewhere other than `resolveDefaultModel()`.
 *
 * Why this exists. The site is meant to run one default model everywhere
 * (John, 2026-07-25). In practice three classes of work escaped that rule and
 * nothing in the UI said so:
 *
 *  1. deliberate carve-outs with a settings key but no surface — intel entity
 *     extraction has had `jkai.intel.extract_model` since 2026-07-27, unset in
 *     production, so it silently ran the code fallback;
 *  2. roles hardcoded as module constants with NO settings key at all —
 *     self-improve and the workflow doctor, both pinned to
 *     `deepseek/deepseek-v4-flash` in their `types.ts`;
 *  3. tasks that DID follow the site default, but had no key, no name and no
 *     row of their own — so on the spend page they arrived as one
 *     `source:gateway` bucket, and "follows the default" was indistinguishable
 *     from "cannot be changed" (John, 2026-09-01, reading /admin/ops/costs).
 *
 * A carve-out is legitimate — several here are load-bearing, and the `reason`
 * field records why — but an INVISIBLE carve-out is not, because the only way
 * to discover one was to read the source. Every role now names itself here,
 * says what runs on it, and can be changed from the model picker.
 *
 * The bar for a row here is "a distinct kind of work with one model choice".
 * That deliberately excludes the two genuinely per-call spenders — a chat turn
 * (pinned per conversation at creation) and a canvas LLM node (a model field in
 * its own config) — because a switch on those would be a button that lies.
 * Both of those start from the SITE DEFAULT, which is settable in the same
 * places as everything here.
 *
 * This module is deliberately client-importable (plain data, no `$lib/server`
 * imports) so the picker renders the same list the server enforces — same rule
 * as `$lib/models/open-weights.ts`.
 */
import {
  DEFAULT_EXTRACTION_MODEL_ID,
  DEFAULT_SELFIMPROVE_MODEL_ID,
  DEFAULT_DOCTOR_MODEL_ID,
  DEFAULT_VISION_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_IMAGE_TOOL_MODEL_ID,
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_AUDIO_MODEL_ID,
  DEFAULT_ART_DIRECTOR_MODEL_ID,
  DEFAULT_DESIGN_REVIEW_MODEL_ID,
  DEFAULT_RESEARCH_FAST_MODEL_ID,
  DEFAULT_NOTE_REVIEW_MODEL_ID,
} from '$lib/constants/default-models';

/** Where the setting lives, which decides how a change is applied. */
export type WorkloadScope =
  /** An `app_settings` row read by a named resolver in the SvelteKit app. */
  | 'site';

/**
 * What a model must be able to do to serve this role.
 *
 * Checked server-side before a save is accepted, so an impossible pick is
 * refused with a reason rather than failing at call time — the failure mode
 * this replaces was a text-only model accepting an image request and confidently
 * describing nothing (see `file-index/describe.ts`).
 */
export type WorkloadRequirement =
  /** Caller-supplied tool schemas + tool_calls back. */
  | 'tools'
  /** The /v1/embeddings endpoint. Codex has none. */
  | 'embeddings'
  /** Accepts images as INPUT (vision / OCR). */
  | 'image-input'
  /** Accepts audio as INPUT (transcription). */
  | 'audio-input'
  /** Emits images as OUTPUT (generation). */
  | 'image-output'
  /**
   * Must be an OpenRouter model, not a `codex/` id.
   *
   * Not a capability of the model so much as of the route to it: the budgeted
   * research tiers stream through OpenRouter's client directly (and the Instant
   * tier through OpenRouter's web plugin), so a Codex pick would be sent to the
   * wrong base URL as an unknown slug. Refused at save time rather than
   * discovered at call time on a tier that has 30 seconds to answer.
   */
  | 'openrouter'
  | null;

/**
 * Which models the picker should offer while this workload is the active
 * target. The default table is filtered to tool-capable chat models, which is
 * wrong for image generation and useless for embeddings.
 */
export type WorkloadCatalogue =
  /** Tool-capable chat models — the picker's normal filter. */
  | 'tools'
  /** Models whose modality has `image` on the output side (11 in the live catalogue). */
  | 'image-out'
  /** Nothing in the OpenRouter catalogue serves this role; the effective value
   *  is shown and set by hand. OpenRouter's /models feed omits the embedding
   *  namespace entirely, so there is genuinely nothing to list. */
  | 'none';

export interface WorkloadDef {
  id: string;
  scope: WorkloadScope;
  /** Chip / row label. Short — it renders in a table cell. */
  label: string;
  /** What actually runs on this model, in one line. */
  blurb: string;
  /** The `app_settings` key this role reads. */
  key: string;
  /**
   * A legacy environment variable that still answers for this role when nothing
   * is pinned, read BELOW the pin and ABOVE the code fallback.
   *
   * Declared on the registry rather than buried in the resolver so the picker
   * and the resolver agree. They did not: `resolveImageToolModel` honoured
   * `JKAI_IMAGE_MODEL` while `describeSiteWorkloads` did not, so with the
   * variable set the page reported the constant while the tool called something
   * else — a page naming a model that is not the one spending the money, which
   * is the exact gap this workload was added to close.
   */
  envKey?: string;
  /**
   * The model used when the key is unset.
   *
   * `null` means "follow the site default" — the honest state for a role that
   * has no reason to differ. A string means the code pins something else, and
   * `reason` must say why.
   */
  fallbackModelId: string | null;
  requires: WorkloadRequirement;
  catalogue: WorkloadCatalogue;
  /**
   * Why this role is pinned off the site default, or null if it simply follows
   * it. Rendered inline in the picker: a carve-out the operator can read is a
   * decision; one they can't is a bug waiting to be rediscovered.
   */
  reason: string | null;
}

/**
 * Site-side workloads — each backed by an `app_settings` row and a named
 * resolver in `$lib/server/models/workload-settings`.
 */
export const SITE_WORKLOADS: WorkloadDef[] = [
  {
    id: 'extraction',
    scope: 'site',
    label: 'Entity extraction',
    blurb: 'Intel entity extraction + resolution after a reply lands.',
    key: 'jkai.intel.extract_model',
    fallbackModelId: DEFAULT_EXTRACTION_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Latency-visible: it runs after the reply is delivered and the entity rail stays empty until it finishes. Mechanical JSON against a fixed schema, so it takes the fastest cheap model rather than the smartest one.',
  },
  {
    id: 'resolution',
    scope: 'site',
    label: 'Entity adjudication',
    blurb: 'Reads the evidence behind two candidate duplicates and rules on whether they are one thing.',
    key: 'jkai.intel.resolution_model',
    // Follows the site default deliberately. Extraction is pinned cheap because
    // it is mechanical JSON on a latency-visible path; this is the opposite —
    // nothing waits on it, it runs a few hundred times a night at most, and the
    // whole point of it is judgement the string rules could not make.
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'selfimprove',
    scope: 'site',
    label: 'Self-improve',
    blurb: 'The nightly 03:30 self-improvement engine that authors code.',
    key: 'jkai.selfimprove.model',
    fallbackModelId: DEFAULT_SELFIMPROVE_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Writes code that ships unattended, so it was pinned in 2026-07-29 to stop a chat-default change silently altering what authors it. Still a deliberate choice — just one you can now see and make.',
  },
  {
    id: 'daydream',
    scope: 'site',
    label: 'Daydreaming',
    blurb: 'Phrases what the daydream detectors found, and verifies it against the evidence.',
    key: 'jkai.daydream.model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Follows the site default rather than pinning, because the work is short-form phrasing under a hard evidence constraint rather than code authoring. Worth knowing before changing it: on a Codex model this role is capped at 10% of the weekly allowance per day and 50% of the current 5-hour window, enforced in $lib/daydream/budget.ts. Move it to an OpenRouter model and those caps stop applying — the spend becomes cash instead, and nothing here limits it.',
  },
  {
    id: 'doctor',
    scope: 'site',
    label: 'Workflow doctor',
    blurb: 'Diagnosing failing canvas nodes — the 05:00 doctor and the runtime self-heal.',
    key: 'jkai.workflowdoctor.model',
    fallbackModelId: DEFAULT_DOCTOR_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Pinned for the same reason as self-improve: diagnosis quality should not move overnight because the chat default moved.',
  },
  {
    id: 'thinking',
    scope: 'site',
    label: 'Thinking tier',
    blurb: 'Orchestrator plan / clarify turns and any prompt past the large-context threshold.',
    key: 'jkai.builder.thinking_model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'vision',
    scope: 'site',
    label: 'Vision / OCR',
    blurb: 'Image captions and OCR for the file index and Drive search.',
    key: 'jkai.vision.model',
    fallbackModelId: DEFAULT_VISION_MODEL_ID,
    requires: 'image-input',
    catalogue: 'tools',
    reason:
      'Must accept images. The site default is currently text-only, and a text-only model answers the prompt while ignoring the picture — a confident caption of nothing.',
  },
  {
    id: 'image',
    scope: 'site',
    label: 'Image generation',
    blurb: 'Studio explainer images (chat-completions with `modalities: [image, text]`).',
    key: 'jkai.image.model',
    fallbackModelId: DEFAULT_IMAGE_MODEL_ID,
    requires: 'image-output',
    catalogue: 'image-out',
    reason:
      "Must emit an image; a text model cannot serve this role at all. Note this does NOT cover the canvas `generate_image` tool, which calls OpenRouter's separate /images/generations endpoint — a different API that these models do not serve. That one is the `image-tool` role below.",
  },
  {
    id: 'audio',
    scope: 'site',
    label: 'Audio transcription',
    blurb: 'Speech-to-text for audio files in the @files index.',
    key: 'jkai.audio.model',
    fallbackModelId: DEFAULT_AUDIO_MODEL_ID,
    requires: 'audio-input',
    catalogue: 'tools',
    reason:
      "Must accept an `input_audio` content part. OpenAI's whisper endpoint is not reachable through this repo's OpenRouter-only gateway, so transcription rides a multimodal chat model rather than a dedicated speech API.",
  },
  {
    id: 'art-director',
    scope: 'site',
    label: 'Deck art director',
    blurb: 'Composing slide layouts and block choices in the decks builder.',
    key: 'jkai.decks.art_director_model',
    fallbackModelId: DEFAULT_ART_DIRECTOR_MODEL_ID,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'A one-shot composition, not an agentic loop, so a slower higher-quality model earns its latency here where the agentic roles cannot afford it.',
  },
  {
    id: 'image-tool',
    scope: 'site',
    label: 'Image tool',
    blurb: "The canvas/chat `generate_image` tool — OpenRouter's /images/generations endpoint.",
    key: 'jkai.image.tool_model',
    envKey: 'JKAI_IMAGE_MODEL',
    fallbackModelId: DEFAULT_IMAGE_TOOL_MODEL_ID,
    requires: null,
    // OpenRouter's /models feed does not carry the dedicated image-generation
    // namespace, so there is no list to pick from — the slug is typed in, the
    // same situation as embeddings.
    catalogue: 'none',
    reason:
      'A DIFFERENT API from the `image` role above: /images/generations, which the chat-completions image models do not serve. Typing a chat model here fails at call time. Verified serving this endpoint on 2026-08-30, cheapest first: google/gemini-2.5-flash-image ($0.039/image), openai/gpt-5-image-mini ($0.050), google/gemini-3-pro-image ($0.135). FLUX is gone — OpenRouter removed black-forest-labs/flux-1.1-pro and the endpoint 404s for it, which is why every image generation on the site silently failed until 2026-08-30.',
  },
  {
    id: 'embeddings',
    scope: 'site',
    label: 'Embeddings',
    blurb: 'RAG, Drive file embeddings and the knowledge index.',
    key: 'jkai.embeddings.model',
    fallbackModelId: DEFAULT_EMBEDDING_MODEL_ID,
    requires: 'embeddings',
    catalogue: 'none',
    reason:
      "Needs the /v1/embeddings endpoint, which Codex has no equivalent of. OpenRouter's model feed omits embedding models, so there is nothing here to pick from a list — set the slug by hand.",
  },

  // ── The rest of the site's LLM tasks ─────────────────────────────────────
  //
  // Added 2026-09-01 (John, reading /admin/ops/costs: "deep research is locked
  // to using a specific model as are a few others… I want to be able to define
  // a model for EVERY type of task").
  //
  // Only the first of these was pinned to a constant. The others all followed
  // the site default already — but "follows the default" and "cannot be changed"
  // are indistinguishable when there is no key, and on the spend page they read
  // as one undifferentiated `source:gateway` bucket. Registering them costs
  // nothing at runtime (`fallbackModelId: null` resolves exactly as before) and
  // buys two things: a switch per task, and a spend row per task so the switch
  // has evidence behind it.
  {
    id: 'research-fast',
    scope: 'site',
    label: 'Research — fast tiers',
    blurb: 'The budgeted research tiers: Instant, Scan and Brief.',
    key: 'jkai.research.fast_model',
    envKey: 'RESEARCH_FAST_MODEL',
    fallbackModelId: DEFAULT_RESEARCH_FAST_MODEL_ID,
    requires: 'openrouter',
    catalogue: 'tools',
    reason:
      'These tiers promise an answer inside a wall clock (30s / 90s / 110s), so they must NOT inherit the site default: a reasoning model spends the budget thinking before it emits a token, and a codex/ id costs ~10s on the first call and cannot stream at all. Pick something fast and non-reasoning here, or the tier stops meaning what its label says.',
  },
  {
    id: 'research-deep',
    scope: 'site',
    label: 'Research — Investigation',
    blurb: 'The unbudgeted full research desk: breadth search, extraction, red-team, clustering.',
    key: 'jkai.research.deep_model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'The one tier with no clock to protect, so it follows the site default and takes whatever quality that buys. It is also the most expensive thing on the site per run — worth pinning UP rather than down if the default ever moves cheap.',
  },
  {
    id: 'builder',
    scope: 'site',
    label: 'Autonomous builder',
    blurb: 'The pi coding agent and the orchestrator planner behind /jkai/builds.',
    key: 'jkai.builder.model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Follows the site default. Note a build PINS its model at creation from whatever this resolves to, so changing it affects new builds only — the same rule chat conversations follow.',
  },
  {
    id: 'design-review',
    scope: 'site',
    label: 'Build design review',
    blurb: 'Judges a studio build’s rendered chapters against the explainer kit’s design rubric.',
    key: 'jkai.builder.design_review_model',
    fallbackModelId: DEFAULT_DESIGN_REVIEW_MODEL_ID,
    requires: 'image-input',
    catalogue: 'tools',
    reason:
      'The only stage of a build that looks at pixels rather than source, so it must accept images — a text-only model (any codex/ id) does not fail here, it answers the prompt and ignores the screenshot. It is also the only stage making an aesthetic judgement, and it runs once per iteration on at most four images, which makes it the cheapest place in a build to buy a better model. Resolved per iteration, NOT stamped at creation like `builder`, so a change reaches builds already running.',
  },
  {
    id: 'heartbeat',
    scope: 'site',
    label: 'Heartbeat turns',
    blurb: 'Scheduled heartbeat turns that continue a conversation unattended.',
    key: 'jkai.heartbeat.model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Follows the site default. Worth knowing before changing it: these run unattended on a timer, so a slow or expensive pick here is spent without anyone watching.',
  },
  {
    id: 'briefing',
    scope: 'site',
    label: 'Daily briefing',
    blurb: 'The scheduled briefing that assembles the day from verified sources.',
    key: 'jkai.briefing.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'blog',
    scope: 'site',
    label: 'Blog assistant',
    blurb: 'The editor assistant, auto-review and claim-checking on /admin/blog.',
    key: 'jkai.blog.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'chat-maintenance',
    scope: 'site',
    label: 'Chat housekeeping',
    blurb: 'History compression and memory review — the background work on a long thread.',
    key: 'jkai.chat.maintenance_model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'Nobody reads this output directly; it only has to be faithful. A cheap fast model is the obvious pin, and it is separated from the chat turn itself precisely so pinning one does not move the other.',
  },
  {
    id: 'intel-analysis',
    scope: 'site',
    label: 'Intel analysis',
    blurb: 'Note preprocessing, entity briefs, recall and conflation repair in the intel graph.',
    key: 'jkai.intel.analysis_model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'Distinct from Entity extraction, which is the latency-critical post-reply pass. This is the read side — briefs and recall a person waits on deliberately — so it can afford a better model than extraction can.',
  },
  {
    id: 'notebook',
    scope: 'site',
    label: 'Notebook research',
    blurb: 'The scan / brief passes behind /jkai/notes.',
    key: 'jkai.notebook.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'project-chat',
    scope: 'site',
    label: 'Project page chats',
    blurb: 'The study chats and authoring aids on /projects (policy engine, data spine, DfE, ARCHETYPE).',
    key: 'jkai.projects.chat_model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'trails',
    scope: 'site',
    label: 'Trails interpretation',
    blurb: 'Turning a recorded route into prose on /trails.',
    key: 'jkai.trails.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'landing',
    scope: 'site',
    label: 'Landing hero titles',
    blurb: 'The rotating hero titles generated for the landing page.',
    key: 'jkai.landing.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'delegation',
    scope: 'site',
    label: 'Agent delegation',
    blurb: 'Sub-agents from the agent team, when one is dispatched without its own model.',
    key: 'jkai.delegation.model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'An agent row may name its own model, which still wins. This is what a team member with no model of its own runs on.',
  },
  {
    id: 'rag',
    scope: 'site',
    label: 'RAG answering',
    blurb: 'Answers synthesised over a document collection, with citations.',
    key: 'jkai.rag.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'The ANSWER model, not the embedding model — those are separate roles because they are separately consequential: changing this one is free, and changing Embeddings invalidates every stored vector.',
  },
  {
    id: 'mapping',
    scope: 'site',
    label: 'Canvas edge mapping',
    blurb: 'Proposing the field mapping when two canvas nodes are wired together.',
    key: 'jkai.mapping.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'Falls back to a deterministic heuristic on any failure, so this is the one role where a bad pick degrades rather than breaks — which also means a broken pick here is easy to miss.',
  },
  {
    id: 'health',
    scope: 'site',
    label: 'Health narratives',
    blurb: 'The narrative and hero copy over the health metrics on /health.',
    key: 'jkai.health.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },
  {
    id: 'releases',
    scope: 'site',
    label: 'Release summaries',
    blurb: 'Turning a deploy diff into the release log entry.',
    key: 'jkai.releases.model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason:
      'Runs against a whole diff, so it is context-hungry: the largest releases already blow the gateway\'s 90s non-streaming ceiling on a reasoning model and fall back to a compact second pass. Pin something fast with a large window rather than something clever.',
  },
  {
    id: 'tool-suggestions',
    scope: 'site',
    label: 'Tool-usage suggestions',
    blurb: 'The admin tool-usage audit that proposes toolchain changes.',
    key: 'jkai.tooling.suggestions_model',
    fallbackModelId: null,
    requires: null,
    catalogue: 'tools',
    reason: null,
  },

  // ── The last four unswitchable reasons ───────────────────────────────────
  //
  // Added 2026-09-03 (John, reading /admin/ops/costs: "some are classed
  // per-call and not changeable. I want to be able to change these. Bring the
  // rest of the call reasons in line so i can define the model that's being
  // used").
  //
  // The first two were argued to be un-switchable on the grounds that the model
  // is chosen per conversation and per node. That is true of an EXISTING
  // conversation and of a node that names its own model — but both of those
  // start from a model something resolved for them, and until now that
  // something was `resolveDefaultModel()` with no key of its own. So the choice
  // existed; it just could not be expressed anywhere except by moving the site
  // default, which moves everything else with it. These two roles are that
  // starting point, named. The rule they follow is the one `builder` already
  // documents: the pick is stamped at creation, so a change moves new ones.
  //
  // The last two were plain hidden pins — a model id in a `const` with no
  // settings key at all, the exact shape this registry was built to abolish.
  {
    id: 'chat',
    scope: 'site',
    label: 'jkai chat turns',
    blurb: 'Chat replies on /jkai — the model a NEW conversation is opened on.',
    key: 'jkai.chat.turn_model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Follows the site default. A conversation STAMPS this model when it is created and keeps it for life, so changing it moves new threads only — the existing ones are on what they were opened with, and the composer\'s own picker still beats both. Deliberately separate from the site default so chat can be moved without moving every unpinned background role with it.',
  },
  {
    id: 'workflow-node',
    scope: 'site',
    label: 'Canvas LLM nodes',
    blurb: 'LLM nodes in canvas workflows whose own model field is blank.',
    key: 'jkai.workflow.node_model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Follows the site default. A node that names a model in its own config still wins — this is what the blank field means, and it is resolved fresh on every run rather than stamped, so a change here moves existing workflows too.',
  },
  {
    id: 'daydream-review',
    scope: 'site',
    label: 'Daydream reviewer',
    blurb: 'The verifier that decides whether a daydream thought is true before it is sent.',
    key: 'jkai.daydream.review_model',
    fallbackModelId: null,
    requires: 'tools',
    catalogue: 'tools',
    reason:
      'Inherits the default JKAI chat model unless explicitly pinned. Reads cited sources with tools; source verification remains distinct from statistical support. Provider budgets still apply.',
  },
  {
    id: 'notebook-review',
    scope: 'site',
    label: 'Notebook note reviewer',
    blurb: 'Reads a new note on /jkai/notes and names the lookups worth running.',
    key: 'jkai.notebook.review_model',
    fallbackModelId: DEFAULT_NOTE_REVIEW_MODEL_ID,
    requires: null,
    catalogue: 'tools',
    reason:
      'Pinned cheap on purpose, and separate from "Notebook research" — this one only decides WHAT to look up, and the money belongs in the lookups it asks for rather than in the asking. A failure here leaves the note unreviewed, which is simply a note.',
  },
];

export const WORKLOADS: WorkloadDef[] = [...SITE_WORKLOADS];

export type WorkloadId = string;

export function getWorkload(id: string): WorkloadDef | null {
  return WORKLOADS.find((w) => w.id === id) ?? null;
}

export function isWorkloadId(v: unknown): v is WorkloadId {
  return typeof v === 'string' && WORKLOADS.some((w) => w.id === v);
}

/** Where an effective model came from — drives the source badge in the picker. */
export type WorkloadSource =
  /** An operator set this explicitly. */
  | 'pinned'
  /** No setting; the code fallback in this registry applies. */
  | 'code'
  /** No setting, but a legacy environment variable (`envKey`) answers. */
  | 'env'
  /** No setting and no code fallback — it follows the site default. */
  | 'default';

export interface WorkloadState {
  id: string;
  scope: WorkloadScope;
  label: string;
  blurb: string;
  key: string;
  reason: string | null;
  requires: WorkloadRequirement;
  catalogue: WorkloadCatalogue;
  /** What is set explicitly, or null when nothing is. */
  setModelId: string | null;
  /** What will actually answer. */
  effectiveModelId: string;
  source: WorkloadSource;
  /** True when the effective model differs from the site default. */
  divergesFromDefault: boolean;
}

/**
 * True when `modality` says the model emits images.
 *
 * OpenRouter encodes modality as `inputs->outputs`, e.g. `text+image->text+image`.
 * Only the right-hand side matters for generation — plenty of vision models read
 * images and can only write text, and treating those as generators is exactly
 * how you get a text apology where a picture should be.
 */
export function emitsImages(modality: string | null | undefined): boolean {
  if (!modality) return false;
  const arrow = modality.indexOf('->');
  if (arrow === -1) return false;
  return modality.slice(arrow + 2).includes('image');
}
