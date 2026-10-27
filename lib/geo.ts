// Pure geo math. No deps. Self-check at bottom (`npx tsx lib/geo.ts`).

export type LatLon = { lat: number; lon: number };

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** Ray casting. ring = [[lon,lat], ...] (GeoJSON order), closed or not. */
export function pointInRing(p: LatLon, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > p.lat !== yj > p.lat;
    if (straddles && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Accepts a GeoJSON Polygon geometry (outer ring only - holes are not used here). */
export function pointInPolygon(p: LatLon, poly: { coordinates: number[][][] } | null): boolean {
  if (!poly?.coordinates?.[0]) return false;
  return pointInRing(p, poly.coordinates[0]);
}

/** Distance from a point to a polygon ring: 0 if inside, else min distance to any vertex or edge midpoint. */
export function distanceToRingKm(p: LatLon, ring: number[][]): number {
  if (pointInRing(p, ring)) return 0;
  let min = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    min = Math.min(min, haversineKm(p, { lat, lon }));
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    // sample the edge so long segments don't overstate distance
    for (const t of [0.25, 0.5, 0.75]) {
      min = Math.min(min, haversineKm(p, { lat: lat + (lat2 - lat) * t, lon: lon + (lon2 - lon) * t }));
    }
  }
  return min;
}

/** Compass bearing 0-360 from a to b. */
export function bearing(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function compass(deg: number): string {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Smallest bbox containing a circle of radius km around center. [minLon,minLat,maxLon,maxLat] */
export function bboxAround(c: LatLon, km: number): [number, number, number, number] {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.max(0.01, Math.cos(rad(c.lat))));
  return [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat];
}

// ponytail: self-check instead of a test framework. `npx tsx lib/geo.ts`
if (process.argv[1]?.endsWith("geo.ts")) {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error("FAIL: " + m); };
  // Kaziranga -> Guwahati ~ 190km
  const d = haversineKm({ lat: 26.58, lon: 93.17 }, { lat: 26.14, lon: 91.73 });
  assert(d > 130 && d < 160, `kaziranga-guwahati ${d}`);
  assert(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }) === 0, "zero distance");
  const square = { coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] };
  assert(pointInPolygon({ lat: 5, lon: 5 }, square), "inside square");
  assert(!pointInPolygon({ lat: 15, lon: 5 }, square), "outside square");
  assert(!pointInPolygon({ lat: 5, lon: 5 }, null), "null polygon");
  assert(compass(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) === "N", "north bearing");
  assert(compass(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })) === "E", "east bearing");
  const [minLon, minLat, maxLon, maxLat] = bboxAround({ lat: 26.58, lon: 93.17 }, 50);
  assert(minLat < 26.58 && maxLat > 26.58 && minLon < 93.17 && maxLon > 93.17, "bbox contains center");
  const sq = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
  assert(distanceToRingKm({ lat: 5, lon: 5 }, sq) === 0, "inside ring = 0");
  const outside = distanceToRingKm({ lat: 5, lon: 11 }, sq);
  assert(outside > 50 && outside < 200, `outside ring ${outside}`);
  console.log("geo.ts ok");
}
