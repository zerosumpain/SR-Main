// tools.ts — content for the Tools section: how 155 tools are exposed to a model without
// their descriptions eating the prompt, and where the time in a request actually goes.
//
// Byte and token figures are measured from the served manifest; the token column is the
// byte count at the conventional ~4 bytes per token, and is labelled as an approximation
// everywhere it appears.

export const MANIFEST = {
  registered: 155,
  shown: 21,
  essentials: 20,
  dispatcher: 1,
  fullBytes: 101_432,
  fullTokens: 25_358,
  servedBytes: 25_304,
  servedTokens: 6_326,
  savedBytes: 76_128,
  savedTokens: 19_032,
  dispatcherBytes: 1_383,
  dispatcherTokens: 346,
  hidden: 135,
  medianPrompt: 35_786,
  destructive: 16,
};

/** The measured send path. Three slivers of site code, then the wait. */
export const WATERFALL = [
  { id: 'route', label: 'Routing', ms: 69, kind: 'site' as const, what: 'Resolving the request to a handler.' },
  { id: 'post', label: 'POST', ms: 10, kind: 'site' as const, what: 'The request crossing the wire.' },
  { id: 'sse', label: 'Stream open', ms: 8, kind: 'site' as const, what: 'Opening the response stream.' },
  { id: 'model', label: 'Prefill + first token', ms: 4_313, kind: 'model' as const, what: 'The model reading a 35,786-token prompt before it emits a single character.' },
];

export const TTFT_TOTAL = 4_400;

export interface ToolTier {
  tier: string;
  count: number;
  cost: string;
  what: string;
  why: string;
}

export const TIERS: ToolTier[] = [
  {
    tier: 'Essentials — always visible',
    count: 20,
    cost: '≈6,300 tokens',
    what: 'The tools whose absence would visibly change behaviour. Twenty names, each with forty-four lines of comment between them justifying why it earned a slot.',
    why: 'A tool the model cannot see may as well not exist. These are the ones worth paying for on every turn.',
  },
  {
    tier: 'The dispatcher — one tool',
    count: 1,
    cost: '≈346 tokens',
    what: 'A single meta-tool offering list, schema and invoke. It hides 135 others behind about a third of a thousand tokens.',
    why: 'The capability is the point, so deleting tools is not the answer. Collapsing them behind one entry point is.',
  },
  {
    tier: 'Extended — discoverable',
    count: 135,
    cost: '0 tokens until asked',
    what: 'Everything else. The model lists them or fetches one schema when it needs to, and pays only then.',
    why: 'Most turns need none of these. Charging every turn for all of them is the default, and the default is wrong.',
  },
];

export const LESSONS = [
  {
    title: 'The model prices your instructions',
    body: 'Both the agent’s standing instructions and a tool’s own description said to prefer the slower, grounded path — the one that plans against the live registry, runs a critic round, and self-heals. Production did the opposite, consistently. The preferred tool was hidden behind the dispatcher; the discouraged one was visible. A tool the prompt calls mandatory will lose to a tool that is merely free.',
    lesson: 'When a prompt rule is being ignored, check the tool’s visibility tier before rewriting the wording. The manifest is a stronger signal than any sentence you can write.',
  },
  {
    title: 'Documentation is what blows the budget, not schema',
    body: 'One essential tool cost 3,147 tokens — and roughly eleven of its twelve and a half kilobytes were prose, an entire layout catalogue, against an argument schema of about one kilobyte. That catalogue was prefilled into every conversation on the site, including ones that would never make a slide.',
    lesson: 'A tool description is a contract, not a manual. Documentation belongs where it will be read at the moment it applies — in a lookup call, or in the error message of the call that just failed.',
  },
  {
    title: 'A filter that matches nothing returns everything, loudly',
    body: 'Listing every workflow node type costs about 19,000 bytes; a filtered query costs a few hundred. But an empty result set is handled specially — it returns the full catalogue with an explicit note that the filter matched nothing.',
    lesson: 'Silence reads to a model as proof of absence. A zero-match filter would send the agent off to build a node type that already existed.',
  },
  {
    title: 'Every cross-cutting concern has to unwrap the same envelope',
    body: 'Because one dispatcher masks 135 tools behind a single call, the confirmation gate has to resolve the inner tool name before deciding whether an operation is destructive. Gating the outer name would let every destructive call through untouched.',
    lesson: 'This is the general hazard of meta-dispatch: gating, logging, auditing and rendering each have to unwrap the envelope, and each one that forgets is a separate bug with no shared symptom.',
  },
  {
    title: 'Instrument the thing that actually ran',
    body: 'The obvious place to audit tool calls was the site’s own database table. That path is dead — it was written by the retired in-process loop, and the live engine never writes to it. The audit reads the engine’s own store instead.',
    lesson: 'Reading the plausible-looking table would have produced a beautiful dashboard of zeros, and the absence would have looked like a finding rather than a bug.',
  },
];

export const MCP_FACTS = [
  { k: 'What it is', v: 'An open-protocol endpoint', why: 'Any compliant client can drive this system’s tools directly — the same tools the site’s own assistant uses, not a reduced copy.' },
  { k: 'The wire format', v: 'JSON-RPC', why: 'Requests in, results out, over a transport that survives the server restarting underneath it.' },
  { k: 'One registry', v: 'Shared with everything else', why: 'A tool written once is available to the assistant, to a workflow, to the builder and to an external client. Nothing is wired twice.' },
  { k: 'Destructive operations', v: '16 of 155, gated', why: 'The check sits at the protocol boundary, where every route to a tool must pass — not inside any one caller, so a new caller cannot arrive without it. It also refuses outright when there is nobody present to confirm.' },
];

/** The availability gateway — a small dependency-free process in front of the tool server. */
export const GATEWAY = {
  problem: 'The site restarts whenever it deploys. An external assistant mid-task does not know that, and a tool call that lands during the restart simply fails — so an agent halfway through a job gets an error that has nothing to do with the job.',
  fix: 'A tiny process sits in front and holds a request for up to three minutes, retrying with a backoff, instead of returning a failure. A restart becomes latency rather than an error.',
  evidence: 'Measured across three deliberate restarts: 40 tool calls placed directly gave 17 successes and 23 failures. The same 40 through the gateway gave 40 successes and no failures.',
  lesson: 'The gateway is deliberately dependency-free and separately supervised, because a component whose entire job is surviving the main application’s restarts must not share the main application’s fate.',
};
