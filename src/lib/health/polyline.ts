/**
 * Decode a Google encoded polyline string into an array of [lat, lng] coordinates.
 * Based on the algorithm at https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

function encodeSigned(value: number, out: string[]): void {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

/**
 * Encode [lat, lng] pairs into a Google encoded polyline — the inverse of
 * decodePolyline above.
 *
 * Used to store a compact rendering of an activity track so the /health/activities list
 * can draw route shapes without loading every full coordinate array. The 1e5
 * rounding costs about a metre of precision, which is invisible at list scale
 * and never used for measurement — distances come from the stored track.
 */
export function encodePolyline(points: [number, number][]): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of points) {
    const roundedLat = Math.round(lat * 1e5);
    const roundedLng = Math.round(lng * 1e5);
    encodeSigned(roundedLat - prevLat, out);
    encodeSigned(roundedLng - prevLng, out);
    prevLat = roundedLat;
    prevLng = roundedLng;
  }

  return out.join('');
}
