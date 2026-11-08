/**
 * The app's own URL scheme (`sr://`, SR-AppleApp Info.plist), for a page the
 * phone is already looking at to open the installed app with something to
 * do. Universal links (`https://strangeramblings.com/app/…` opening the app
 * by themselves) need the Associated Domains capability on the App ID and
 * re-minted profiles; until then this is the hand-off, and the join page's
 * QR scanned from inside the app is the other.
 */
export function openInAppLink(joinCode: string, origin: string): string {
  return `sr://pair?join=${encodeURIComponent(joinCode)}&server=${encodeURIComponent(origin)}`;
}
