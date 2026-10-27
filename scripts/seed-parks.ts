import { sql } from "../lib/db";
import parksData from "../data/parks.json";

// Idempotent upsert of parks + featured polygons/zones/sensors. `npm run s scripts/seed-parks.ts`

type ParkIn = { id: string; name: string; country: string; lat: number; lon: number; radius_km: number; featured?: boolean };
type Zone = { id: string; name: string; polygon: number[][] };
type SensorIn = { id: string; kind: string; name: string; lat: number; lon: number };

const ring = (r: number[][]) => ({ type: "Polygon", coordinates: [r] });

async function main() {
  const parks = parksData.parks as ParkIn[];
  const detail = parksData.featured_detail as Record<string, { polygon: number[][]; zones: Zone[]; sensors: SensorIn[] }>;

  for (const p of parks) {
    const d = detail[p.id];
    const zones = d ? { type: "FeatureCollection", features: d.zones.map((z) => ({ type: "Feature", properties: { id: z.id, name: z.name }, geometry: ring(z.polygon) })) } : null;
    await sql`
      INSERT INTO parks (id, name, country, center_lat, center_lon, radius_km, polygon_geojson, zones_geojson, featured)
      VALUES (${p.id}, ${p.name}, ${p.country}, ${p.lat}, ${p.lon}, ${p.radius_km},
              ${d ? JSON.stringify(ring(d.polygon)) : null}, ${zones ? JSON.stringify(zones) : null}, ${!!p.featured})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, country = EXCLUDED.country,
        center_lat = EXCLUDED.center_lat, center_lon = EXCLUDED.center_lon, radius_km = EXCLUDED.radius_km,
        polygon_geojson = EXCLUDED.polygon_geojson, zones_geojson = EXCLUDED.zones_geojson, featured = EXCLUDED.featured`;
  }

  let sensorCount = 0;
  for (const [parkId, d] of Object.entries(detail)) {
    for (const s of d.sensors) {
      await sql`
        INSERT INTO sensors (id, park_id, kind, name, lat, lon)
        VALUES (${s.id}, ${parkId}, ${s.kind}, ${s.name}, ${s.lat}, ${s.lon})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon`;
      sensorCount++;
    }
  }

  const [{ count }] = (await sql`SELECT count(*)::int AS count FROM parks`) as { count: number }[];
  const [{ f }] = (await sql`SELECT count(*)::int AS f FROM parks WHERE featured`) as { f: number }[];
  console.log(`parks: ${count} (${f} featured), sensors: ${sensorCount}`);
}

main();
