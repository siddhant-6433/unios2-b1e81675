// Was this punch taken at a campus, or somewhere else?
//
// Nothing in the schema says "remote" — geofence_locations has no campus link, and
// the one configured geofence is literally named "home". So it is derived: a punch
// is remote when it falls outside the geofence of every campus. The real data bears
// this out — those 34 punches sit 3.1 km from the nearest campus, well beyond its
// 100 m radius.
//
// Deriving it beats adding an is_remote column that somebody would have to remember
// to set, and it stays correct when a campus moves or a radius is retuned.

export interface CampusPoint {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number | null;
}

export interface PunchPoint {
  location_lat?: number | null;
  location_lng?: number | null;
}

export interface LocationVerdict {
  known: boolean;
  /** Nearest campus, whether or not the punch was inside it. */
  nearestName: string | null;
  metres: number | null;
  isRemote: boolean;
  label: string;
}

const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. Accurate enough at campus scale. */
export function metresBetween(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Metres rendered the way a person reads them. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

const DEFAULT_RADIUS_M = 100;

export function classifyPunch(punch: PunchPoint, campuses: CampusPoint[]): LocationVerdict {
  const lat = punch.location_lat;
  const lng = punch.location_lng;
  if (lat == null || lng == null) {
    return { known: false, nearestName: null, metres: null, isRemote: false, label: "No location captured" };
  }

  let nearest: { campus: CampusPoint; metres: number } | null = null;
  for (const c of campuses) {
    if (c.latitude == null || c.longitude == null) continue;
    const metres = metresBetween(lat, lng, c.latitude, c.longitude);
    if (!nearest || metres < nearest.metres) nearest = { campus: c, metres };
  }

  if (!nearest) {
    // No campus has coordinates, so nothing can be judged against. Say so rather
    // than calling everything remote.
    return { known: true, nearestName: null, metres: null, isRemote: false, label: "No campus coordinates to compare against" };
  }

  const radius = nearest.campus.geofence_radius_meters ?? DEFAULT_RADIUS_M;
  const isRemote = nearest.metres > radius;

  return {
    known: true,
    nearestName: nearest.campus.name,
    metres: nearest.metres,
    isRemote,
    label: isRemote
      ? `${formatDistance(nearest.metres)} from ${nearest.campus.name}`
      : `At ${nearest.campus.name}`,
  };
}

/** A day is a remote day when any of its punches was taken away from a campus. */
export function dayIsRemote(punches: PunchPoint[], campuses: CampusPoint[]): boolean {
  return punches.some((p) => classifyPunch(p, campuses).isRemote);
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** A, B, C … the marker letters Keka puts beside each punch. */
export function markerLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
