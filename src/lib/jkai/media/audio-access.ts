// Microphone permission and speaker (audio output) selection.
//
// Two separate things that both get called "audio access":
//
//   MICROPHONE is a real permission. `getUserMedia` prompts, the answer sticks,
//   and it is readable ahead of time via the Permissions API where that exists.
//   It also requires a SECURE CONTEXT — over plain http on a LAN address the
//   call rejects before any prompt appears, which looks exactly like a denial
//   and is not one.
//
//   SPEAKERS are not a permission at all. There is nothing to grant: playback
//   goes to the system default unless the page picks a device with
//   `selectAudioOutput()` and applies it per element with `setSinkId()`. Only
//   Chromium ships both; elsewhere the honest answer is "the system decides".
//
// Everything here is defensive: these APIs are absent, partially present, or
// throw in enough browsers that assuming any of them is how a page ends up with
// a dead button.

export type MicPermission =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unknown'
  | 'insecure'
  | 'blocked';

/** Where a chosen output device is remembered, per browser. */
export const SINK_STORAGE_KEY = 'jkai.notes.audioSink';

interface NavigatorLike {
  mediaDevices?: {
    getUserMedia?: unknown;
    selectAudioOutput?: unknown;
    enumerateDevices?: unknown;
  };
  permissions?: { query?: unknown };
}

interface DocumentLike {
  /** Current name. */
  permissionsPolicy?: { allowsFeature?: unknown };
  /** The name Chrome shipped first, still what some versions expose. */
  featurePolicy?: { allowsFeature?: unknown };
}

/**
 * Both names are non-standard, so lib.dom declares NEITHER on `Document`. That
 * makes `DocumentLike` a "weak type" with nothing in common with the real
 * thing, and passing `document` is a type error rather than the obvious call it
 * looks like. Accepting the union keeps the cast in one place here instead of
 * at every call site.
 */
type PolicyDocument = DocumentLike | Document;

/**
 * Does this DOCUMENT allow a microphone at all?
 *
 * A third way to have no microphone, and the meanest, because it does not look
 * like itself. A `Permissions-Policy: microphone=()` response header disables
 * the feature for every origin including this one, and the policy is checked
 * BEFORE the permission prompt — so `getUserMedia` rejects with
 * NotAllowedError, no dialog ever appears, and the browser's site setting sits
 * on "Ask" because nothing ever asked. Read as a permission it is
 * indistinguishable from the user having said no, which sends them to site
 * settings that cannot possibly fix it. Only the document knows.
 *
 * Returns null where the browser exposes neither name (Firefox, Safari):
 * "cannot tell" must never be reported as "blocked", or the browsers where the
 * feature works fine would accuse the site of blocking it.
 */
export function micPolicyAllowed(doc: PolicyDocument | undefined): boolean | null {
  const d = doc as DocumentLike | undefined;
  const policy = d?.permissionsPolicy ?? d?.featurePolicy;
  const allows = policy?.allowsFeature;
  if (typeof allows !== 'function') return null;
  try {
    return Boolean((allows as (feature: string) => boolean).call(policy, 'microphone'));
  } catch {
    return null;
  }
}

/**
 * Can this page even ask for a microphone?
 *
 * `isSecureContext` is the one that catches homeserv over `http://192.168.x.x`,
 * where `mediaDevices` is undefined entirely rather than merely unpermitted.
 */
export function canRequestMic(nav: NavigatorLike | undefined, secure: boolean): boolean {
  return Boolean(secure && nav?.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function');
}

/** Chromium-only today. Firefox and Safari have no picker to offer. */
export function canChooseOutput(nav: NavigatorLike | undefined): boolean {
  return typeof nav?.mediaDevices?.selectAudioOutput === 'function';
}

/** `setSinkId` is what actually routes an element; the picker is useless without it. */
export function canRouteOutput(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/**
 * A device label a person can read.
 *
 * Labels are empty until a permission has been granted, and the default device
 * comes back with the literal id 'default' — neither of which is worth showing
 * as-is.
 */
export function outputLabel(device: { deviceId?: string; label?: string } | null): string {
  if (!device) return 'System default';
  const label = (device.label ?? '').trim();
  if (label) return label;
  return device.deviceId && device.deviceId !== 'default' ? 'Selected output' : 'System default';
}

/**
 * Where the control to unblock a microphone actually lives.
 *
 * A page CANNOT re-open the permission prompt once it has been persistently
 * denied — there is no `permissions.request()` in any shipping browser, and
 * Chrome removed `permissions.revoke()` years ago. That is deliberate: it is
 * what stops a site asking forever. So the best a page can do is say precisely
 * where the switch is, and notice the moment it is flipped.
 *
 * UA sniffing, and only for this sentence — never for a capability. Getting the
 * wrong hint is a slightly less helpful sentence; getting a capability wrong
 * from a UA string is a broken feature.
 */
export function unblockHint(userAgent: string): string {
  const ua = userAgent || '';
  if (/Firefox\//.test(ua)) {
    return 'Click the permissions icon just left of the address bar and clear the block.';
  }
  // Order matters: Chrome's UA contains "Safari", and Edge's contains "Chrome".
  if (/Edg\//.test(ua) || /Chrome\//.test(ua) || /Chromium\//.test(ua)) {
    return 'Click the blocked-microphone icon at the right of the address bar, choose “Always allow”, then try again.';
  }
  if (/Safari\//.test(ua)) {
    return 'In the Safari menu choose Settings for This Website, then set Microphone to Allow.';
  }
  return 'Allow the microphone for this site in your browser’s address bar or site settings.';
}

/** One line saying what the state means, in the terms the page uses. */
export function micStateNote(state: MicPermission, userAgent = ''): string {
  switch (state) {
    case 'granted':
      return 'Microphone ready.';
    case 'denied':
      return `Microphone blocked. ${unblockHint(userAgent)}`;
    case 'insecure':
      return 'Microphone needs https — open this page over https or on localhost.';
    case 'blocked':
      // Deliberately does NOT mention site settings: this one is the site's own
      // fault and no amount of clicking in the browser will clear it.
      return 'Microphone disabled for this page by its Permissions-Policy header — a site fault, not a browser setting.';
    case 'prompt':
      return 'Microphone not asked for yet.';
    default:
      return 'Microphone state unknown until you record.';
  }
}

/**
 * Read the permission without prompting.
 *
 * The Permissions API does not cover `microphone` everywhere, and Safari throws
 * a TypeError for the unsupported name rather than rejecting — hence the
 * try/catch around what looks like a promise-only call.
 */
export async function readMicPermission(
  nav: NavigatorLike | undefined,
  secure: boolean,
  doc?: PolicyDocument,
): Promise<MicPermission> {
  return (await micPermissionStatus(nav, secure, doc)).state;
}

/**
 * The state, plus the live `PermissionStatus` when the browser offers one.
 *
 * The status object fires `change` the instant the user flips the switch in the
 * browser's own UI — which is the difference between "unblock it and the page
 * catches up" and "unblock it, then work out that you also have to reload".
 */
export async function micPermissionStatus(
  nav: NavigatorLike | undefined,
  secure: boolean,
  doc?: PolicyDocument,
): Promise<{ state: MicPermission; status: EventTarget | null }> {
  if (!secure || !nav?.mediaDevices) return { state: 'insecure', status: null };
  // Ahead of the permission, because the document outranks it: where the policy
  // refuses, the permission may well read 'prompt' and still never prompt.
  if (micPolicyAllowed(doc) === false) return { state: 'blocked', status: null };
  const query = nav.permissions?.query as
    | ((d: { name: string }) => Promise<{ state: string } & EventTarget>)
    | undefined;
  if (typeof query !== 'function') return { state: 'unknown', status: null };
  try {
    const status = await query.call(nav.permissions, { name: 'microphone' });
    const state =
      status.state === 'granted' || status.state === 'denied' || status.state === 'prompt'
        ? (status.state as MicPermission)
        : 'unknown';
    return { state, status: typeof status.addEventListener === 'function' ? status : null };
  } catch {
    // Safari throws a TypeError for the unsupported name rather than rejecting.
    return { state: 'unknown', status: null };
  }
}

/**
 * Turn a `getUserMedia` rejection into a sentence worth reading.
 *
 * The reason this exists: `catch { 'No microphone access.' }` is true for four
 * unrelated faults that have four different fixes — a site-set Permissions
 * Policy, a user refusal, no hardware, and a non-secure origin. Flattened, the
 * only actionable-looking reading is "check your browser settings", which is
 * wrong for three of them and actively misleading for the first.
 *
 * `err` is deliberately last in importance: a DOMException name alone cannot
 * separate a policy block from a refusal (both are NotAllowedError), so the
 * document and the origin are consulted first.
 */
export function micErrorMessage(
  err: unknown,
  nav: NavigatorLike | undefined,
  doc: PolicyDocument | undefined,
  secure: boolean,
  userAgent = '',
): string {
  if (!secure || !nav?.mediaDevices) return micStateNote('insecure');
  if (micPolicyAllowed(doc) === false) return micStateNote('blocked');
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone found on this device.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return micStateNote('denied', userAgent);
  }
  if (name === 'NotReadableError') {
    return 'The microphone is in use by another application.';
  }
  return 'Could not start the microphone. Check that one is connected and not in use elsewhere.';
}
