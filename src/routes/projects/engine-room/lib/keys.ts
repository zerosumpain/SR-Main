// keys.ts — content for Reach / "Keys it can use and cannot read".
//
// The design contract underneath this page is unusually crisp, so the page follows it
// literally: no caller ever receives a value, a credential authenticates a request only if
// the request's host is on that credential's owner-set list, and the list is narrowable by
// path and by method. The instrument is that decision, run in front of you.
//
// Hosts and handles on this page are illustrative stand-ins, as everywhere in this study.
// Counted from source on 7 August 2026.

export type Decision = 'sent' | 'refused';

export interface Check {
  id: 'kind' | 'host' | 'path' | 'method';
  label: string;
  /** What the check is for, in one line. */
  what: string;
}

/** The four gates, in the order the real one applies them. Order matters: see STORE_ONLY. */
export const CHECKS: Check[] = [
  { id: 'kind', label: 'Is it attachable at all?', what: 'A store-only credential holds a whole set of fields for one server module to read. It is refused before any of the arithmetic below, because attaching it would paste the entire set into a header.' },
  { id: 'host', label: 'Is the host on its list?', what: 'The credential authenticates requests to the hosts its owner listed, and nowhere else. A wildcard covers sub-domains only — never the apex, and never a bare star, so a credential can never be host-unbound.' },
  { id: 'path', label: 'Is the path in scope?', what: 'Optional narrowing. A key can be scoped to the read-only endpoints of a host, so a credential handed to an autonomous agent cannot be spent on that host’s expensive ones.' },
  { id: 'method', label: 'Is the method allowed?', what: 'Path scoping limits where a key goes; this limits what it can do. Unset is read-only — GET and HEAD.' },
];

export interface Credential {
  handle: string;
  label: string;
  /** How the value is attached to a request, when it is attached at all. */
  injection: string;
  hosts: string[];
  paths: string[];
  methods: string[];
  storeOnly?: boolean;
  note: string;
}

/** Illustrative credentials, shaped like the real rows. */
export const CREDENTIALS: Credential[] = [
  {
    handle: 'model-gateway', label: 'The model gateway',
    injection: 'a bearer token',
    hosts: ['api.gateway.example'], paths: ['/api/v1/credits'], methods: ['GET'],
    note: 'Scoped to one read-only endpoint so the balance can be checked by anything, and nothing else on that host can be bought with it.',
  },
  {
    handle: 'weather', label: 'A weather service',
    injection: 'a query parameter',
    hosts: ['*.weather.example'], paths: [], methods: ['GET', 'HEAD'],
    note: 'Sub-domains of one provider, read-only. The wildcard does not cover the apex — an owner who wants both lists both.',
  },
  {
    handle: 'calendar', label: 'A calendar',
    injection: 'a named header',
    hosts: ['calendar.example'], paths: [], methods: ['GET', 'POST', 'PATCH'],
    note: 'Deliberately allowed to write, because booking something is the point. The narrowing here is the host, not the verb.',
  },
  {
    handle: 'bank-oauth', label: 'A delegated-access credential set',
    injection: 'never attached',
    hosts: ['auth.bank.example'], paths: ['/connect/token'], methods: ['POST'],
    storeOnly: true,
    note: 'A client id, a client secret and a refresh token held together for one server module to exchange. Refused by every path that attaches a credential to a request.',
  },
];

/** Targets you can aim a credential at. The last two are the interesting ones. */
export const TARGETS = [
  { id: 'credits', label: 'the balance endpoint', host: 'api.gateway.example', path: '/api/v1/credits', method: 'GET' },
  { id: 'chat', label: 'the expensive endpoint', host: 'api.gateway.example', path: '/api/v1/chat/completions', method: 'POST' },
  { id: 'sub', label: 'a sub-domain', host: 'api.weather.example', path: '/v1/forecast', method: 'GET' },
  { id: 'apex', label: 'the apex domain', host: 'weather.example', path: '/v1/forecast', method: 'GET' },
  { id: 'book', label: 'creating a booking', host: 'calendar.example', path: '/v3/events', method: 'POST' },
  { id: 'elsewhere', label: 'somewhere else entirely', host: 'collector.example', path: '/ingest', method: 'POST' },
];

export const STORE_ONLY = {
  title: 'Some credentials are never attached to anything',
  body:
    'A multi-field credential set has to live somewhere encrypted, and the obvious way to store it is to claim it is a bearer token. That would mean any caller resolving it got the whole JSON set pasted into an authorisation header. So a fourth kind exists — store-only — and the resolver refuses it before it does any binding arithmetic at all.',
} as const;

export const EVERY_HOP = {
  title: 'Every redirect hop is checked again',
  body:
    'Path scoping would otherwise be a one-hop guarantee: a same-origin redirect from an in-scope path to an out-of-scope one would carry the key exactly where the owner excluded it. The binding is therefore re-evaluated on each hop, and a registry credential is never carried across a change of origin at all.',
} as const;

export const NEVER_READ = [
  { k: 'One function returns plaintext', why: 'And it returns the value already attached to the outbound request, plus a list of what to scrub back out of the response. No route, no tool and no log can ask for a value.' },
  { k: 'Metadata is the public face', why: 'Handle, label, where it may be sent, what it may do, and the last four characters for identification. Everything a person needs to manage a credential; nothing that authenticates as one.' },
  { k: 'Scrubbed on the way back', why: 'A service that echoes its own key in a response — and some do — cannot put it into a transcript, because the value is removed before anything reaches a model.' },
  { k: 'Redaction follows the injection', why: 'A key attached as a query parameter becomes part of the URL, so the scrubber runs over the composed URL and any error quoting it, not only the body.' },
];

// ---------------------------------------------------------------------------
// Asking for one that does not exist yet
// ---------------------------------------------------------------------------

export const REQUEST_FLOW = [
  { id: 'ask', actor: 'the model', what: 'Names a provider from a fixed table. That is the whole of its input.', can: true },
  { id: 'declare', actor: 'the code', what: 'Supplies the handle, the storage kind, how it is injected, and which hosts, paths and methods it will be bound to. All of it is written in the repository.', can: true },
  { id: 'show', actor: 'the modal', what: 'Shows the owner exactly what binding is about to be written, before anything is.', can: true },
  { id: 'type', actor: 'the owner', what: 'Types the value into a field the model never sees, and confirms.', can: true },
];

export const NO_PARAMETER = {
  title: 'The dangerous field does not exist',
  body:
    'The tool for requesting a credential has no handle, no host, no injection and no path parameter — it names a provider and nothing else. A policy expressed as a type signature has no run-time enforcement to get wrong, and it holds however clever the model becomes. Creating a credential and rotating one are also separate operations, because conflating them lets an accidental create overwrite a working secret.',
} as const;

/** Counted from the registry module. */
export const FACTS = {
  injections: 4,
  wildcardScope: 'sub-domains only',
  defaultMethods: 'GET and HEAD',
} as const;
