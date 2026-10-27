import { sql, type Park } from "./db";
import { haversineKm, pointInPolygon } from "./geo";

// NASA FIRMS active-fire ingest.
// area: "world" or "minLon,minLat,maxLon,maxLat". source: VIIRS_SNPP_NRT (last ~2 months) | VIIRS_SNPP_SP (archive).
// date: optional YYYY-MM-DD start for archive pulls.

export type FirmsRow = {
  lat: number; lon: number; frp: number; acq_date: string; acq_time: string;
  satellite: string; confidence: string; daynight: string;
};

const BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

export async function fetchFires(opts: {
  area?: string; days?: number; date?: string; source?: string;
} = {}): Promise<FirmsRow[]> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) throw new Error("FIRMS_MAP_KEY missing");
  const { area = "world", days = 1, date, source = "VIIRS_SNPP_NRT" } = opts;
  const url = `${BASE}/${key}/${source}/${area}/${days}${date ? `/${date}` : ""}`;

  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`FIRMS ${res.status}: ${text.slice(0, 200)}`);
  if (text.startsWith("Invalid") || text.includes("Error")) throw new Error(`FIRMS: ${text.slice(0, 200)}`);

  const lines = text.trim().split("\n");
  const header = lines[0].split(",");
  const idx = (n: string) => header.indexOf(n);
  const [iLat, iLon, iDate, iTime, iSat, iConf, iFrp, iDn] = [
    idx("latitude"), idx("longitude"), idx("acq_date"), idx("acq_time"),
    idx("satellite"), idx("confidence"), idx("frp"), idx("daynight"),
  ];

  return lines.slice(1).flatMap((line) => {
    const c = line.split(",");
    const lat = parseFloat(c[iLat]), lon = parseFloat(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [{
      lat, lon,
      frp: parseFloat(c[iFrp]) || 0,
      acq_date: c[iDate],
      acq_time: String(c[iTime]).padStart(4, "0"), // FIRMS gives "5" for 00:05
      satellite: c[iSat] || "N",
      confidence: c[iConf] || "",
      daynight: c[iDn] || "",
    }];
  });
}

/** Tag a fire with the park containing it. Circle test for all; polygon test for featured. */
export function matchPark(f: { lat: number; lon: number }, parks: Park[]): string | null {
  let best: { id: string; d: number } | null = null;
  for (const p of parks) {
    // cheap reject before haversine
    if (Math.abs(p.center_lat - f.lat) > p.radius_km / 100) continue;
    const d = haversineKm({ lat: f.lat, lon: f.lon }, { lat: p.center_lat, lon: p.center_lon });
    if (d > p.radius_km) continue;
    if (p.polygon_geojson && !pointInPolygon({ lat: f.lat, lon: f.lon }, p.polygon_geojson as { coordinates: number[][][] })) continue;
    if (!best || d < best.d) best = { id: p.id, d };
  }
  return best?.id ?? null;
}

/** Insert fires in chunks, skipping duplicates. Returns {seen, inserted, inParks}. */
export async function ingestFires(rows: FirmsRow[], source = "VIIRS_SNPP_NRT") {
  const parks = (await sql`SELECT * FROM parks`) as Park[];
  const tagged = rows.map((r) => ({ ...r, park_id: matchPark(r, parks) }));
  const inParks = tagged.filter((t) => t.park_id).length;

  let inserted = 0;
  const CHUNK = 400;
  for (let i = 0; i < tagged.length; i += CHUNK) {
    const chunk = tagged.slice(i, i + CHUNK);
    const res = await sql.query(
      `INSERT INTO fires (park_id, lat, lon, frp, acq_date, acq_time, satellite, daynight, confidence, source)
       SELECT * FROM unnest(
         $1::text[], $2::float8[], $3::float8[], $4::float8[], $5::date[],
         $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
       ON CONFLICT (lat, lon, acq_date, acq_time, satellite) DO NOTHING
       RETURNING id`,
      [
        chunk.map((c) => c.park_id), chunk.map((c) => c.lat), chunk.map((c) => c.lon),
        chunk.map((c) => c.frp), chunk.map((c) => c.acq_date), chunk.map((c) => c.acq_time),
        chunk.map((c) => c.satellite), chunk.map((c) => c.daynight), chunk.map((c) => c.confidence),
        chunk.map(() => source),
      ]
    );
    inserted += (res as unknown[]).length;
  }
  return { seen: rows.length, inserted, inParks };
}
