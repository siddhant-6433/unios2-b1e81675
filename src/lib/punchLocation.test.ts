import { describe, it, expect } from "vitest";
import {
  metresBetween, formatDistance, classifyPunch, dayIsRemote, markerLetter,
  type CampusPoint,
} from "./punchLocation";

// The real values: the one configured geofence is named "home", and the nearest
// campus is Ghaziabad 1 with a 100 m radius.
const HOME = { location_lat: 28.6583001824575, location_lng: 77.3766570197414 };
const GZB1: CampusPoint = {
  id: "gzb1", name: "Ghaziabad Campus 1 (Arthala)",
  latitude: 28.6780860384648, longitude: 77.3991545653776, geofence_radius_meters: 100,
};
const GREATER_NOIDA: CampusPoint = {
  id: "gn", name: "Greater Noida Campus",
  latitude: 28.4669, longitude: 77.508459, geofence_radius_meters: 100,
};
const CAMPUSES = [GZB1, GREATER_NOIDA];

describe("metresBetween", () => {
  it("matches the distance Postgres computes for the real punch", () => {
    // Cross-checked against the same haversine run in SQL: 3108 m.
    const d = metresBetween(HOME.location_lat, HOME.location_lng, GZB1.latitude!, GZB1.longitude!);
    expect(d).toBeGreaterThan(3050);
    expect(d).toBeLessThan(3160);
  });

  it("is zero at the same point and symmetric", () => {
    expect(metresBetween(28.5, 77.3, 28.5, 77.3)).toBe(0);
    const a = metresBetween(28.5, 77.3, 28.6, 77.4);
    const b = metresBetween(28.6, 77.4, 28.5, 77.3);
    expect(a).toBe(b);
  });
});

describe("classifyPunch", () => {
  it("calls the real home punch remote, naming the nearest campus", () => {
    const v = classifyPunch(HOME, CAMPUSES);
    expect(v.isRemote).toBe(true);
    expect(v.nearestName).toBe("Ghaziabad Campus 1 (Arthala)");
    expect(v.label).toMatch(/from Ghaziabad Campus 1/);
  });

  it("is not remote when standing on the campus", () => {
    const v = classifyPunch({ location_lat: GZB1.latitude, location_lng: GZB1.longitude }, CAMPUSES);
    expect(v.isRemote).toBe(false);
    expect(v.label).toBe("At Ghaziabad Campus 1 (Arthala)");
  });

  it("respects each campus's own radius rather than a fixed one", () => {
    const wide: CampusPoint = { ...GZB1, geofence_radius_meters: 5000 };
    expect(classifyPunch(HOME, [wide]).isRemote).toBe(false);
    expect(classifyPunch(HOME, [GZB1]).isRemote).toBe(true);
  });

  it("picks the nearest campus, not the first", () => {
    expect(classifyPunch(HOME, [GREATER_NOIDA, GZB1]).nearestName)
      .toBe("Ghaziabad Campus 1 (Arthala)");
  });

  it("says so when there is no location, rather than guessing remote", () => {
    const v = classifyPunch({ location_lat: null, location_lng: null }, CAMPUSES);
    expect(v.known).toBe(false);
    expect(v.isRemote).toBe(false);
  });

  it("does not call a punch remote when no campus has coordinates to compare", () => {
    const v = classifyPunch(HOME, [{ ...GZB1, latitude: null, longitude: null }]);
    expect(v.isRemote).toBe(false);
    expect(v.metres).toBeNull();
  });

  it("falls back to a default radius when a campus has none set", () => {
    const noRadius: CampusPoint = { ...GZB1, geofence_radius_meters: null };
    expect(classifyPunch(HOME, [noRadius]).isRemote).toBe(true);
  });
});

describe("dayIsRemote", () => {
  it("is true when any punch was away, even if others were on site", () => {
    const onSite = { location_lat: GZB1.latitude, location_lng: GZB1.longitude };
    expect(dayIsRemote([onSite, HOME], CAMPUSES)).toBe(true);
    expect(dayIsRemote([onSite, onSite], CAMPUSES)).toBe(false);
    expect(dayIsRemote([], CAMPUSES)).toBe(false);
  });
});

describe("presentation", () => {
  it("formats metres the way a person reads them", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(940)).toBe("940 m");
    expect(formatDistance(3108)).toBe("3.1 km");
    expect(formatDistance(146566)).toBe("147 km");
  });

  it("labels markers A, B, C and wraps past Z", () => {
    expect(markerLetter(0)).toBe("A");
    expect(markerLetter(2)).toBe("C");
    expect(markerLetter(26)).toBe("A");
  });
});
