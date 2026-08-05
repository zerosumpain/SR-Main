// guardrails.ts — content for the Guardrails section.
//
// The organising idea, carried through the whole study: a guardrail is either a REQUEST
// (a sentence in a prompt asking a model not to do something) or a BOUNDARY (a thing that
// cannot be done regardless of what anyone intends). Almost every guardrail worth having
// is the second kind, and the ones here are labelled so you can see the ratio.

export type Kind = 'boundary' | 'request';

export interface Rail {
  id: string;
  risk: string;
  rail: string;
  kind: Kind;
  detail: string;
  scar?: string;
}

export const RAILS: Rail[] = [
  {
    id: 'secrets', risk: 'The assistant leaks a credential it was given',
    rail: 'It can use a credential, but cannot read one',
    kind: 'boundary',
    detail: 'Credentials live in a registry the agent addresses by name. A call is made on its behalf with the secret attached at the last moment; the value is never assembled into a prompt, so it cannot be repeated back, logged, or summarised into a reply.',
  },
  {
    id: 'newcred', risk: 'A needed credential does not exist yet',
    rail: 'A request flow that creates, and a separate one that rotates',
    kind: 'boundary',
    detail: 'The agent can ask for a credential it lacks, which opens a prompt for a human to fill in. It cannot write the registry directly. Creating and rotating are deliberately different operations, because conflating them means an accidental create silently destroys a working secret.',
  },
  {
    id: 'destructive', risk: 'A tool deletes something on a whim',
    rail: 'A confirmation gate at the protocol boundary',
    kind: 'boundary',
    detail: 'Destructive operations are gated where every route to a tool must pass, rather than inside any one caller — so a new caller cannot arrive without the check.',
    scar: 'Because a dispatcher hides most tools behind one call, the gate has to resolve the INNER tool name first. Gating the outer name would have let every destructive call through untouched, while looking entirely correct.',
  },
  {
    id: 'ssrf', risk: 'The agent is talked into fetching an internal address',
    rail: 'Outbound requests are filtered against private ranges',
    kind: 'boundary',
    detail: 'A tool that fetches a URL will happily fetch an internal one if asked nicely enough by a poisoned web page. Addresses in private ranges are refused before the request is made.',
    scar: 'The first version blocked the ordinary form of a private address but not the newer notation for the same address — a documented, well-known bypass. Filter by what an address RESOLVES TO, never by how it is spelled.',
  },
  {
    id: 'sandbox', risk: 'Generated code runs on the host',
    rail: 'A container it cannot reach out of',
    kind: 'boundary',
    detail: 'Everything the builder writes executes inside a sandbox container. The isolation is the container, not an instruction.',
  },
  {
    id: 'scan', risk: 'A generated tool reaches for the environment',
    rail: 'A deny-list scan over the source, before compilation',
    kind: 'boundary',
    detail: 'Fourteen forbidden constructs, matched against raw text before anything is compiled. Deny beats allow — an unknown construct is refused rather than permitted.',
  },
  {
    id: 'merge', risk: 'The machine widens its own permissions',
    rail: 'Its own safety rails are protected paths',
    kind: 'boundary',
    detail: 'The sandbox, the confirmation gate and the tool deny-list are all on the list of files that make a change high-risk. A change touching them can never be auto-merged, only proposed.',
  },
  {
    id: 'visibility', risk: 'Something unfinished is visible to the world',
    rail: 'A visibility check in the page’s own load function',
    kind: 'boundary',
    detail: 'Every project page runs the same guard, which resolves the project’s state and returns a not-found to anonymous visitors of a private one. Owner and share-token holders pass. Going private also purges the cached copies at the edge, because a cache does not know a thing became secret.',
  },
  {
    id: 'surface', risk: 'A route becomes public by accident',
    rail: 'The anonymous surface is a checked-in lockfile',
    kind: 'boundary',
    detail: 'The set of routes reachable without a session is recorded in the repository. Any change to it fails the gate with a diff, and has to be acknowledged deliberately.',
    scar: 'There are two allow-lists in this codebase for historical reasons, and only one matches by prefix. Adding a route family to the exact-match one silently fails to match — the symptom being anonymous users redirected to a login page for something meant to be open.',
  },
  {
    id: 'login', risk: 'Anyone with an account signs in',
    rail: 'An explicit allow-list, deny by default',
    kind: 'boundary',
    detail: 'Sign-in succeeds only for addresses on a list. The default for an unknown address is refusal, not access.',
  },
  {
    id: 'traversal', risk: 'A published bundle is used to read the disk',
    rail: 'Path resolution is checked against its root',
    kind: 'boundary',
    detail: 'Files for a published project are read from disk at request time, so the resolved path is verified to sit under the intended directory before anything is opened.',
  },
  {
    id: 'rate', risk: 'A public endpoint is used as free model capacity',
    rail: 'Per-client token buckets',
    kind: 'boundary',
    detail: 'Public endpoints that reach a model — including this study’s own Ask dock — are rate-limited per client, keyed on the real client address rather than the tunnel’s, which would otherwise make every visitor look like the same one.',
  },
  {
    id: 'escape', risk: 'Model output is rendered as markup',
    rail: 'Escape first, then allow a tiny subset',
    kind: 'boundary',
    detail: 'Anything a model wrote is escaped before any formatting is applied, and only a small explicit subset is re-enabled. The order matters: escaping after formatting is not escaping.',
  },
  {
    id: 'sensitive', risk: 'Something private is published',
    rail: 'A detector on the publishing path',
    kind: 'request',
    detail: 'Content bound for a public surface is checked for things that should not leave. This one is honestly a request rather than a boundary: it is heuristic, it can be wrong in both directions, and the real control is that a human reads machine-written text before it is published.',
    scar: 'Copies of a detector like this drift apart. The one that matters is the one on the path that actually publishes — which is not always the one you find first.',
  },
];

export const PRINCIPLE = {
  title: 'A request is not a boundary',
  body: 'A sentence in a prompt asking a model not to do something is a request. It will usually be honoured, and "usually" is not a security property. A container with no route to the host, a job that cannot start until another job is green, a scan that runs before code is compiled, a credential the agent can use but cannot read — those hold regardless of what anything intends.',
  tally: 'Of the guardrails on this page, all but one are boundaries. The one that is not says so.',
};
