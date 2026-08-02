// src/lib/workflowdoctor/classify.ts
//
// DIAGNOSE. One failure signature — plus whatever the linter said about the same
// node — in; a FixKind and a plain-English Symptom / Cause / Fix triple out.
//
// The regex table is the whole point, not a shortcut before the "real" model
// call. 99.8% of the failures in the window are six orphaned nodes throwing one
// string, and a rule that names that string is cheaper, faster and far more
// trustworthy than a model paraphrasing it. `diagnoseWithLlm` exists only for
// what the table misses, and everything it produces is stamped
// `causeSource: 'llm'` so the report page can render it as visibly weaker than
// a linter fact.
//
// Nothing here touches the database, the registry or the gateway directly: the
// imports are types, the sensitive-data scrub, and a type-only VerificationIssue.
// That is deliberate — the deterministic half must stay testable with no mocks.
//
// The `maxDiagnoses` cap on the LLM path is the CALLER's: the budget is injected
// rather than constructed here, so the diagnose phase counts calls in one place
// (WORK_CAPS.maxDiagnoses) instead of two.

import { redactSensitive } from '$lib/security/sensitive';
import type { VerificationIssue } from '$lib/workflows/orchestrator/verify';
import { DOCTOR_MODEL, FIX_KIND_LABELS, WORK_CAPS, errMsg, type FixKind } from './types';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ClassifyInput {
  /** extractSignature() output, already redacted by triage's signatureOf(). */
  signature: string;
  nodeType?: string | null;
  nodeLabel?: string | null;
  workflowName?: string | null;
  canvasSlug?: string | null;
  /** Failures in the window. Drives the count in the symptom sentence. */
  occurrences?: number;
  /** This node's slice of WorkflowLint.byNodeId. */
  lintIssues?: VerificationIssue[];
  /** pickSuccessor()'s candidate for a retired node type. Evidence, not a plan. */
  successor?: string | null;
}

export interface Diagnosis {
  fixKind: FixKind;
  symptom: string;
  cause: string;
  fix: string;
  causeSource: 'signature' | 'linter' | 'llm';
  /**
   * The match named the specific defect rather than just its family. A broad
   * catch (`/not configured/i`, `/forbidden/i`) and everything the model says
   * are `false` — the caller should report those, not act on them.
   */
  confident: boolean;
}

/** What the table can produce. The LLM path is the only source of `llm`. */
export type DeterministicDiagnosis = Diagnosis & { causeSource: 'signature' | 'linter' };

/** Symptom / Cause / Fix, before provenance is attached. */
interface Prose {
  symptom: string;
  cause: string;
  fix: string;
}

/**
 * The slice of the run Budget this module needs, declared structurally rather
 * than imported from './run'. Keeps the classifier — and its tests — free of
 * the pipeline, while any real Budget still satisfies it.
 */
export interface DoctorBudget {
  call(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: { maxTokens?: number; temperature?: number; model?: string },
  ): Promise<{ content: string; json: unknown }>;
}

// ---------------------------------------------------------------------------
// Prose helpers
// ---------------------------------------------------------------------------

/** Thousands separators without ICU — `5053` → `5,053`. */
function fmtCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Finish a symptom sentence with the evidence behind it. Volume is the single
 * most persuasive fact the doctor has — 5,053 is an argument, "it fails" is not.
 */
function withCount(base: string, occurrences?: number): string {
  return occurrences && occurrences > 1
    ? `${base} — ${fmtCount(occurrences)} failures in the last ${WORK_CAPS.lookbackDays} days.`
    : `${base}.`;
}

function typeName(input: ClassifyInput): string {
  return (input.nodeType ?? '').trim() || 'this';
}

/** Shared by the signature rule and the linter rule — they see the same defect. */
function deadTypeProse(deadType: string, input: ClassifyInput): Prose {
  return {
    symptom: withCount('Every run fails immediately', input.occurrences),
    cause: `This canvas uses a node type ('${deadType}') that no longer exists in the app, so the run dies at that node before it does anything.`,
    fix: input.successor
      ? `Replace it with '${input.successor}', which looks like its replacement, then re-run.`
      : `Repoint the node at a type that still exists, or delete it from the canvas — no config change can revive a retired type.`,
  };
}

/**
 * Scrub composed prose on the way out.
 *
 * The signature arrives pre-redacted, but the linter does not: verify.ts
 * interpolates raw config values into its messages (`Invalid value for
 * "apiKey": "sk-…"`), and this module quotes those messages back.
 */
function scrub(p: Prose): Prose {
  return {
    symptom: redactSensitive(p.symptom),
    cause: redactSensitive(p.cause),
    fix: redactSensitive(p.fix),
  };
}

// ---------------------------------------------------------------------------
// Signature table
// ---------------------------------------------------------------------------

interface SignatureRule {
  kind: FixKind;
  re: RegExp;
  /** Family-level match only — sets `confident: false`. */
  broad?: boolean;
  describe: (m: RegExpExecArray, input: ClassifyInput) => Prose;
}

/**
 * Ordered, most specific first. Every entry corresponds to a string actually
 * seen in production (GROUND-TRUTH.md) — this table is not speculative, and a
 * rule with no observed traffic behind it should not be added to it.
 *
 * Two ordering rules matter: a rule that NAMES the thing must precede the family
 * catch-all that would also match it (`Tavily API key not configured` before
 * `/not configured/i`), and the two honest non-diagnoses (timeout, abort) sit
 * near the top so a broad rule cannot claim them.
 */
const SIGNATURE_RULES: SignatureRule[] = [
  {
    // 5,053 of 5,069 failed runs. Thrown at engine.ts before any node_executions
    // row is written, so it only ever appears on workflow_runs.error.
    kind: 'dead-node-type',
    re: /^No executor found for node type: (.+)$/,
    describe: (m, input) => deadTypeProse(m[1].trim(), input),
  },
  {
    // A timeout is a symptom, not a defect. Saying so plainly is the honest
    // answer; there is no config field behind the per-node timeout table.
    kind: 'unclassified',
    re: /timed out after (\d+)s/,
    describe: (m, input) => {
      const typed = /^Node\s+\S+\s+\((.+?)\)\s+timed out/.exec(input.signature);
      const what = typed ? `The ${typed[1]} node` : 'The node';
      return {
        symptom: withCount(`${what} ran for ${m[1]}s and was killed`, input.occurrences),
        cause:
          'A timeout records that the node was too slow, not what it was waiting on — there is no error, no stack and no input snapshot behind it.',
        fix: 'Nothing here is a defect the doctor can fix. Look at what the node waits on (a slow provider, a large page, a stuck upstream); the per-node timeout is a code table, not a config field.',
      };
    },
  },
  {
    kind: 'unclassified',
    re: /^Request was aborted\.?$/i,
    describe: (_m, input) => ({
      symptom: withCount('The call was cancelled part-way through', input.occurrences),
      cause:
        'Something abandoned the request before it returned — usually a deploy drain, a dropped connection, or an upstream giving up. No defect is recorded.',
      fix: 'Nothing to change in the canvas. If it clusters at one time of day, look for a restart or a slow upstream instead.',
    }),
  },
  {
    kind: 'expired-oauth',
    re: /^(.+?) token refresh failed/i,
    describe: (m, input) => oauthProse(m[1].trim(), input),
  },
  { kind: 'expired-oauth', re: /invalid_grant/, describe: (_m, input) => oauthProse(null, input) },
  {
    kind: 'provider-limit',
    re: /Insufficient credits/i,
    describe: (_m, input) => creditProse(input),
  },
  {
    kind: 'provider-limit',
    re: /Insufficient balance/i,
    describe: (_m, input) => creditProse(input),
  },
  {
    kind: 'provider-limit',
    re: /Usage limit reached/i,
    describe: (_m, input) => rateProse(input),
  },
  { kind: 'provider-limit', re: /rate limit/i, describe: (_m, input) => rateProse(input) },
  {
    kind: 'missing-credential',
    re: /^Credential not found: (.+)$/,
    describe: (m, input) => credentialProse(`The credential '${m[1].trim()}'`, input),
  },
  {
    kind: 'missing-credential',
    re: /^(.+?) credential is required/i,
    describe: (m, input) => credentialProse(`The ${m[1].trim()} credential`, input),
  },
  {
    kind: 'missing-credential',
    re: /^(.+?) API key not configured/i,
    describe: (m, input) => credentialProse(`The ${m[1].trim()} API key`, input),
  },
  {
    kind: 'missing-credential',
    re: /token not available\. Connect /,
    describe: (_m, input) => credentialProse('The connection this node signs in with', input),
  },
  {
    kind: 'missing-credential',
    re: /not configured/i,
    broad: true,
    describe: (_m, input) => credentialProse('A credential or environment value this node needs', input),
  },
  {
    kind: 'permission-denied',
    re: /is not permitted to read this resource/,
    describe: (_m, input) => permissionProse(input),
  },
  {
    // The full datastore error is 127 characters and extractSignature truncates
    // at 80, so the "is not permitted…" tail above is usually already gone by the
    // time we see it. This prefix is what actually survives.
    kind: 'permission-denied',
    re: /^database: \w+ failed \(\w+\)/,
    describe: (_m, input) => permissionProse(input),
  },
  { kind: 'permission-denied', re: /forbidden/i, broad: true, describe: (_m, input) => permissionProse(input) },
  {
    kind: 'unsupported-template-syntax',
    re: /^Blocked unsafe expression token:?\s*(.*)$/,
    describe: (m, input) => ({
      symptom: withCount('The transform node refuses to run its expression', input.occurrences),
      cause: m[1].trim()
        ? `The expression uses ${m[1].trim()}, which the expression sandbox will not evaluate.`
        : 'The expression uses a construct the expression sandbox will not evaluate.',
      fix: 'Rewrite it with plain dot-paths — no obj[key], no function calls — or move the work into a code-execute node upstream.',
    }),
  },
  {
    kind: 'unsupported-template-syntax',
    re: /^Transform expression failed:?\s*(.*)$/,
    describe: (m, input) => ({
      symptom: withCount('The transform node fails before it produces any output', input.occurrences),
      cause: m[1].trim()
        ? `The expression does not parse — the engine reported "${m[1].trim()}".`
        : 'The expression does not parse.',
      fix: 'Correct the expression syntax in the node config, then re-run.',
    }),
  },
  {
    kind: 'broken-input-ref',
    re: /references unresolved:?\s*([\w.$]+)?/i,
    describe: (m, input) => brokenRefProse((m[1] ?? '').replace(/\.+$/, ''), null, input),
  },
  {
    kind: 'broken-input-ref',
    re: /not found in upstream schema/i,
    describe: (_m, input) => brokenRefProse('', null, input),
  },
];

function oauthProse(service: string | null, input: ClassifyInput): Prose {
  return {
    symptom: withCount(
      'This node fails every time, and it started failing without anyone touching the canvas',
      input.occurrences,
    ),
    cause: `${service ? `The ${service} connection` : 'The saved connection'} could not refresh — its token was revoked or has expired, so every call is rejected before it reaches the account.`,
    fix: 'Reconnect the account at /admin/connections, then re-run. Nothing in the app can mint a new token.',
  };
}

function creditProse(input: ClassifyInput): Prose {
  const provider = /openrouter/i.test(input.signature) ? 'The OpenRouter account' : 'The provider account';
  return {
    symptom: withCount('The provider rejected the call before the model ran', input.occurrences),
    cause: `${provider} behind this node is out of credit, so every request comes back refused. Nothing about the canvas is wrong.`,
    fix: 'Top the account up, then re-run. No config change fixes a billing refusal.',
  };
}

function rateProse(input: ClassifyInput): Prose {
  return {
    symptom: withCount('The provider refused the call without running it', input.occurrences),
    cause: 'The account hit a rate or usage limit — the calls arrived faster, or more often, than the plan allows.',
    fix: 'Spread the schedule out or raise the plan limit. The canvas itself is fine.',
  };
}

function credentialProse(subject: string, input: ClassifyInput): Prose {
  return {
    symptom: withCount('This node fails immediately, every time it runs', input.occurrences),
    cause: `${subject} is missing, so the node stops before it does any work.`,
    fix: 'Add it at /admin/connections (API keys live at /admin/ai/apis), then re-run — nothing in the app can mint a credential.',
  };
}

function permissionProse(input: ClassifyInput): Prose {
  return {
    symptom: withCount('The node is refused when it reads or writes stored data', input.occurrences),
    cause: "The workflow's own actor is not on the permission list for that collection, so the datastore denies the read.",
    fix: "Add the workflow actor to the collection's read/write list at /admin/ai/datastore, or point the node at a collection it may use.",
  };
}

function brokenRefProse(ref: string, available: string | null, input: ClassifyInput): Prose {
  const list = (available ?? '').trim();
  return {
    symptom: withCount('This node fails as soon as it tries to build its input', input.occurrences),
    cause: ref
      ? `The template points at '${ref}', which the upstream node does not actually produce.`
      : 'The template points at a field the upstream node does not actually produce.',
    fix: list
      ? `Repoint it at one of: ${list.slice(0, 120)}, then re-run.`
      : 'Repoint it at a field the upstream node emits — the canvas lists them on the node — then re-run.',
  };
}

// ---------------------------------------------------------------------------
// Linter table
// ---------------------------------------------------------------------------

interface LintRule {
  kind: FixKind;
  re: RegExp;
  /** Warnings are counted but never diagnosed — only errors can match. */
  errorOnly?: boolean;
  describe: (m: RegExpExecArray, issue: VerificationIssue, input: ClassifyInput) => Prose;
}

/**
 * The three lint-driven kinds ('unknown-config-key', 'enum-violation',
 * 'empty-required-field') exist only here: no runtime error names them, because
 * the node either never runs or fails with a message about the consequence.
 *
 * `issue.field` is used for the field name wherever possible rather than a
 * capture group — verify.ts already put the field there, and re-parsing its
 * prose is how a reworded message becomes a silent misdiagnosis.
 */
const LINT_RULES: LintRule[] = [
  {
    kind: 'dead-node-type',
    re: /^No executor found for node type: ([^.\s]+)/,
    describe: (m, _issue, input) => deadTypeProse(m[1], input),
  },
  {
    kind: 'unknown-config-key',
    re: /^Unknown config key "(.+?)"/,
    describe: (m, _issue, input) => ({
      symptom: 'This node carries a setting the app does not read.',
      cause: `'${m[1]}' is not a setting on a ${typeName(input)} node, so its value is ignored — and it hides whichever real setting was meant to hold it.`,
      fix: `Delete '${m[1]}' from the node config. It was never read, so there is nothing to rename it to.`,
    }),
  },
  {
    kind: 'enum-violation',
    re: /^Invalid value for "(.+?)": (.+?)\. Must be one of: (.+?)\.?$/,
    describe: (m, _issue, input) => enumProse(m[1], m[2], m[3], input),
  },
  {
    // What verifyWorkflow actually emits today: detectEnumViolations is wired
    // into validateNodeConfigPreSubmit only, so the interactive-step semantic
    // rule is the enum complaint that reaches the doctor.
    kind: 'enum-violation',
    re: /^\S+ (\w+) must be one of (.+?) \(got ([^)]*)\)/,
    describe: (m, issue, input) => enumProse(issue.field || m[1], m[3], m[2], input),
  },
  {
    kind: 'empty-required-field',
    re: /\b(?:is empty|requires an?)\b/i,
    errorOnly: true,
    describe: (_m, issue, input) => ({
      symptom: 'The node has nothing to work with, so it fails before it starts.',
      cause: `'${issue.field}' is required on a ${typeName(input)} node and it is empty.`,
      fix: `Fill '${issue.field}' in, or wire an upstream node into it, then re-run.`,
    }),
  },
  {
    kind: 'unsupported-template-syntax',
    re: /^Contains (.+?)\. Supported template syntax is/,
    describe: (m, issue) => ({
      symptom: 'The message this node sends comes out with the template still in it.',
      cause: `The '${issue.field}' template uses ${m[1]}, which the engine does not interpolate — it is passed through as literal text.`,
      fix: 'Use {{input.field}}, {{state.KEY}}, {{today}} or {{now}} only; build loops and conditionals in an upstream transform node.',
    }),
  },
  {
    kind: 'broken-input-ref',
    re: /^Reference "(.+?)" not found in upstream schema\.(?:\s*Available:\s*(.*))?/,
    describe: (m, _issue, input) => brokenRefProse(m[1], m[2] ?? null, input),
  },
  {
    kind: 'broken-input-ref',
    re: /^Unknown template variable \{\{(.+?)\}\}/,
    describe: (m, issue) => ({
      symptom: 'The message this node sends comes out with the placeholder still in it.',
      cause: `'{{${m[1]}}}' in '${issue.field}' is not a variable the engine substitutes, so it is sent as literal text.`,
      fix: 'Use {{input.field}}, {{state.KEY}}, {{today}} or {{now}}, then re-run.',
    }),
  },
];

function enumProse(field: string, value: string, allowed: string, input: ClassifyInput): Prose {
  return {
    symptom: 'The node is set to an option that does not exist, so the run stalls or fails on it.',
    cause: `'${field}' is set to ${value}, which is not one of the values a ${typeName(input)} node accepts (${allowed}).`,
    fix: `Set '${field}' to whichever of ${allowed} you meant, then re-run.`,
  };
}

// ---------------------------------------------------------------------------
// Deterministic classification
// ---------------------------------------------------------------------------

function matchSignature(input: ClassifyInput): DeterministicDiagnosis | null {
  const signature = (input.signature ?? '').trim();
  if (!signature) return null;
  for (const rule of SIGNATURE_RULES) {
    const m = rule.re.exec(signature);
    if (!m) continue;
    return {
      fixKind: rule.kind,
      ...scrub(rule.describe(m, input)),
      causeSource: 'signature',
      confident: !rule.broad && rule.kind !== 'unclassified',
    };
  }
  return null;
}

function matchLint(input: ClassifyInput): DeterministicDiagnosis | null {
  const issues = input.lintIssues ?? [];
  if (!issues.length) return null;
  // Errors before warnings; within a severity, verify.ts's own rule order stands.
  const ordered = [...issues].sort(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
  for (const issue of ordered) {
    for (const rule of LINT_RULES) {
      if (rule.errorOnly && issue.severity !== 'error') continue;
      const m = rule.re.exec(issue.issue ?? '');
      if (!m) continue;
      return {
        fixKind: rule.kind,
        ...scrub(rule.describe(m, issue, input)),
        causeSource: 'linter',
        confident: true,
      };
    }
  }
  return null;
}

/**
 * Deterministic diagnosis, or null when neither table has anything to say (the
 * caller may then spend one LLM call on it).
 *
 * When both tables fire on the same kind the LINTER wins: it knows the field
 * name and the legal values, where the runtime error only knows the
 * consequence. When they disagree the SIGNATURE wins — it is evidence of what
 * actually broke, not of what might — except where the signature is a timeout
 * or an abort, which describe a symptom and so lose to any concrete defect.
 */
export function classifySignature(input: ClassifyInput): DeterministicDiagnosis | null {
  const fromSignature = matchSignature(input);
  const fromLint = matchLint(input);

  if (fromSignature && fromLint) {
    if (fromSignature.fixKind === fromLint.fixKind) return fromLint;
    if (fromSignature.fixKind === 'unclassified') return fromLint;
    return fromSignature;
  }
  return fromSignature ?? fromLint;
}

// ---------------------------------------------------------------------------
// LLM fallback
// ---------------------------------------------------------------------------

const VALID_FIX_KINDS = new Set<string>(Object.keys(FIX_KIND_LABELS));

/**
 * Kinds a model may never assert. Both are decided by a machine detector on
 * evidence the model cannot see — `hasSensitive()` over the stored config, and
 * the consecutive-failure count on a schedule — and both open a write path.
 */
const MACHINE_ONLY_KINDS = new Set<string>(['runaway-schedule', 'secret-in-node-config']);

/** Longest prose field we will take from the model. */
const MAX_PROSE = 240;

const LLM_KINDS = [...VALID_FIX_KINDS].filter((k) => !MACHINE_ONLY_KINDS.has(k));

const SYSTEM_PROMPT =
  'You are a workflow triage engineer looking at ONE failing node in a low-code automation canvas. ' +
  'Classify the failure and explain it to the canvas owner, who is not reading the code. ' +
  `"fixKind" must be exactly one of: ${LLM_KINDS.join(', ')}. ` +
  'If you are not sure which one it is, reply {"fixKind": "unclassified"} and nothing else — a confident ' +
  'wrong classification is worse than none, and guessing is never the right answer. ' +
  'Otherwise reply {"fixKind": string, "symptom": string, "cause": string, "fix": string} where symptom is ' +
  'what the owner sees, cause is why it happens, and fix is the single thing to change. Each string must be ' +
  'plain English under 240 characters, with no markdown, no jargon and no apology. ' +
  'Never invent a credential name, a field name, a node type or a file path that is not in the input. ' +
  'Respond with ONLY JSON.';

function buildUserMessage(input: ClassifyInput): string {
  const lines = [
    `Node type: ${input.nodeType ?? 'unknown'}`,
    `Node label: ${input.nodeLabel ?? 'unlabelled'}`,
    `Canvas: ${input.canvasSlug ?? input.workflowName ?? 'unknown'}`,
    `Failures in the last ${WORK_CAPS.lookbackDays} days: ${input.occurrences ?? 1}`,
    `Error signature: ${input.signature}`,
  ];
  const lint = (input.lintIssues ?? []).slice(0, 6).map((i) => `- [${i.severity}] ${i.field}: ${i.issue}`);
  if (lint.length) lines.push('Linter on this node:', ...lint);
  // The signature is redacted upstream; the linter text is NOT — verify.ts
  // interpolates raw config values into its messages. Scrub the whole prompt
  // rather than trusting each contributor to have done it.
  return redactSensitive(lines.join('\n')).slice(0, 4000);
}

/**
 * Loose JSON extraction. `budget.call` already parses, so this only runs when we
 * are handed the raw string — a model that wrapped the object in a fence or an
 * apology. Deliberately local: types.ts has no parseJsonLoose of its own.
 */
function parseLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const slice = start === -1 || end <= start ? candidate : candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function proseField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PROSE) return null;
  return redactSensitive(trimmed);
}

/**
 * Validate a model reply into a Diagnosis, or null.
 *
 * Hand-written rather than schema-driven, and it returns null on ANY surprise:
 * a missing field, a fixKind that is not one of ours, a novel prose field, an
 * essay where a sentence was asked for. The bare `{"fixKind":"unclassified"}`
 * the prompt asks for when the model is unsure also lands here as null, which
 * is the same outcome — no diagnosis.
 */
export function coerceDiagnosis(raw: unknown): Diagnosis | null {
  const parsed = typeof raw === 'string' ? parseLoose(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const fixKind = typeof obj.fixKind === 'string' ? obj.fixKind.trim() : '';
  if (!VALID_FIX_KINDS.has(fixKind) || MACHINE_ONLY_KINDS.has(fixKind)) return null;

  const symptom = proseField(obj.symptom);
  const cause = proseField(obj.cause);
  const fix = proseField(obj.fix);
  if (!symptom || !cause || !fix) return null;

  return { fixKind: fixKind as FixKind, symptom, cause, fix, causeSource: 'llm', confident: false };
}

/**
 * One gateway call for a signature the tables missed. Returns null on anything
 * other than a clean, well-shaped answer — an unclassified failure is a fine
 * outcome and the report says so honestly.
 *
 * The budget is injected so the diagnose phase owns the WORK_CAPS.maxDiagnoses
 * cap; a BudgetExceededError is re-thrown (it stops the run) while every other
 * failure is swallowed, because one undiagnosed signature must not sink a phase.
 */
export async function diagnoseWithLlm(
  budget: DoctorBudget,
  input: ClassifyInput,
): Promise<Diagnosis | null> {
  try {
    const { content, json } = await budget.call(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input) },
      ],
      // Pinned model, and >=3000 tokens so a reasoning model cannot burn the
      // whole allowance before it emits the object.
      { maxTokens: 3000, temperature: 0.1, model: DOCTOR_MODEL },
    );
    return coerceDiagnosis(json ?? content);
  } catch (err) {
    // Matched by name, not instanceof: importing BudgetExceededError from './run'
    // would drag the pipeline into this module and into all of its tests.
    if (err instanceof Error && err.name === 'BudgetExceededError') throw err;
    console.error('[workflowdoctor] diagnose call failed:', errMsg(err));
    return null;
  }
}
