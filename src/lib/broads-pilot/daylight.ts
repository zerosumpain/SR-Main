// Sunrise / sunset / daylight via the NOAA solar-position algorithm.
// All times are UTC. Dependency-free. Reference: NOAA Solar Calculator
// (gml.noaa.gov/grad/solcalc) — the standard low-precision equations.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Julian Day for 00:00 UTC of the given calendar date. */
function julianDay(date: Date): number {
  let y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    d +
    b -
    1524.5
  );
}

interface SolarGeom {
  declRad: number; // solar declination (rad)
  eqTime: number; // equation of time (minutes)
}

/** Solar declination and equation of time for a Julian century t. */
function solarGeometry(t: number): SolarGeom {
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mRad = rad(m);
  const sinM = Math.sin(mRad);
  const sin2M = Math.sin(2 * mRad);
  const sin3M = Math.sin(3 * mRad);
  const c =
    sinM * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin2M * (0.019993 - 0.000101 * t) +
    sin3M * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));

  // mean obliquity of the ecliptic, with nutation correction
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const epsilon = e0 + 0.00256 * Math.cos(rad(omega));

  const declRad = Math.asin(Math.sin(rad(epsilon)) * Math.sin(rad(lambda)));

  // equation of time (minutes)
  const y = Math.tan(rad(epsilon / 2)) ** 2;
  const l0Rad = rad(l0);
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * l0Rad) -
        2 * e * sinM +
        4 * e * y * sinM * Math.cos(2 * l0Rad) -
        0.5 * y * y * Math.sin(4 * l0Rad) -
        1.25 * e * e * sin2M,
    );

  return { declRad, eqTime };
}

/** Hour angle (degrees) of sunrise for the given latitude and declination,
 * using the standard −0.833° solar zenith correction (refraction + radius). */
function hourAngleSunrise(latRad: number, declRad: number): number {
  const zenith = rad(90.833);
  const cosH =
    (Math.cos(zenith) - Math.sin(latRad) * Math.sin(declRad)) /
    (Math.cos(latRad) * Math.cos(declRad));
  // clamp: polar day/night
  const clamped = Math.max(-1, Math.min(1, cosH));
  return deg(Math.acos(clamped));
}

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  daylightHours: number;
}

/** Sunrise, sunset (UTC) and daylight length (hours) for a date and location. */
export function sunTimes(date: Date, lat: number, lng: number): SunTimes {
  const jd = julianDay(date);
  const t = (jd - 2451545.0) / 36525.0; // Julian centuries since J2000
  const { declRad, eqTime } = solarGeometry(t);
  const latRad = rad(lat);

  const ha = hourAngleSunrise(latRad, declRad); // degrees

  // Solar-noon (UTC minutes): 720 − 4·lng − eqTime
  const noonMin = 720 - 4 * lng - eqTime;
  const sunriseMin = noonMin - 4 * ha;
  const sunsetMin = noonMin + 4 * ha;

  const base = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const sunrise = new Date(base + sunriseMin * 60_000);
  const sunset = new Date(base + sunsetMin * 60_000);
  const daylightHours = (sunsetMin - sunriseMin) / 60;

  return { sunrise, sunset, daylightHours };
}

/** Daylight length in hours for a date and location. */
export function daylightHours(date: Date, lat: number, lng: number): number {
  return sunTimes(date, lat, lng).daylightHours;
}
