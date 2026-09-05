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

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown' | 'insecure';

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

/** One line saying what the state means, in the terms the page uses. */
export function micStateNote(state: MicPermission): string {
  switch (state) {
    case 'granted':
      return 'Microphone ready.';
    case 'denied':
      return 'Microphone blocked — allow it in the browser’s site settings.';
    case 'insecure':
      return 'Microphone needs https — open this page over https or on localhost.';
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
): Promise<MicPermission> {
  if (!secure) return 'insecure';
  if (!nav?.mediaDevices) return 'insecure';
  const query = nav.permissions?.query as
    | ((d: { name: string }) => Promise<{ state: string }>)
    | undefined;
  if (typeof query !== 'function') return 'unknown';
  try {
    const status = await query.call(nav.permissions, { name: 'microphone' });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
