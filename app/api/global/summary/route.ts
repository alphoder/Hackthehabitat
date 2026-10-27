import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Planetary triage. Pure SQL + math - zero Gemini calls.
export async function GET() {
  const [stats] = (await sql`
    SELECT
      count(*)::int AS total_fires,
      count(*) FILTER (WHERE park_id IS NOT NULL)::int AS fires_in_parks,
      count(DISTINCT park_id)::int AS parks_affected,
      max(ingested_at) AS updated_at
    FROM fires WHERE acq_date >= current_date - 1`) as Record<string, unknown>[];

  // Compact tuples keep the payload small: [lat, lon, frp, inPark]
  const firePoints = (await sql`
    SELECT round(lat::numeric, 3) AS lat, round(lon::numeric, 3) AS lon,
           round(frp::numeric, 1) AS frp, (park_id IS NOT NULL) AS in_park
    FROM fires WHERE acq_date >= current_date - 1`) as
    { lat: string; lon: string; frp: string; in_park: boolean }[];

  const top = (await sql`
    SELECT p.id, p.name, p.country, p.center_lat AS lat, p.center_lon AS lon, p.featured,
           count(*)::int AS detections,
           round(max(f.frp)::numeric, 1)::float AS max_frp,
           round(sum(f.frp)::numeric, 1)::float AS total_frp
    FROM fires f JOIN parks p ON p.id = f.park_id
    WHERE f.acq_date >= current_date - 1
    GROUP BY p.id ORDER BY count(*) DESC, max(f.frp) DESC LIMIT 10`) as Record<string, unknown>[];

  const [{ parks_watched }] = (await sql`SELECT count(*)::int AS parks_watched FROM parks`) as { parks_watched: number }[];

  return Response.json({
    stats: { ...stats, parks_watched },
    fires: firePoints.map((f) => [Number(f.lat), Number(f.lon), Number(f.frp), f.in_park ? 1 : 0]),
    top,
  });
}
