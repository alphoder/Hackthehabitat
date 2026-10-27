import { sql, type Park } from "./db";
import { bboxAround, compass, distanceToRingKm, haversineKm } from "./geo";

export type Zone = { id: string; name: string; ring: number[][] };

export type FireNear = {
  lat: number; lon: number; frp: number; acq_date: string; acq_time: string; daynight: string;
  inside: boolean; km_from_center: number;
  nearest_zone: { id: string; name: string; km: number } | null;
};

export function zonesOf(park: Park): Zone[] {
  const fc = park.zones_geojson as { features?: { properties: { id: string; name: string }; geometry: { coordinates: number[][][] } }[] } | null;
  return (fc?.features ?? []).map((f) => ({ id: f.properties.id, name: f.properties.name, ring: f.geometry.coordinates[0] }));
}

/** Fires inside the park, plus anything within `pad` km of the boundary (encroachment matters). */
export async function firesNear(park: Park, pad = 25): Promise<FireNear[]> {
  const [minLon, minLat, maxLon, maxLat] = bboxAround(
    { lat: park.center_lat, lon: park.center_lon },
    park.radius_km + pad
  );
  const rows = (await sql`
    SELECT lat, lon, frp, acq_date::text, acq_time, daynight, park_id
    FROM fires
    WHERE acq_date >= current_date - 2
      AND lat BETWEEN ${minLat} AND ${maxLat}
      AND lon BETWEEN ${minLon} AND ${maxLon}
    ORDER BY acq_date DESC, acq_time DESC`) as
    (Omit<FireNear, "inside" | "km_from_center" | "nearest_zone"> & { park_id: string | null })[];

  const zones = zonesOf(park);
  return rows
    .map((r) => {
      const km = haversineKm({ lat: r.lat, lon: r.lon }, { lat: park.center_lat, lon: park.center_lon });
      let nearest: FireNear["nearest_zone"] = null;
      for (const z of zones) {
        const d = distanceToRingKm({ lat: r.lat, lon: r.lon }, z.ring);
        if (!nearest || d < nearest.km) nearest = { id: z.id, name: z.name, km: Math.round(d * 10) / 10 };
      }
      return { ...r, inside: r.park_id === park.id, km_from_center: Math.round(km * 10) / 10, nearest_zone: nearest };
    })
    .filter((f) => f.km_from_center <= park.radius_km + pad);
}

export type Weather = {
  temp_c: number; humidity: number; wind_kmh: number;
  wind_deg: number;  // direction the wind blows FROM (meteorological convention)
  wind_from: string; // compass of wind_deg
  wind_to: string;   // compass the wind is pushing TOWARD - what matters for a fire front
} | null;

export async function weatherAt(lat: number, lon: number): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
  try {
    // One retry: a single slow response from Open-Meteo was enough to blank the header in prod.
    let res = await fetch(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!res?.ok) res = await fetch(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!res?.ok) return null;
    const j = (await res.json()) as { current?: Record<string, number> };
    const c = j.current;
    if (!c) return null;
    return {
      temp_c: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      wind_kmh: c.wind_speed_10m,
      wind_deg: c.wind_direction_10m,
      wind_from: compass(c.wind_direction_10m),
      wind_to: compass(c.wind_direction_10m + 180),
    };
  } catch {
    return null; // degrade gracefully - the page still renders
  }
}

/** GBIF species baseline for the park bbox. Fetched once, then cached in parks.meta. */
export async function speciesFor(park: Park): Promise<string[]> {
  const cached = (park.meta as { species?: string[] } | null)?.species;
  if (cached) return cached;

  const [minLon, minLat, maxLon, maxLat] = bboxAround({ lat: park.center_lat, lon: park.center_lon }, park.radius_km);
  try {
    const url = `https://api.gbif.org/v1/occurrence/search?limit=0&facet=scientificName&facetLimit=24` +
      `&decimalLatitude=${minLat.toFixed(3)},${maxLat.toFixed(3)}` +
      `&decimalLongitude=${minLon.toFixed(3)},${maxLon.toFixed(3)}` +
      `&kingdomKey=1&hasCoordinate=true`; // kingdom 1 = Animalia
    const res = await fetch(url);
    if (!res.ok) return [];
    const j = (await res.json()) as { facets?: { counts: { name: string }[] }[] };
    const names = (j.facets?.[0]?.counts ?? []).map((c) => c.name).filter((n) => n.split(" ").length >= 2).slice(0, 16);
    if (names.length) {
      await sql`UPDATE parks SET meta = coalesce(meta,'{}'::jsonb) || ${JSON.stringify({ species: names })}::jsonb WHERE id = ${park.id}`;
    }
    return names;
  } catch {
    return [];
  }
}
