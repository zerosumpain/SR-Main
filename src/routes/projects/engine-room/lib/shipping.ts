// shipping.ts — content for the Shipping section: the only route to production, and why
// each part of it is shaped the way it is.

export interface Stage {
  id: string;
  name: string;
  where: string;
  what: string;
  eli5: string;
  why: string;
}

export const PIPELINE: Stage[] = [
  {
    id: 'branch', name: 'A branch', where: 'anywhere',
    what: 'A change is made on a branch. Never on the trunk directly — including by the machine.',
    eli5: 'Changes are made on a copy, never on the live version.',
    why: 'The trunk is the thing that deploys. Nothing gets to edit it in place.',
  },
  {
    id: 'gate', name: 'The gate', where: 'a disposable machine',
    what: 'Lint, type-check, the full unit test suite, a production build, plus two bespoke checks: an anonymous-surface diff and a minimum-text-size floor.',
    eli5: 'Everything is checked automatically: does it compile, do the tests pass, did anything accidentally become public.',
    why: 'It runs code that has not been reviewed yet, so it belongs on a throwaway machine that holds no secrets — never on the box serving production.',
  },
  {
    id: 'tier', name: 'Risk classification', where: 'a disposable machine',
    what: 'The change set is diffed against the merge base and matched against a list of protected paths. Touching authentication, the data model, the deploy path or the agent’s own safety rails makes it high tier.',
    eli5: 'The change is sorted into “routine” or “needs a human”, based on which files it touches.',
    why: 'It classifies what this change ADDS, not everything that has landed since it branched — otherwise every long-lived branch is high tier for reasons that have nothing to do with it.',
  },
  {
    id: 'merge', name: 'Merge', where: 'the code host',
    what: 'A low-tier change from a machine-authored branch, with a green gate, can merge itself. Anything high tier waits for a person. Every human-authored change waits for a person too.',
    eli5: 'Small, safe, machine-written changes can go in by themselves. Anything touching something important waits for a human.',
    why: 'This is the actual boundary of autonomy in the system, and it is drawn by file path rather than by anybody’s judgement in the moment.',
  },
  {
    id: 'build', name: 'Build + deploy', where: 'the production machine',
    what: 'The build runs where it deploys. No artefact is transferred, and no deploy key for the production machine exists anywhere else.',
    eli5: 'The finished version is built on the same machine that serves it.',
    why: 'The build peaks at over five gigabytes — more than a standard hosted runner has. Building on the target removes both the memory problem and the need to store a production key off-site.',
  },
  {
    id: 'live', name: 'Live', where: 'the edge',
    what: 'The new version starts serving. A marker records exactly which commit is deployed, so “is it live?” has an answer that is not a guess.',
    eli5: 'It goes live, and it writes down which version went live.',
    why: 'Merged does not mean deployed. Without a marker you are reading the commit log and hoping.',
  },
];

export const SAFETY = [
  {
    title: 'The deploy cannot run if the gate is red',
    body: 'The deploy job declares the gate as a dependency, so a failing gate makes the deploy unreachable. This is the enforcement, not a convention: on this code host, in this plan, required status checks are not available at all — the configuration APIs simply refuse. A rule that a person has to remember would be no rule. A job that cannot start is one.',
  },
  {
    title: 'Two deploys never touch the machine at once',
    body: 'Runs are serialised, and deliberately not cancelled mid-flight. A queued deploy is an inconvenience; a half-finished one is an outage. The corollary is that a newer run can evict an older one that is still waiting, so “merged” and “deployed” can drift apart — which is exactly why the deployed commit is recorded rather than inferred.',
  },
  {
    title: 'The runner is capped below the machine',
    body: 'The build runs under a hard memory ceiling set below what the machine has. A runaway build gets killed by that ceiling instead of the kernel choosing a victim — and the kernel’s choice would very plausibly be the production process that is currently serving traffic.',
  },
  {
    title: 'Never deploy by hand',
    body: 'A hand-rolled deploy once copied a development machine’s configuration over production’s. The site was wrong for more than a day, and settings that are perfectly safe on a laptop are not safe on a server — so the damage was not only downtime. The production configuration file is now marked immutable at the filesystem level, meaning changing it has to be a deliberate two-step act rather than a side effect of copying a directory. The broader rule: configuration is not code, and must never travel with it.',
  },
  {
    title: 'The anonymous surface is a lockfile',
    body: 'Every route reachable without signing in is recorded in a checked-in file. Adding one makes the gate fail with a diff of exactly what became public, and it has to be acknowledged explicitly before it can pass. Writing this study tripped it — four new routes, all intended, all reviewed, then written down.',
  },
];

export const RISK_PATHS = [
  { group: 'Authentication and sessions', why: 'The front door.' },
  { group: 'Everything server-side', why: 'Anything that runs with privilege.' },
  { group: 'The protocol server', why: 'The external interface to the toolkit.' },
  { group: 'Encryption helpers', why: 'How stored credentials are protected.' },
  { group: 'Project and share guards', why: 'What decides whether a stranger can see something.' },
  { group: 'The database schema', why: 'Data shape changes are not additive in the way code is.' },
  { group: 'The pipeline itself', why: 'A change to the gate is a change to every future check.' },
  { group: 'The agent’s own safety rails', why: 'The sandbox, the confirmation gate, the tool deny-list. The machine may not quietly widen its own permissions.' },
];
