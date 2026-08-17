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
  /**
   * Take the allowed host from the value the owner types into this field,
   * instead of from `allowedHosts` above.
   *
   * Some credentials name their own endpoint: a Kafka feed's broker is issued
   * per subscription, so no code table can know it in advance. Deriving the
   * binding from what the owner typed keeps the "bound to at least one host"
   * invariant real rather than decorative — and the host still comes from the
   * owner's keyboard, never from a model suggestion.
   */
  hostFromField?: string;
  /**
   * Render the host as an editable box in the form, pre-filled with whatever was
   * proposed. Used by the `custom` path, where the hostname is a model
   * SUGGESTION and the owner is the one who decides it is really the vendor's.
   */
  hostEditable?: boolean;
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

  openrouteservice: {
    provider: 'openrouteservice',
    title: 'openrouteservice (route planning)',
    helpUrl: 'https://openrouteservice.org/dev/#/signup',
    assemble: 'single',
    fields: [
      {
        key: 'value',
        label: 'API key',
        type: 'password',
        required: true,
        placeholder: 'paste the token from your ORS dashboard',
        help: 'Sign up free at openrouteservice.org/dev, then copy the token listed under "Tokens". The free plan allows 2,500 route requests a day.',
      },
    ],
    binding: {
      handle: 'openrouteservice',
      source: 'vault',
      // ORS wants the raw key in Authorization — NOT "Bearer <key>" — so this
      // is a header injection rather than the usual bearer.
      injection: { kind: 'header', name: 'Authorization' },
      allowedHosts: ['api.openrouteservice.org'],
      // POST is required, not optional: the directions endpoint is a POST, and
      // the default GET+HEAD binding would reject every route request with a
      // permissions error that reads nothing like "wrong method".
      allowedMethods: ['POST', 'GET', 'HEAD'],
      allowedPathPrefixes: ['/v2/'],
      notes: 'Route planning for /trails — used by the planner page and the route_plan tool.',
    },
  },

  // National Rail Darwin, via the Rail Data Marketplace (raildata.org.uk). The
  // old self-service portal at realtime.nationalrail.co.uk was retired in early
  // 2026; everything is now issued as an RDM product subscription.
  //
  // Two products, two completely different credentials — which is the reason
  // this catalogue needs field sets at all. Asking "what is your API key?" is
  // right for one of them and meaningless for the other.
  'darwin-ldbws': {
    provider: 'darwin-ldbws',
    title: 'National Rail Darwin — Live Departure Boards (LDBWS)',
    helpUrl: 'https://raildata.org.uk/',
    // An RDM subscription issues a Consumer key AND a Consumer secret, side by
    // side on the same tab. Only the key goes on the wire for an ordinary LDBWS
    // call (`x-apikey`), but asking for one and not the other means the owner
    // has to come back and re-enter the pair the moment anything needs the
    // secret — so both are captured and the field selector decides which one
    // travels.
    assemble: 'json',
    fields: [
      {
        key: 'consumer_key',
        label: 'Consumer key',
        type: 'password',
        required: true,
        help: 'Rail Data Marketplace → My Subscriptions → your LDBWS product → Specification / API tab.',
      },
      {
        key: 'consumer_secret',
        label: 'Consumer secret',
        type: 'password',
        required: true,
        help: 'Shown next to the key on the same tab. Stored encrypted; only the key is sent with a request.',
      },
    ],
    binding: {
      handle: 'darwin-ldbws',
      source: 'vault',
      injection: { kind: 'header', name: 'x-apikey', field: 'consumer_key' },
      // Every RDM product is served from this gateway; the per-product prefix
      // (e.g. /1010-live-departure-board-dep/…) differs per subscription, so
      // path scoping is left to the owner rather than guessed here.
      allowedHosts: ['api1.raildata.org.uk'],
      allowedMethods: ['GET', 'HEAD'],
      notes:
        'RDM credential set. The consumer key is sent as the x-apikey header; the secret is held for a product that needs it. Read-only.',
    },
  },

  'darwin-pubsub': {
    provider: 'darwin-pubsub',
    title: 'National Rail Darwin — Real Time Train Information (pub/sub)',
    helpUrl: 'https://raildata.org.uk/',
    assemble: 'json',
    fields: [
      {
        key: 'bootstrap_servers',
        label: 'Kafka bootstrap server',
        type: 'text',
        required: true,
        placeholder: 'pkc-xxxxx.europe-west2.gcp.confluent.cloud:9092',
        help: 'Copy exactly as shown in the RDM data product. The credential is bound to this host.',
      },
      { key: 'consumer_key', label: 'Consumer username', type: 'text', required: true },
      { key: 'consumer_secret', label: 'Consumer password', type: 'password', required: true },
      {
        key: 'group_id',
        label: 'Consumer group',
        type: 'text',
        required: true,
        help: 'The consumer group shown in RDM, or your own unique identifier for this client.',
      },
      { key: 'topic', label: 'Topic', type: 'text', required: true },
    ],
    binding: {
      handle: 'darwin-pubsub',
      source: 'vault',
      // A Kafka feed is not an HTTP request, so nothing may ever attach these to
      // one. Store-only keeps the whole set out of `resolveSecretForUrl`.
      injection: { kind: 'none' },
      allowedHosts: [],
      hostFromField: 'bootstrap_servers',
      allowedMethods: [],
      notes:
        'Kafka SASL_SSL/PLAIN credential set for the Darwin pub/sub feed. Store-only: read by a consumer, never attached to an HTTP request.',
    },
  },
};

/** Raised when a model's custom proposal does not describe a workable credential.
 *  Surfaced to the model as a tool error so it can correct the call. */
export class CredentialSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialSpecError';
  }
}

/** How the model may propose a credential this table doesn't know about. */
export interface CustomCredentialProposal {
  label?: string;
  suggestedHost?: string;
  suggestedHandle?: string;
  /** What the service actually asks for. One entry per box the owner will fill. */
  fields?: Array<{ key?: unknown; label?: unknown; secret?: unknown; optional?: unknown; help?: unknown }>;
  /** How the credential authenticates a request, if it does at all. */
  auth?: {
    style?: unknown;
    /** header / query only — the header name or query parameter name. */
    name?: unknown;
    /** Multi-field only — which field carries the value that goes on the wire. */
    field?: unknown;
    /** basic only — which fields hold the username and password. */
    usernameField?: unknown;
    passwordField?: unknown;
  };
}

const MAX_CUSTOM_FIELDS = 8;

/**
 * Which catalogued provider, if any, a `custom` proposal is really describing.
 *
 * Two ways to claim it, both deliberately narrow:
 *
 *  * every word of the provider key appears in the proposal's own text, so
 *    `darwin-ldbws` claims "National Rail Darwin LDBWS — consumer user and
 *    password" but not a proposal that merely says "darwin";
 *  * the suggested host is one the catalogued entry is already bound to.
 *
 * Returns the provider key, or null when nothing in the catalogue covers it.
 */
export function catalogueClaims(input: CustomCredentialProposal): string | null {
  const text = [input.label, input.suggestedHandle, input.suggestedHost]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  const host = hostFromEndpoint(input.suggestedHost);

  for (const [key, spec] of Object.entries(CREDENTIAL_REQUEST_SPECS)) {
    if (host && spec.binding.allowedHosts.some((h) => h.toLowerCase() === host)) return key;
    const words = key.split(/[-_]/).filter((w) => w.length > 2);
    if (words.length > 0 && words.every((w) => text.includes(w))) return key;
  }
  return null;
}

/** Field keys address JSON the owner typed, so they are narrow by construction. */
function sanitiseFieldKey(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

/** Only the shape is trusted here — never the wording. Labels are rendered as
 *  text in the form and nowhere else. */
function sanitiseCustomFields(raw: CustomCredentialProposal['fields']): CredentialField[] {
  if (!Array.isArray(raw)) return [];
  const out: CredentialField[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const key = sanitiseFieldKey((f as { key?: unknown }).key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label = String((f as { label?: unknown }).label ?? '').trim().slice(0, 48) || key;
    const help = String((f as { help?: unknown }).help ?? '').trim().slice(0, 160);
    out.push({
      key,
      label,
      type: (f as { secret?: unknown }).secret === false ? 'text' : 'password',
      required: (f as { optional?: unknown }).optional !== true,
      help: help || undefined,
    });
    if (out.length === MAX_CUSTOM_FIELDS) break;
  }
  return out;
}

/**
 * The shape used when the model asks for a credential this table doesn't know.
 *
 * The model supplies a label, a SUGGESTED host and handle, the list of values
 * the service actually asks for, and how they authenticate. All of it is a
 * proposal: the modal renders the fields as boxes and the host as an EDITABLE
 * box, because a suggested host is the one thing here a prompt-injected model
 * could use to point a key somewhere it controls, and the owner is the one who
 * decides whether it is really the vendor's.
 *
 * Defaults stay the tightest that still work: a single bearer value, GET+HEAD
 * only, and store-only for a multi-field set whose auth style is not stated —
 * a set that cannot be authenticated is stored rather than guessed at.
 */
export function customSpec(input: CustomCredentialProposal): CredentialRequestSpec {
  // A catalogued provider claims its own territory. Told to prefer the enum, the
  // model went `custom` anyway and proposed National Rail Darwin against
  // `realtime.nationalrail.co.uk` — the portal retired in early 2026 — while
  // `darwin-ldbws` sat in the enum with the right fields, the right host and the
  // right injection (2026-08-16, twice, then again after the description was
  // strengthened). Guidance in a description is advice; this is the rule.
  const claimed = catalogueClaims(input);
  if (claimed) {
    throw new CredentialSpecError(
      `"${claimed}" is already catalogued and covers this service — call request_credential again with ` +
        `provider="${claimed}" instead of "custom". It already knows the fields the vendor issues, the current ` +
        `API hostname and how the credential is sent, none of which you have to guess.`,
    );
  }

  const handle = String(input.suggestedHandle ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48);

  const fields = sanitiseCustomFields(input.fields);
  if (fields.length === 0) {
    // There used to be a fallback here: one box labelled "API key / token".
    // That fallback IS the original bug — a service issuing a key and a secret,
    // or a group plus a login, was asked for "an API key", and the owner had no
    // way to give the rest. Saying so is better than guessing: the model can
    // always propose a single field when a single key really is all there is,
    // and it has to have looked at the service to know that.
    throw new CredentialSpecError(
      'a custom credential must say what the service actually issues — set custom.fields to one entry per ' +
        'value the owner will be asked for, e.g. [{"key":"api_key","label":"API key"}] for a single-key API, ' +
        'or one entry each for a client id, secret, group, username and so on. Check the service\'s ' +
        'documentation first; asking for "an API key" when it issues three values stores something unusable.',
    );
  }
  const isSet = fields.length > 1;
  const keys = new Set(fields.map((f) => f.key));

  const style = String(input.auth?.style ?? '').trim().toLowerCase();
  const name = String(input.auth?.name ?? '').trim();
  const field = sanitiseFieldKey(input.auth?.field);

  /** The field that goes on the wire, for the single-value injection styles. */
  const wireField = (): string | undefined => {
    if (!isSet) return undefined;
    if (!field) {
      throw new CredentialSpecError(
        `auth.style "${style}" sends one value, but you proposed ${fields.length} fields — ` +
          `set auth.field to whichever of ${[...keys].join(', ')} is the one sent to the API.`,
      );
    }
    if (!keys.has(field)) {
      throw new CredentialSpecError(`auth.field "${field}" is not one of the fields you proposed (${[...keys].join(', ')}).`);
    }
    return field;
  };

  let injection: SecretInjection;
  switch (style) {
    case '':
      // Unstated. One value is a bearer token by convention; a set is stored
      // until someone says how it authenticates.
      injection = isSet ? { kind: 'none' } : { kind: 'bearer' };
      break;
    case 'bearer':
      if (isSet) {
        throw new CredentialSpecError(
          'auth.style "bearer" sends the whole stored value, which cannot be a multi-field set. ' +
            'Use "header" or "query" with auth.field, or "basic", or omit auth to store the set only.',
        );
      }
      injection = { kind: 'bearer' };
      break;
    case 'header':
    case 'query':
      if (!name) throw new CredentialSpecError(`auth.style "${style}" needs auth.name (the ${style} name to send it as).`);
      injection = style === 'header' ? { kind: 'header', name, field: wireField() } : { kind: 'query', name, field: wireField() };
      break;
    case 'basic': {
      const usernameField = sanitiseFieldKey(input.auth?.usernameField) || 'username';
      const passwordField = sanitiseFieldKey(input.auth?.passwordField) || 'password';
      if (!isSet || !keys.has(usernameField) || !keys.has(passwordField)) {
        throw new CredentialSpecError(
          `auth.style "basic" needs a username and a password field. Propose fields including ` +
            `"${usernameField}" and "${passwordField}", or name the right ones in auth.usernameField / auth.passwordField.`,
        );
      }
      injection = { kind: 'basic', usernameField, passwordField };
      break;
    }
    case 'none':
    case 'store':
      injection = { kind: 'none' };
      break;
    default:
      throw new CredentialSpecError(
        `unknown auth.style "${style}" — use bearer, header, query, basic, or none (store the value without sending it).`,
      );
  }

  return {
    provider: 'custom',
    title: String(input.label ?? 'API credential').slice(0, 80),
    assemble: isSet ? 'json' : 'single',
    fields,
    binding: {
      handle: handle || 'new-credential',
      source: 'vault',
      injection,
      allowedHosts: [String(input.suggestedHost ?? '').trim().toLowerCase()].filter(Boolean),
      allowedMethods: ['GET', 'HEAD'],
      // The owner confirms or corrects the host in the form. This is also what
      // makes the path work at all: before it, the modal posted no host back and
      // every custom credential failed to save with "a secret must be bound to
      // at least one allowed host".
      hostEditable: true,
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
  destination: {
    handle: string;
    store: string;
    hosts: string[];
    methods: string[];
    storeOnly: boolean;
    /** Plain-words description of how it will be sent, e.g. `header x-apikey`. */
    injection: string;
    /** Render the host as an editable box, pre-filled with `hosts[0]`. */
    hostEditable?: boolean;
    /** The host is taken from this field's value rather than shown separately. */
    hostField?: string;
  };
  companions: Array<{ handle: string; hosts: string[]; methods: string[] }>;
  assemble: 'single' | 'json';
}

/** How a credential will be sent, in the owner's words rather than a type name. */
export function describeInjection(injection: SecretInjection): string {
  switch (injection.kind) {
    case 'bearer':
      return 'Authorization: Bearer';
    case 'header':
      return injection.field ? `header ${injection.name} (the ${injection.field} field)` : `header ${injection.name}`;
    case 'query':
      return injection.field ? `?${injection.name}= (the ${injection.field} field)` : `?${injection.name}=`;
    case 'basic':
      return `HTTP Basic (${injection.usernameField ?? 'username'} / ${injection.passwordField ?? 'password'})`;
    case 'none':
      return 'stored only — never attached to a request';
  }
}

// ---------------------------------------------------------------------------
// Creating a credential
//
// The create path used to work differently from the update path: the browser
// posted `{provider, value}` and the endpoint rebuilt the spec from fields the
// modal never sent, so a `custom` credential arrived with no host at all and
// `upsertSecret` refused it — every custom credential request failed to save.
//
// It now works the same way an update does. The plan below is authored HERE,
// parked under the request id before the form is shown (see pending-creates.ts),
// and the browser posts only the values the owner typed. The binding cannot be
// influenced by what comes back over the wire, and the one thing the owner
// genuinely decides — the hostname, on the `custom` path where it started life
// as a model suggestion — is theirs to type.
// ---------------------------------------------------------------------------

/** What the endpoint will actually write. Never travels via the browser. */
export interface CreateWrite {
  handle: string;
  label: string;
  source: 'vault' | 'ref';
  refKey?: string;
  injection: SecretInjection;
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  notes?: string;
  assemble: 'single' | 'json';
  /** Field keys the modal may send. Anything else is dropped. */
  fieldKeys: string[];
  /** Of those, the ones that must arrive non-empty. */
  requiredFieldKeys: string[];
  /** Derive the allowed host from this field's typed value. */
  hostFromField?: string;
  /** Accept an owner-typed host from the form. */
  hostEditable: boolean;
  companions: CredentialBinding[];
}

export interface CreatePlan {
  event: SecretRequestEvent;
  write: CreateWrite;
}

export function buildCreatePlan(input: {
  requestId: string;
  spec: CredentialRequestSpec;
  reason: string;
}): CreatePlan {
  const { requestId, spec } = input;
  const b = spec.binding;

  return {
    event: {
      requestId,
      provider: spec.provider,
      title: spec.title,
      // Quoted verbatim to the owner as the model's stated purpose. The modal
      // renders it as quoted text, never as instruction.
      reason: String(input.reason ?? '').slice(0, 200),
      helpUrl: spec.helpUrl,
      fields: spec.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        placeholder: f.placeholder,
        help: f.help,
      })),
      destination: {
        handle: b.handle,
        store: 'api_secrets',
        hosts: b.allowedHosts,
        methods: b.allowedMethods,
        storeOnly: b.injection.kind === 'none',
        injection: describeInjection(b.injection),
        hostEditable: b.hostEditable === true,
        hostField: b.hostFromField,
      },
      companions: (spec.companions ?? []).map((c) => ({
        handle: c.handle,
        hosts: c.allowedHosts,
        methods: c.allowedMethods,
      })),
      assemble: spec.assemble,
    },
    write: {
      handle: b.handle,
      label: spec.title,
      source: b.source,
      refKey: b.refKey,
      injection: b.injection,
      allowedHosts: b.allowedHosts,
      allowedMethods: b.allowedMethods,
      allowedPathPrefixes: b.allowedPathPrefixes ?? [],
      notes: b.notes,
      assemble: spec.assemble,
      fieldKeys: spec.fields.map((f) => f.key),
      requiredFieldKeys: spec.fields.filter((f) => f.required).map((f) => f.key),
      hostFromField: b.hostFromField,
      hostEditable: b.hostEditable === true,
      companions: spec.companions ?? [],
    },
  };
}

/**
 * The hostname inside something the owner typed as an endpoint — `host:9092`,
 * `https://host/path`, or a bare hostname. Returns '' when there is nothing
 * host-shaped in it, and the caller reports that rather than writing a row with
 * no binding.
 */
export function hostFromEndpoint(raw: unknown): string {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z0-9+._-]*:\/\//, ''); // scheme — including Kafka's SASL_SSL://
  s = s.split(',')[0].trim(); // a bootstrap list is host:port,host:port
  s = s.split('/')[0]; // path
  s = s.split('@').pop() ?? s; // userinfo
  s = s.split(':')[0]; // port
  return s.replace(/\.+$/, '');
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
