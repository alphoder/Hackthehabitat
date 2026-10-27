import { readFile } from "node:fs/promises";
import { sql, type Park } from "@/lib/db";
import { firesNear, weatherAt } from "@/lib/park";
import { retrieve } from "@/lib/chat";
import { generateBriefing } from "@/lib/brief";
import { createIncident, findClusters, generateDossier } from "@/lib/incident";
import { fetchFires, ingestFires } from "@/lib/firms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Server half of the hovering agent's tool surface: data reads and state changes.
// The view-level tools (navigate, read_view, scroll_to) are handled in the browser.

const clip = (s: string, n = 240) => (s.length > n ? s.slice(0, n) + "…" : s);
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

async function getPark(id: string) {
  const [p] = (await sql`SELECT * FROM parks WHERE id = ${id}`) as Park[];
  return p ?? null;
}

export async function POST(req: Request) {
  const { tool, args = {} } = (await req.json()) as { tool: string; args?: Record<string, unknown> };
  const parkId = typeof args.park_id === "string" ? args.park_id : null;

  try {
    switch (tool) {
      case "get_global_summary": {
        const [stats] = (await sql`
          SELECT count(*)::int AS total_fires,
                 count(*) FILTER (WHERE park_id IS NOT NULL)::int AS inside_protected_areas,
                 count(DISTINCT park_id)::int AS parks_affected
          FROM fires WHERE acq_date >= current_date - 1`) as Record<string, number>[];
        const top = (await sql`
          SELECT p.id, p.name, p.country, count(*)::int AS detections,
                 round(max(f.frp)::numeric, 1)::float AS peak_mw
          FROM fires f JOIN parks p ON p.id = f.park_id
          WHERE f.acq_date >= current_date - 1
          GROUP BY p.id ORDER BY count(*) DESC, max(f.frp) DESC LIMIT 5`) as Record<string, unknown>[];
        const [{ watched }] = (await sql`SELECT count(*)::int AS watched FROM parks`) as { watched: number }[];
        return Response.json({ ...stats, parks_watched: watched, worst_hit: top, window: "last 24 hours" });
      }

      case "find_park": {
        const name = typeof args.name === "string" ? args.name : null;
        const featuredOnly = args.featured_only === true;
        const rows = (await sql`
          SELECT id, name, country, featured FROM parks
          WHERE (${name}::text IS NULL OR name ILIKE '%' || ${name} || '%')
            AND (${featuredOnly}::boolean = false OR featured = true)
          ORDER BY featured DESC, name LIMIT 12`) as Record<string, unknown>[];
        return Response.json({ matches: rows, note: rows.length ? undefined : "no park matched that name" });
      }

      case "get_park_status": {
        if (!parkId) return Response.json({ error: "park_id required" }, { status: 400 });
        const park = await getPark(parkId);
        if (!park) return Response.json({ error: `unknown park ${parkId}` }, { status: 404 });
        const [fires, weather, counts] = await Promise.all([
          firesNear(park),
          weatherAt(park.center_lat, park.center_lon),
          sql`SELECT kind, max(severity)::int AS severity, count(*)::int AS n
              FROM events WHERE park_id = ${parkId} AND occurred_at > now() - interval '24 hours'
              GROUP BY kind ORDER BY max(severity) DESC` as Promise<unknown> as Promise<Record<string, unknown>[]>,
        ]);
        const inside = fires.filter((f) => f.inside);
        return Response.json({
          park: park.name, country: park.country,
          has_sensor_network: park.featured,
          fires_inside_boundary: inside.length,
          fires_within_25km: fires.length - inside.length,
          nearest_zone: fires.filter((f) => f.nearest_zone).sort((a, b) => a.nearest_zone!.km - b.nearest_zone!.km)[0]?.nearest_zone ?? null,
          wind: weather ? { pushing_toward: weather.wind_to, kmh: weather.wind_kmh, humidity: weather.humidity, temp_c: weather.temp_c } : null,
          events_last_24h: counts,
          note: "Wind direction only. No fire spread prediction exists in this system.",
        });
      }

      case "get_recent_events": {
        if (!parkId) return Response.json({ error: "park_id required" }, { status: 400 });
        const hours = Math.min(Number(args.hours ?? 24) || 24, 168);
        const kind = typeof args.kind === "string" ? args.kind : null;
        const rows = (await sql`
          SELECT id, kind, severity, occurred_at, summary FROM events
          WHERE park_id = ${parkId}
            AND occurred_at > now() - (${hours} || ' hours')::interval
            AND (${kind}::text IS NULL OR kind = ${kind})
          ORDER BY severity DESC, occurred_at DESC LIMIT 15`) as Record<string, unknown>[];
        return Response.json({
          hours, count: rows.length,
          events: rows.map((e) => ({ time_utc: hhmm(e.occurred_at as string), kind: e.kind, severity: e.severity, detail: clip(e.summary as string) })),
        });
      }

      case "search_record": {
        if (!parkId) return Response.json({ error: "park_id required" }, { status: 400 });
        const r = await retrieve(parkId, String(args.question ?? ""));
        return Response.json({
          matched: r.events.length, hours: r.hours,
          events: r.events.slice(0, 12).map((e) => ({
            time_utc: new Date(e.occurred_at as string).toISOString().slice(5, 16).replace("T", " "),
            kind: e.kind, severity: e.severity, detail: clip(e.summary as string),
          })),
        });
      }

      case "read_briefing": {
        if (!parkId) return Response.json({ error: "park_id required" }, { status: 400 });
        const [b] = (await sql`
          SELECT content_md, created_at FROM briefings WHERE park_id = ${parkId}
          ORDER BY created_at DESC LIMIT 1`) as { content_md: string; created_at: string }[];
        if (!b) return Response.json({ exists: false, note: "no briefing has been written for this park yet" });
        return Response.json({ exists: true, written_utc: b.created_at, briefing: b.content_md });
      }

      case "get_backtest": {
        try {
          const bt = JSON.parse(await readFile("data/backtest.json", "utf8"));
          const escIdx = bt.daily.findIndex((d: { date: string }) => d.date === bt.escalation?.date);
          const before = escIdx > 0 ? bt.daily[escIdx - 1] : null;
          return Response.json({
            park: "Pantanal Matogrossense", year: 2024, source: bt.source,
            escalation_raised: bt.escalation?.date ?? null,
            threshold_detections: bt.threshold,
            day_before: before ? { date: before.date, detections: before.detections, total_mw: before.total_frp } : null,
            escalation_day: bt.escalation ? { detections: bt.escalation.detections, total_mw: bt.escalation.total_frp } : null,
            season_peak: { date: bt.peak.date, detections: bt.peak.detections, total_mw: bt.peak.total_frp },
            caveat: "This is detection, not response. It says nothing about whether anyone acted.",
          });
        } catch {
          return Response.json({ error: "backtest has not been run" }, { status: 404 });
        }
      }

      case "write_briefing": {
        if (!parkId) return Response.json({ error: "park_id required" }, { status: 400 });
        const b = await generateBriefing(parkId);
        return Response.json({ ok: true, briefing: b.content_md, note: "A new briefing was written and is now on the park page." });
      }

      case "build_dossier": {
        if (!parkId) return Response.json({ error: "park_id required" }, { status: 400 });
        const clusters = await findClusters(parkId);
        if (!clusters.length) return Response.json({ ok: false, note: "no high-severity case at this park to compile" });
        const best = clusters[0];
        const inc = await createIncident(parkId, best.map((e) => e.id));
        await generateDossier(inc.id);
        return Response.json({
          ok: true, dossier_id: inc.id, title: inc.title,
          signals: best.length,
          kinds: [...new Set(best.map((e) => e.kind))],
          note: "Evidence packet compiled. Navigate to view 'dossier' with this dossier_id to open it.",
        });
      }

      case "refresh_fires": {
        const rows = await fetchFires({ area: "world", days: 1 });
        const r = await ingestFires(rows);
        return Response.json({ ok: true, detections_seen: r.seen, new_detections: r.inserted, inside_protected_areas: r.inParks });
      }

      default:
        return Response.json({ error: `unknown tool ${tool}` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
