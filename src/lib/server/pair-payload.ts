/**
 * What the pairing QR says. One file owns the shape so /welcome and
 * /admin/access/devices cannot drift, and the app parses exactly this
 * (SR-AppleApp `PairingPayload`). `sr-pair` replaced the two codes a phone
 * used to need — `sr-companion-pair` for health & location and
 * `sr-native-pair` for the site — on 2026-10-19.
 */
export const PAIR_PAYLOAD_TYPE = 'sr-pair';

export function scanPairPayload(server: string, code: string): string {
  return JSON.stringify({ type: PAIR_PAYLOAD_TYPE, version: 1, server, code });
}

/**
 * The code /welcome shows a visitor who is NOT signed in: no secret, nobody's
 * code. Scanned, it has the app sign in with the phone's own Apple ID (or
 * Google); someone the owner has pre-registered in the household is then let
 * straight in, anyone else asks and waits (`$lib/server/registration`).
 */
export function openPairPayload(server: string): string {
  return JSON.stringify({ type: PAIR_PAYLOAD_TYPE, version: 1, server });
}
