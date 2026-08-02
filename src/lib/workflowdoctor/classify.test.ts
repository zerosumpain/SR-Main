import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  classifySignature,
  coerceDiagnosis,
  diagnoseWithLlm,
  type ClassifyInput,
  type DoctorBudget,
} from './classify';
import { DOCTOR_MODEL, FIX_KIND_LABELS } from './types';
import type { VerificationIssue } from '$lib/workflows/orchestrator/verify';

/**
 * The strings below are the production ones from GROUND-TRUTH.md, already put
 * through the 80-character truncation `extractSignature` applies — that matters
 * for the datastore permission error, whose "is not permitted to read this
 * resource" tail does not survive the cut.
 */
const PROD = {
  deadType: 'No executor found for node type: icloud-cal',
  icloudCred: 'iCloud Calendar credential is required. Add one at /admin/integrations.',
  blockedToken: 'Blocked unsafe expression token: computed member access',
  aborted: 'Request was aborted.',
  credits: '402 Insufficient credits. Add more using https://openrouter.ai/settings/credits',
  tavily: 'Tavily API key not configured',
  unresolvedRef: 'Prompt template references unresolved: input.results. Check upstream node output',
  balance: 'Insufficient balance or no resource package. Please recharge.',
  transformSyntax: 'Transform expression failed: Unexpected token, expected ","',
  invalidGrant: 'Gmail token refresh failed: invalid_grant',
  dbForbidden: 'database: get failed (forbidden) — actor "workflow:8f14e45f-ceea-467a-9d2c-3a2b1',
  usageLimit: 'Usage limit reached for 5 hour window. Try again later.',
  timeout: 'Node 8f14e45f-ceea-467a-9d2c-3a2b1c4d5e6f (llm-call) timed out after 300s',
} as const;

function input(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    signature: PROD.deadType,
    nodeType: 'icloud-cal',
    nodeLabel: 'Read iCloud calendar',
    workflowName: 'canvas:icloud-new-event',
    canvasSlug: 'icloud-new-event',
    occurrences: 2,
    ...over,
  };
}

function lint(over: Partial<VerificationIssue> = {}): VerificationIssue {
  return {
    nodeId: 'n1',
    nodeLabel: 'Send WhatsApp',
    field: 'message',
    issue: 'whatsapp message content is empty — the node will fail with "No message content configured".',
    severity: 'error',
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The deterministic table — one case per kind, real production strings
// ---------------------------------------------------------------------------

describe('classifySignature — the failures production actually produces', () => {
  it('names the dead node type and its successor (5,053 of 5,069 failed runs)', () => {
    const d = classifySignature(input({ occurrences: 5053, successor: 'apple-calendar' }))!;
    expect(d.fixKind).toBe('dead-node-type');
    expect(d.causeSource).toBe('signature');
    expect(d.confident).toBe(true);
    expect(d.symptom).toBe('Every run fails immediately — 5,053 failures in the last 7 days.');
    expect(d.cause).toContain("node type ('icloud-cal') that no longer exists");
    expect(d.fix).toContain("Replace it with 'apple-calendar'");
  });

  it('does not invent a successor when the search found none', () => {
    const d = classifySignature(input({ successor: null }))!;
    expect(d.fix).not.toContain('Replace it with');
    expect(d.fix).toContain('Repoint the node at a type that still exists');
  });

  it.each([
    ['missing-credential', PROD.icloudCred, 'The iCloud Calendar credential is missing'],
    ['missing-credential', PROD.tavily, 'The Tavily API key is missing'],
    ['missing-credential', 'Credential not found: openrouter', "The credential 'openrouter' is missing"],
    ['provider-limit', PROD.credits, 'The OpenRouter account behind this node is out of credit'],
    ['provider-limit', PROD.balance, 'The provider account behind this node is out of credit'],
    ['provider-limit', PROD.usageLimit, 'The account hit a rate or usage limit'],
    ['expired-oauth', PROD.invalidGrant, 'The Gmail connection could not refresh'],
    ['unsupported-template-syntax', PROD.blockedToken, 'uses computed member access'],
    ['unsupported-template-syntax', PROD.transformSyntax, 'The expression does not parse'],
    ['broken-input-ref', PROD.unresolvedRef, "points at 'input.results'"],
  ])('classifies %s from %j', (kind, signature, causeFragment) => {
    const d = classifySignature(input({ signature, nodeType: 'llm-call', successor: null }))!;
    expect(d.fixKind).toBe(kind);
    expect(d.causeSource).toBe('signature');
    expect(d.confident).toBe(true);
    expect(d.cause).toContain(causeFragment);
  });

  it('recognises a permission denial from the prefix that survives truncation', () => {
    const d = classifySignature(input({ signature: PROD.dbForbidden }))!;
    expect(d.fixKind).toBe('permission-denied');
    expect(d.confident).toBe(true);
    expect(d.cause).toContain('not on the permission list');
    expect(d.fix).toContain('/admin/ai/datastore');
  });

  it('flags a family-level catch as not confident', () => {
    const broad = classifySignature(input({ signature: 'HERMES_BRIDGE_SECRET not configured' }))!;
    expect(broad.fixKind).toBe('missing-credential');
    expect(broad.confident).toBe(false);

    const forbidden = classifySignature(input({ signature: 'HTTP 403 Forbidden from https://example.com' }))!;
    expect(forbidden.fixKind).toBe('permission-denied');
    expect(forbidden.confident).toBe(false);
  });
});

describe('classifySignature — the honest non-diagnoses', () => {
  it('calls a timeout unclassified and says so in the fix text', () => {
    const d = classifySignature(input({ signature: PROD.timeout, nodeType: 'llm-call' }))!;
    expect(d.fixKind).toBe('unclassified');
    expect(d.confident).toBe(false);
    expect(d.symptom).toContain('The llm-call node ran for 300s and was killed');
    expect(d.cause).toContain('not what it was waiting on');
    expect(d.fix).toContain('Nothing here is a defect the doctor can fix');
  });

  it('calls an aborted request unclassified rather than guessing a cause', () => {
    const d = classifySignature(input({ signature: PROD.aborted }))!;
    expect(d.fixKind).toBe('unclassified');
    expect(d.confident).toBe(false);
    expect(d.fix).toContain('Nothing to change in the canvas');
  });

  it('returns null when neither table has anything to say', () => {
    expect(classifySignature(input({ signature: 'Deck build produced 0 slides' }))).toBeNull();
    expect(classifySignature(input({ signature: '' }))).toBeNull();
    expect(classifySignature(input({ signature: '   ', lintIssues: [] }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lint-driven kinds
// ---------------------------------------------------------------------------

describe('classifySignature — kinds only the linter can name', () => {
  it('reads unknown-config-key off the verifyWorkflow message', () => {
    const d = classifySignature(
      input({
        signature: '',
        nodeType: 'whatsapp',
        lintIssues: [
          lint({
            field: 'recipient',
            issue: 'Unknown config key "recipient". Valid keys for whatsapp: to, message, description',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('unknown-config-key');
    expect(d.causeSource).toBe('linter');
    expect(d.confident).toBe(true);
    expect(d.cause).toContain("'recipient' is not a setting on a whatsapp node");
    expect(d.fix).toContain("Delete 'recipient'");
  });

  it('reads enum-violation off the interactive-step message verifyWorkflow really emits', () => {
    const d = classifySignature(
      input({
        signature: '',
        nodeType: 'interactive-step',
        lintIssues: [
          lint({
            field: 'mode',
            issue:
              'interactive-step mode must be one of "vnc", "confirm", "both" (got "browse"). For CAPTCHA/login: use "vnc" with profile + url.',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('enum-violation');
    expect(d.cause).toContain(`'mode' is set to "browse"`);
    expect(d.cause).toContain('"vnc", "confirm", "both"');
    expect(d.fix).toContain(`Set 'mode' to whichever of "vnc", "confirm", "both"`);
  });

  it('reads enum-violation off the pre-submit validator message too', () => {
    const d = classifySignature(
      input({
        signature: '',
        nodeType: 'llm-call',
        lintIssues: [
          lint({
            field: 'responseFormat',
            issue: 'Invalid value for "responseFormat": "yaml". Must be one of: "text", "json".',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('enum-violation');
    expect(d.cause).toContain(`'responseFormat' is set to "yaml"`);
  });

  it('reads empty-required-field off a semantic gap, using the field the linter recorded', () => {
    const d = classifySignature(input({ signature: '', nodeType: 'whatsapp', lintIssues: [lint()] }))!;
    expect(d.fixKind).toBe('empty-required-field');
    expect(d.cause).toBe("'message' is required on a whatsapp node and it is empty.");
    expect(d.fix).toContain("Fill 'message' in");
  });

  it('reads unsupported-template-syntax off the Jinja/Handlebars rule', () => {
    const d = classifySignature(
      input({
        signature: '',
        nodeType: 'whatsapp',
        lintIssues: [
          lint({
            field: 'message',
            issue:
              'Contains Jinja block ({% ... %}). Supported template syntax is {{input.field}}, {{state.KEY}}, {{today}} and {{now}} only. Build the string in an upstream transform node instead.',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('unsupported-template-syntax');
    expect(d.cause).toContain('Jinja block');
    expect(d.fix).toContain('upstream transform node');
  });

  it('reads broken-input-ref off the schema check and names the available paths', () => {
    const d = classifySignature(
      input({
        signature: '',
        nodeType: 'llm-call',
        lintIssues: [
          lint({
            field: 'userPrompt',
            issue: 'Reference "input.results" not found in upstream schema. Available: input.items, input.count',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('broken-input-ref');
    expect(d.cause).toContain("points at 'input.results'");
    expect(d.fix).toContain('input.items, input.count');
  });

  it('finds a dead node type with no runs behind it — the six orphans nobody hand-fixed', () => {
    const d = classifySignature(
      input({
        signature: '',
        occurrences: 0,
        nodeType: 'stats-trends',
        successor: null,
        lintIssues: [
          lint({
            field: 'type',
            issue:
              'No executor found for node type: stats-trends. This node type is not in the registry, so every run of this workflow fails at this node.',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('dead-node-type');
    expect(d.causeSource).toBe('linter');
    expect(d.symptom).toBe('Every run fails immediately.');
    expect(d.cause).toContain("('stats-trends')");
  });

  it('ignores lint rules the doctor has no fix kind for', () => {
    const d = classifySignature(
      input({
        signature: '',
        lintIssues: [
          lint({
            field: 'code',
            issue: 'uses `inputs` (plural) — the sandbox exposes upstream data as `input` (singular).',
          }),
          lint({ field: 'dedupe', issue: 'recurring send with no dedupe memory', severity: 'warning' }),
        ],
      }),
    );
    expect(d).toBeNull();
  });
});

describe('classifySignature — which half wins', () => {
  it('prefers the linter when both name the same kind: it knows the field', () => {
    const d = classifySignature(
      input({
        signature: PROD.unresolvedRef,
        nodeType: 'llm-call',
        lintIssues: [
          lint({
            field: 'userPrompt',
            issue: 'Reference "input.results" not found in upstream schema. Available: input.items',
          }),
        ],
      }),
    )!;
    expect(d.fixKind).toBe('broken-input-ref');
    expect(d.causeSource).toBe('linter');
    expect(d.fix).toContain('input.items');
  });

  it('prefers the runtime signature when the two disagree', () => {
    const d = classifySignature(
      input({
        signature: PROD.tavily,
        nodeType: 'whatsapp',
        lintIssues: [lint()],
      }),
    )!;
    expect(d.fixKind).toBe('missing-credential');
    expect(d.causeSource).toBe('signature');
  });

  it('lets a concrete lint defect beat a timeout, which is only a symptom', () => {
    const d = classifySignature(
      input({
        signature: PROD.timeout,
        nodeType: 'whatsapp',
        lintIssues: [lint()],
      }),
    )!;
    expect(d.fixKind).toBe('empty-required-field');
    expect(d.causeSource).toBe('linter');
  });
});

describe('classifySignature — nothing sensitive survives into the prose', () => {
  it('scrubs a config value the linter quoted verbatim', () => {
    const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const d = classifySignature(
      input({
        signature: '',
        nodeType: 'http-request',
        lintIssues: [
          lint({
            field: 'authMode',
            issue: `Invalid value for "authMode": "${secret}". Must be one of: "none", "bearer".`,
          }),
        ],
      }),
    )!;
    expect(d.cause).toContain('[redacted:api-key]');
    expect(JSON.stringify(d)).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// coerceDiagnosis — never trust the model's shape
// ---------------------------------------------------------------------------

describe('coerceDiagnosis', () => {
  const good = {
    fixKind: 'missing-credential',
    symptom: 'This node fails every time.',
    cause: 'The Notion token is missing.',
    fix: 'Add it at /admin/connections.',
  };

  it('accepts a well-formed reply and marks it as the weaker source', () => {
    const d = coerceDiagnosis(good)!;
    expect(d.fixKind).toBe('missing-credential');
    expect(d.causeSource).toBe('llm');
    expect(d.confident).toBe(false);
  });

  it('unwraps a fenced JSON string and prose either side of it', () => {
    const d = coerceDiagnosis('Sure! ```json\n' + JSON.stringify(good) + '\n``` Hope that helps.')!;
    expect(d.fixKind).toBe('missing-credential');
    expect(d.cause).toBe('The Notion token is missing.');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['unparseable prose', 'I think the node is broken?'],
    ['an array', [good]],
    ['an empty object', {}],
    ['a made-up fixKind', { ...good, fixKind: 'broken-vibes' }],
    ['a fixKind of the wrong type', { ...good, fixKind: ['missing-credential'] }],
    ['a missing cause', { ...good, cause: undefined }],
    ['a blank fix', { ...good, fix: '   ' }],
    ['a non-string symptom', { ...good, symptom: { text: 'nope' } }],
    ['an essay where a sentence was asked for', { ...good, cause: 'x'.repeat(241) }],
    ['the bare unsure reply the prompt asks for', { fixKind: 'unclassified' }],
  ])('returns null for %s', (_label, raw) => {
    expect(coerceDiagnosis(raw)).toBeNull();
  });

  it.each(['runaway-schedule', 'secret-in-node-config'])(
    'refuses the machine-only kind %s even when the shape is perfect',
    (fixKind) => {
      expect(coerceDiagnosis({ ...good, fixKind })).toBeNull();
    },
  );

  it('accepts every other FixKind the contract declares', () => {
    const machineOnly = new Set(['runaway-schedule', 'secret-in-node-config']);
    for (const fixKind of Object.keys(FIX_KIND_LABELS)) {
      if (machineOnly.has(fixKind)) continue;
      expect(coerceDiagnosis({ ...good, fixKind })?.fixKind).toBe(fixKind);
    }
  });

  it('redacts prose the model echoed a secret into', () => {
    const d = coerceDiagnosis({
      ...good,
      cause: 'The stored key sk-or-v1-0123456789abcdef0123456789abcdef was rejected.',
    })!;
    expect(d.cause).toContain('[redacted:api-key]');
    expect(d.cause).not.toContain('sk-or-v1-0123456789abcdef0123456789abcdef');
  });
});

// ---------------------------------------------------------------------------
// The LLM fallback
// ---------------------------------------------------------------------------

type Call = {
  messages: Array<{ role: string; content: string }>;
  opts?: { maxTokens?: number; temperature?: number; model?: string };
};

function fakeBudget(reply: unknown | (() => never)): { budget: DoctorBudget; calls: Call[] } {
  const calls: Call[] = [];
  const budget: DoctorBudget = {
    async call(messages, opts) {
      calls.push({ messages, opts });
      if (typeof reply === 'function') (reply as () => never)();
      return { content: JSON.stringify(reply), json: reply };
    },
  };
  return { budget, calls };
}

const llmReply = {
  fixKind: 'permission-denied',
  symptom: 'The node cannot read the file it was given.',
  cause: 'The workflow actor has no read permission on that path.',
  fix: 'Grant the actor read access, then re-run.',
};

describe('diagnoseWithLlm', () => {
  it('picks up where the table gives up', async () => {
    const missed = input({ signature: 'Deck build produced 0 slides' });
    expect(classifySignature(missed)).toBeNull();

    const { budget, calls } = fakeBudget(llmReply);
    const d = await diagnoseWithLlm(budget, missed);

    expect(calls).toHaveLength(1);
    expect(d?.fixKind).toBe('permission-denied');
    expect(d?.causeSource).toBe('llm');
    expect(d?.confident).toBe(false);
  });

  it('pins DOCTOR_MODEL and leaves room for reasoning tokens', async () => {
    const { budget, calls } = fakeBudget(llmReply);
    await diagnoseWithLlm(budget, input({ signature: 'something new' }));
    expect(calls[0].opts?.model).toBe(DOCTOR_MODEL);
    expect(calls[0].opts?.maxTokens).toBeGreaterThanOrEqual(3000);
  });

  it('ends the system prompt with the JSON instruction and offers the unsure escape', async () => {
    const { budget, calls } = fakeBudget(llmReply);
    await diagnoseWithLlm(budget, input({ signature: 'something new' }));
    const system = calls[0].messages[0];
    expect(system.role).toBe('system');
    expect(system.content.endsWith('Respond with ONLY JSON.')).toBe(true);
    expect(system.content).toContain('{"fixKind": "unclassified"}');
    expect(system.content).not.toContain('runaway-schedule');
    expect(system.content).not.toContain('secret-in-node-config');
  });

  it('scrubs the prompt — the linter quotes config values, the signature does not', async () => {
    const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const { budget, calls } = fakeBudget(llmReply);
    await diagnoseWithLlm(
      budget,
      input({
        signature: 'something new',
        lintIssues: [lint({ field: 'apiKey', issue: `Invalid value for "apiKey": "${secret}".` })],
      }),
    );
    const user = calls[0].messages[1].content;
    expect(user).not.toContain(secret);
    expect(user).toContain('[redacted:api-key]');
    expect(user).toContain('Error signature: something new');
  });

  it('returns null rather than a guess when the model answers badly', async () => {
    const { budget } = fakeBudget({ fixKind: 'unclassified' });
    expect(await diagnoseWithLlm(budget, input({ signature: 'something new' }))).toBeNull();
  });

  it('swallows a gateway failure — one signature must not sink the phase', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { budget } = fakeBudget(() => {
      throw new Error('gateway 502');
    });
    expect(await diagnoseWithLlm(budget, input({ signature: 'something new' }))).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('re-throws a budget exhaustion so the run stops', async () => {
    const { budget } = fakeBudget(() => {
      const err = new Error('budget exceeded (calls=20/20)');
      err.name = 'BudgetExceededError';
      throw err;
    });
    await expect(diagnoseWithLlm(budget, input({ signature: 'something new' }))).rejects.toThrow(
      'budget exceeded',
    );
  });
});
