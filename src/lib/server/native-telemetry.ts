// What a phone says about itself, read from two request headers the app sends
// on every call (SR-AppleApp `Access/PhoneIdentity.swift`):
//
//   X-SR-App:     <version>/<build>/<commit>     0.1.136/136/68136470
//   X-SR-Device:  <model>/<os>[/<name>]          iPhone15,2/26.0.1/Rory%27s%20iPhone
//
// Headers rather than body fields because the companion pilot checks every
// JSON body with `exactKeys` — a new field 400s an upload from an old server,
// while a header an old server never reads costs nothing — and because one
// grammar then serves both lanes. The pilot parses the same grammar in
// `server/telemetry.mjs`; change both or neither.
//
// Everything is optional and everything is bounded: this is a label the
// device list prints, written by whoever holds a device token, so a value
// that does not fit its shape is dropped rather than stored.

export interface PhoneTelemetry {
  appVersion: string | null;
  appBuild: number | null;
  appCommit: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  deviceName: string | null;
}

const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9,._-]{0,39}$/;
const NAME_MAX = 60;

function field(value: string | undefined, pattern: RegExp): string | null {
  return value !== undefined && pattern.test(value) ? value : null;
}

function decodedName(raw: string): string | null {
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name && name.length <= NAME_MAX ? name : null;
}

/**
 * The phone's telemetry from a request's headers, or null when it sent none —
 * an app build from before these headers existed.
 */
export function phoneTelemetry(headers: Headers): PhoneTelemetry | null {
  const app = (headers.get('x-sr-app') ?? '').split('/');
  const device = (headers.get('x-sr-device') ?? '').split('/');
  const build = Number.parseInt(app[1] ?? '', 10);
  const out: PhoneTelemetry = {
    appVersion: field(app[0], VERSION),
    appBuild: /^[0-9]+$/.test(app[1] ?? '') && build > 0 && build < 2 ** 31 ? build : null,
    appCommit: field(app[2], COMMIT),
    deviceModel: field(device[0], MODEL),
    osVersion: field(device[1], VERSION),
    deviceName: decodedName(device.slice(2).join('/')),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}
