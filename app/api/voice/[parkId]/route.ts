import { sql } from "@/lib/db";
import { firesNear, weatherAt } from "@/lib/park";
import { retrieve } from "@/lib/chat";
import type { Park } from "@/lib/db";

export const dynamic = "force-dynamic";

// Backs the Live API function calls. The voice model has NO data of its own - every fact it
// speaks comes from one of these three tools, which read the same tables as the rest of the app.
export async function POST(req: Request, ctx: { params: Promise<{ parkId: string }> }) {
  const { parkId } = await ctx.params;
  const { tool, args } = (await req.json()) as { tool: string; args?: Record<string, unknown> };

  const [park] = (await sql`SELECT * FROM parks WHERE id = ${parkId}`) as Park[];
  if (!park) return Response.json({ error: "unknown park" }, { status: 404 });

  try {
    if (tool === "get_recent_events") {
      const hours = Math.min(Number(args?.hours ?? 24), 168);
      const kind = (args?.kind as string) || null;
      const rows = (await sql`
        SELECT id, kind, severity, occurred_at, summary FROM events
        WHERE park_id = ${parkId}
          AND occurred_at > now() - (${hours} || ' hours')::interval
          AND (${kind}::text IS NULL OR kind = ${kind})
        ORDER BY severity DESC, occurred_at DESC LIMIT 15`) as Record<string, unknown>[];
      return Response.json({
        park: park.name, hours, count: rows.length,
        events: rows.map((e) => ({
          time_utc: new Date(e.occurred_at as string).toISOString().slice(11, 16),
          kind: e.kind, severity: e.severity, detail: e.summary,
        })),
      });
    }

    if (tool === "get_fires") {
      const [fires, weather] = await Promise.all([firesNear(park), weatherAt(park.center_lat, park.center_lon)]);
      const inside = fires.filter((f) => f.inside);
      return Response.json({
        park: park.name,
        inside_boundary: inside.length,
        within_25km: fires.length - inside.length,
        nearest_to_zone: fires.filter((f) => f.nearest_zone).sort((a, b) => a.nearest_zone!.km - b.nearest_zone!.km)[0]?.nearest_zone ?? null,
        wind: weather ? { pushing_toward: weather.wind_to, kmh: weather.wind_kmh, humidity: weather.humidity } : null,
        note: "Wind direction only. No fire spread prediction is available.",
      });
    }

    if (tool === "search_record") {
      const q = String(args?.question ?? "");
      const r = await retrieve(parkId, q);
      return Response.json({
        matched: r.events.length, hours: r.hours,
        events: r.events.slice(0, 12).map((e) => ({
          time_utc: new Date(e.occurred_at as string).toISOString().slice(5, 16).replace("T", " "),
          kind: e.kind, severity: e.severity, detail: e.summary,
        })),
      });
    }

    return Response.json({ error: `unknown tool ${tool}` }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
