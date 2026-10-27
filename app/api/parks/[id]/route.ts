import { sql, type Park, type EventRow } from "@/lib/db";
import { firesNear, speciesFor, weatherAt, zonesOf } from "@/lib/park";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [park] = (await sql`SELECT * FROM parks WHERE id = ${id}`) as Park[];
  if (!park) return Response.json({ error: "not found" }, { status: 404 });

  const [fires, weather, species, sensors, events] = await Promise.all([
    firesNear(park),
    weatherAt(park.center_lat, park.center_lon),
    speciesFor(park),
    sql`SELECT * FROM sensors WHERE park_id = ${id} ORDER BY kind, name`,
    sql`SELECT e.*, m.path AS media_path, m.kind AS media_kind
        FROM events e LEFT JOIN media m ON m.id = e.media_id
        WHERE e.park_id = ${id} AND e.occurred_at > now() - interval '72 hours'
        ORDER BY e.occurred_at DESC LIMIT 100`,
  ]);

  return Response.json({
    park: {
      id: park.id, name: park.name, country: park.country,
      center: [park.center_lat, park.center_lon], radius_km: park.radius_km,
      polygon: park.polygon_geojson, featured: park.featured,
    },
    zones: zonesOf(park),
    fires,
    weather,
    species,
    sensors,
    events: events as EventRow[],
  });
}
