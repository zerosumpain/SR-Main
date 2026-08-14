// src/lib/secrets/credential-requests.ts
//
// The catalogue of credentials jkai is allowed to ASK the owner for.
//
// THIS FILE IS THE SECURITY BOUNDARY. Everything that determines where a
// credential ends up and where it may be sent — the handle, the source, the
// injection, the allowed hosts, methods and path prefixes — is declared here in
// code. None of it is ever taken from model arguments.
//
// The reason is specific rather than theoretical. `upsertSecret` is an UPSERT
// that rewrites `allowedHosts` unconditionally while the value is optional, so a
// model that could choose a handle plus a host list could re-point an EXISTING
// credential at a host it controls and then read it back through an ordinary
// `api_call`. The `request_credential` tool therefore has no handle, source,
// host or injection parameter at all; it names a provider from this table, and
// the modal shows the owner what the binding will be before anything is written.
//
// Background: on 2026-08-01 the owner pasted a TrueLayer client_secret and a
// PayPal client_secret straight into jkai chat because there was no other way to
// hand them over. They ended up in ten places including an LLM provider. This
// table plus the modal is the supported alternative.

import { classifyBindingChange, type BindingChange, type SecretBinding, type SecretInjection } from './registry';
import { OAUTH_PROVIDERS } from './oauth-refresh';
export { customCredentialSavePayload, parseCustomAllowedHosts } from './custom-credential';

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  required: boolean;
  placeholder?: string;
  /** Shown under the input. Plain guidance, never model-authored. */
  help?: string;
}

/** One row that will be written to `api_secrets`. */
export interface CredentialBinding {
  handle: string;
  source: 'vault' | 'ref';
  refKey?: string;
  injection: SecretInjection;
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPathPrefixes?: string[];
  notes?: string;
}

export interface CredentialRequestSpec {
  provider: string;
  title: string;
  /** Where the owner goes to find these values. */
  helpUrl?: string;
  fields: CredentialField[];
  /**
   * 'single' — one field, stored as the raw value.
   * 'json'   — several fields, stored as one JSON object. This is what makes
   *            "capture whatever data is required" work, and it is exactly the
   *            shape `oauth-refresh.ts` reads back (`StoredOAuthCredential`).
   */
  assemble: 'single' | 'json';
  /** The row that holds the value the owner types. */
  binding: CredentialBinding;
  /**
   * Extra rows created alongside — e.g. the `ref` row a canvas node references,
   * whose value is minted from the vault row rather than stored.
   */
  companions?: CredentialBinding[];
}

const tl = OAUTH_PROVIDERS.truelayer;
const pp = OAUTH_PROVIDERS.paypal;

export const CREDENTIAL_REQUEST_SPECS: Record<string, CredentialRequestSpec> = {
  truelayer: {
    provider: 'truelayer',
    title: 'TrueLayer (open banking)',
    helpUrl: 'https://console.truelayer.com/',
    assemble: 'json',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true, placeholder: 'yourapp-1a2b3c' },
      { key: 'client_secret', label: 'Client secret', type: 'password', required: true },
      {
        key: 'refresh_token',
        label: 'Refresh token',
        type: 'password',
        required: true,
        help: 'Rotates on every refresh — jkai writes the new one back automatically, so you only enter this once.',
      },
    ],
    binding: {
      handle: tl.vaultHandle,
      source: 'vault',
      injection: { kind: 'none' },
      allowedHosts: [tl.tokenHost],
      allowedMethods: ['POST'],
      notes: 'Credential set read only by $lib/secrets/oauth-refresh to mint access tokens.',
    },
    companions: [
      {
        handle: 'truelayer',
        source: 'ref',
        refKey: 'truelayer',
        injection: { kind: 'bearer' },
        allowedHosts: [tl.dataHost],
        allowedMethods: ['GET', 'HEAD'],
        allowedPathPrefixes: ['/data/v1'],
        notes: 'Access token minted per request from the truelayer-oauth credential set.',
      },
    ],
  },

  paypal: {
    provider: 'paypal',
    title: 'PayPal',
    helpUrl: 'https://developer.paypal.com/dashboard/applications/live',
    assemble: 'json',
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Secret key', type: 'password', required: true },
    ],
    binding: {
      handle: pp.vaultHandle,
      source: 'vault',
      injection: { kind: 'none' },
      allowedHosts: [pp.tokenHost],
      allowedMethods: ['POST'],
      notes: 'Credential set read only by $lib/secrets/oauth-refresh to mint access tokens.',
    },
    companions: [
      {
        handle: 'paypal',
        source: 'ref',
        refKey: 'paypal',
        injection: { kind: 'bearer' },
        allowedHosts: [pp.dataHost],
        allowedMethods: ['GET', 'HEAD'],
        allowedPathPrefixes: ['/v1/reporting', '/v1/billing'],
        notes: 'Access token minted per request from the paypal-oauth credential set.',
      },
    ],
  },
};

/**
 * The shape used when the model asks for a credential this table doesn't know.
 *
 * The model supplies a label and a SUGGESTED host and handle; the modal renders
 * them as an unaccepted proposal the owner must look at, because a suggested
 * host is the one thing here a prompt-injected model could use to point a key
 * somewhere it controls. Defaults are the tightest that still work: a single
 * bearer value, GET+HEAD only.
 */
export function customSpec(input: {
  label?: string;
  suggestedHost?: string;
  suggestedHandle?: string;
  /** Owner-reviewed custom hosts submitted by the credential form. */
  allowedHosts?: string[];
}): CredentialRequestSpec {
  const handle = String(input.suggestedHandle ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);
  return {
    provider: 'custom',
    title: String(input.label ?? 'API credential').slice(0, 80),
    assemble: 'single',
    fields: [{ key: 'value', label: 'API key / token', type: 'password', required: true }],
    binding: {
      handle: handle || 'new-credential',
      source: 'vault',
      injection: { kind: 'bearer' },
      allowedHosts: input.allowedHosts ?? [String(input.suggestedHost ?? '').trim()].filter(Boolean),
      allowedMethods: ['GET', 'HEAD'],
    },
  };
}

/**
 * The `secret_request` SSE payload, as the browser receives it. Every field is
 * derived server-side from a spec above — the model contributes only the
 * provider key (validated) and `reason`. There is deliberately no field here
 * capable of carrying a credential value.
 */
export interface SecretRequestEvent {
  requestId: string;
  provider: string;
  title: string;
  reason: string;
  helpUrl?: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    help?: string;
  }>;
  destination: { handle: string; store: string; hosts: string[]; methods: string[]; storeOnly: boolean };
  companions: Array<{ handle: string; hosts: string[]; methods: string[] }>;
  assemble: 'single' | 'json';
}

/** Provider keys the tool's enum offers, plus `custom`. */
export function credentialProviderKeys(): string[] {
  return [...Object.keys(CREDENTIAL_REQUEST_SPECS), 'custom'];
}

// ---------------------------------------------------------------------------
// Updating a credential that already exists
//
// Everything above is the CREATE path: the model names a provider, the binding
// comes from the table, and a brand-new row is written. An update is a different
// question — it targets a row that already exists, so the tool that drives it
// must take a handle, which is the parameter the create path deliberately does
// not have.
//
// What keeps that safe is that a handle is not a capability. `update_credential`
// can only name a row the owner already created, it cannot change `injection`,
// `source` or `refKey` (see the narrow primitives in registry.ts), and a binding
// change that reaches a NEW host requires the owner to type that host. The model
// contributes a suggestion; the server authors the plan; the owner types the one
// thing that could move a key somewhere new.
// ---------------------------------------------------------------------------

/** The `secret_request` payload when the request is an UPDATE, as the browser
 *  receives it. Like its create sibling it has no field that can carry a value. */
export interface SecretUpdateEvent {
  requestId: string;
  kind: 'update';
  handle: string;
  title: string;
  reason: string;
  /** 'rotate' replaces the whole value, 'amend' changes some fields of a
   *  credential set, 'rebind' changes where the credential may be sent. */
  mode: 'rotate' | 'amend' | 'rebind';
  helpUrl?: string;
  /** Value modes only. On `amend` nothing is required — blank keeps the current. */
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    help?: string;
  }>;
  assemble: 'single' | 'json';
  /** What the row looks like now — the left-hand side of the diff. */
  current: {
    label: string;
    hosts: string[];
    methods: string[];
    pathPrefixes: string[];
    storeOnly: boolean;
  };
  /** Rebind only — the right-hand side. */
  proposed?: { hosts: string[]; methods: string[]; pathPrefixes: string[] };
  /** Rebind only — which way each part of the binding moved. */
  change?: BindingChange;
  /** Hostnames the owner must retype before the form will save. */
  requiresTypedHosts: string[];
}

/** Metadata this module needs about an existing row. Structurally the subset of
 *  `SecretMeta` that matters here, declared locally so nothing imports a value
 *  from the registry just to describe a row. */
export interface ExistingSecret {
  handle: string;
  label: string;
  source: 'vault' | 'ref';
  refKey?: string;
  injectionKind: string;
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPathPrefixes: string[];
}

/** The catalogue entry that owns a handle, if any. Lets an update of a known
 *  provider reuse its real field list instead of a generic "new value" box. */
export function specByHandle(handle: string): CredentialRequestSpec | null {
  const h = String(handle ?? '').toLowerCase();
  for (const spec of Object.values(CREDENTIAL_REQUEST_SPECS)) {
    if (spec.binding.handle.toLowerCase() === h) return spec;
  }
  return null;
}

/** A binding delta as the model may propose it. Adds and removes rather than an
 *  absolute list, so "add POST" cannot silently drop a host by omission. */
export interface BindingDelta {
  addHosts?: string[];
  removeHosts?: string[];
  addMethods?: string[];
  removeMethods?: string[];
  addPathPrefixes?: string[];
  removePathPrefixes?: string[];
}

function normList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter(Boolean);
}

/** Apply a delta to the current binding. Pure — no validation, that is the
 *  registry's job on write; this only has to produce the diff the owner sees. */
export function applyBindingDelta(current: SecretBinding, delta: BindingDelta): SecretBinding {
  const merge = (kept: string[], drop: string[], add: string[]) =>
    Array.from(new Set([...kept.filter((x) => !drop.includes(x)), ...add]));

  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const upper = (xs: string[]) => xs.map((x) => x.toUpperCase());
  const prefix = (xs: string[]) => xs.map((p) => (p.startsWith('/') ? p : '/' + p));

  return {
    allowedHosts: merge(
      lower(current.allowedHosts),
      lower(normList(delta.removeHosts)),
      lower(normList(delta.addHosts)),
    ),
    allowedMethods: merge(
      upper(current.allowedMethods),
      upper(normList(delta.removeMethods)),
      upper(normList(delta.addMethods)),
    ),
    allowedPathPrefixes: merge(
      current.allowedPathPrefixes,
      prefix(normList(delta.removePathPrefixes)),
      prefix(normList(delta.addPathPrefixes)),
    ),
  };
}

export interface UpdatePlan {
  event: SecretUpdateEvent;
  /** What the endpoint will actually write. Never travels via the browser. */
  write: {
    handle: string;
    mode: 'rotate' | 'amend' | 'rebind';
    allowedFieldKeys: string[];
    binding?: SecretBinding;
    requiresTypedHosts: string[];
  };
}

/**
 * Turn "jkai wants to change <handle>" into the form the owner sees and the
 * write the server will perform. Both halves are derived HERE, server-side; the
 * model supplied only the handle, a reason, and (for a rebind) a suggested
 * delta that this function turns into a reviewable diff.
 */
export function buildUpdatePlan(input: {
  requestId: string;
  existing: ExistingSecret;
  change: 'value' | 'binding';
  reason: string;
  delta?: BindingDelta;
}): UpdatePlan {
  const { requestId, existing } = input;
  const spec = specByHandle(existing.handle);
  const title = spec?.title ?? existing.label ?? existing.handle;
  const reason = String(input.reason ?? '').slice(0, 200);

  const current: SecretBinding = {
    allowedHosts: existing.allowedHosts ?? [],
    allowedMethods: existing.allowedMethods ?? [],
    allowedPathPrefixes: existing.allowedPathPrefixes ?? [],
  };
  const currentView = {
    label: existing.label,
    hosts: current.allowedHosts,
    methods: current.allowedMethods,
    pathPrefixes: current.allowedPathPrefixes,
    storeOnly: existing.injectionKind === 'none',
  };

  if (input.change === 'binding') {
    const proposed = applyBindingDelta(current, input.delta ?? {});
    const change = classifyBindingChange(current, proposed);
    return {
      event: {
        requestId,
        kind: 'update',
        handle: existing.handle,
        title,
        reason,
        mode: 'rebind',
        // A rebind moves no secret value, so the form has no inputs for one.
        fields: [],
        assemble: 'single',
        current: currentView,
        proposed: {
          hosts: proposed.allowedHosts,
          methods: proposed.allowedMethods,
          pathPrefixes: proposed.allowedPathPrefixes,
        },
        change,
        requiresTypedHosts: change.addedHosts,
      },
      write: {
        handle: existing.handle,
        mode: 'rebind',
        allowedFieldKeys: [],
        binding: proposed,
        requiresTypedHosts: change.addedHosts,
      },
    };
  }

  // Value change. A catalogued multi-field provider gets its real field list
  // with everything optional — that is what makes "only the refresh token
  // rotated" a one-box job. Anything else replaces a single value outright.
  const isFieldSet = spec?.assemble === 'json';
  const fields = isFieldSet
    ? spec!.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type as string,
        required: false,
        placeholder: f.placeholder,
        help: f.help ? `${f.help} Leave blank to keep the current value.` : 'Leave blank to keep the current value.',
      }))
    : [{ key: 'value', label: 'New value', type: 'password', required: true }];

  return {
    event: {
      requestId,
      kind: 'update',
      handle: existing.handle,
      title,
      reason,
      mode: isFieldSet ? 'amend' : 'rotate',
      helpUrl: spec?.helpUrl,
      fields,
      assemble: isFieldSet ? 'json' : 'single',
      current: currentView,
      requiresTypedHosts: [],
    },
    write: {
      handle: existing.handle,
      mode: isFieldSet ? 'amend' : 'rotate',
      allowedFieldKeys: fields.map((f) => f.key),
      requiresTypedHosts: [],
    },
  };
}
