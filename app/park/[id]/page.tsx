import dynamicImport from "next/dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, type Park } from "@/lib/db";
import { firesNear, speciesFor, weatherAt, zonesOf } from "@/lib/park";
import EventFeed, { type FeedEvent } from "./event-feed";
import BriefPanel from "./brief-panel";
import AskPanel from "./ask-panel";
import IncidentPanel from "./incident-panel";
import HowToRead from "@/app/how-to-read";
import { clusterEvents } from "@/lib/incident";

export const dynamic = "force-dynamic";

const ParkMap = dynamicImport(() => import("./park-map"));

export default async function ParkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [park] = (await sql`SELECT * FROM parks WHERE id = ${id}`) as Park[];
  if (!park) notFound();

  // Sensors, events and the latest briefing came as three separate round trips to a database
  // in another country. One CTE query returning a single JSON row does the same work for a
  // third of the latency.
  const [bundleRows, fires, weather, species] = await Promise.all([
    sql`
      SELECT json_build_object(
        'sensors', (SELECT coalesce(json_agg(s ORDER BY s.kind, s.name), '[]'::json)
                    FROM (SELECT id, kind, name, lat, lon FROM sensors WHERE park_id = ${id}) s),
        'events',  (SELECT coalesce(json_agg(e ORDER BY e.occurred_at DESC), '[]'::json)
                    FROM (SELECT ev.id, ev.kind, ev.severity, ev.occurred_at, ev.summary, ev.lat, ev.lon,
                                 ev.media_id, ev.meta, m.path AS media_path, m.kind AS media_kind
                          FROM events ev LEFT JOIN media m ON m.id = ev.media_id
                          WHERE ev.park_id = ${id} AND ev.occurred_at > now() - interval '72 hours'
                          ORDER BY ev.occurred_at DESC LIMIT 100) e),
        'briefing',(SELECT row_to_json(b) FROM (SELECT id, content_md, created_at FROM briefings
                    WHERE park_id = ${id} ORDER BY created_at DESC LIMIT 1) b)
      ) AS bundle` as Promise<unknown> as Promise<{ bundle: {
        sensors: { id: string; kind: string; name: string; lat: number; lon: number }[];
        events: (FeedEvent & { lat: number | null; lon: number | null; media_id: number | null; meta: Record<string, unknown> | null })[];
        briefing: { id: number; content_md: string; created_at: string } | null;
      } }[]>,
    firesNear(park),
    weatherAt(park.center_lat, park.center_lon),
    speciesFor(park),
  ]);

  const { sensors, events, briefing } = bundleRows[0].bundle;
  // Cluster from the events we already have rather than querying for them a second time.
  const clusters = clusterEvents(events.filter((e) => e.severity >= 4));

  const zones = zonesOf(park);
  const inside = fires.filter((f) => f.inside);
  const nearest = fires.filter((f) => f.nearest_zone).sort((a, b) => a.nearest_zone!.km - b.nearest_zone!.km)[0];
  const cameras = sensors.filter((s) => s.kind === "camera").length;
  const acoustic = sensors.length - cameras;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      {/* header */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-panel-border px-5 py-3">
        <div className="flex items-center gap-4">
          <Link href="/globe" className="readout text-xs text-zinc-500 transition-colors hover:text-zinc-200">
            ← globe
          </Link>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">{park.name}</h1>
            <p className="readout text-[11px] text-zinc-500">
              {park.country} · {park.center_lat.toFixed(2)}, {park.center_lon.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="readout flex items-center gap-5 text-[11px] text-zinc-400">
          {weather ? (
            <>
              <span>{weather.temp_c}°C</span>
              <span>{weather.humidity}% humidity</span>
              <span className="text-sky-300">wind pushing {weather.wind_to} · {weather.wind_kmh} km/h</span>
            </>
          ) : (
            <span className="text-amber-400">weather unavailable</span>
          )}
          <span className={inside.length ? "text-red-400" : "text-emerald-400"}>
            {inside.length ? `${inside.length} fire${inside.length > 1 ? "s" : ""} inside` : "no fires inside"}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* map */}
        <div className="relative min-w-0 flex-1">
          <ParkMap
            center={[park.center_lat, park.center_lon]}
            radiusKm={park.radius_km}
            polygon={park.polygon_geojson as { coordinates: number[][][] } | null}
            zones={zones}
            fires={fires}
            sensors={sensors}
            wind={weather}
          />
          {!park.featured && (
            <div className="pointer-events-none absolute bottom-4 left-4 rounded border border-panel-border bg-panel/90 px-3 py-2">
              <p className="text-[11px] leading-relaxed text-zinc-400">
                Approximate boundary (centroid + {park.radius_km} km radius).
                <br />No drawn polygon or field sensors for this park.
              </p>
            </div>
          )}
        </div>

        {/* right rail */}
        <aside className="flex w-full max-w-md shrink-0 flex-col overflow-y-auto border-l border-panel-border bg-panel/60">
          <HowToRead />

          {/* threat */}
          <section className="border-b border-panel-border px-5 py-4">
            <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">Fires right now</h2>
            {fires.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">
                No fires detected inside this park, or within 25 km of it, in the last 48 hours.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
                <p>
                  <span className="readout text-red-400">{inside.length}</span> detections inside the boundary,{" "}
                  <span className="readout text-amber-400">{fires.length - inside.length}</span> within 25 km of it.
                </p>
                {nearest?.nearest_zone && (
                  <p>
                    Nearest to a named zone:{" "}
                    <span className="readout text-zinc-100">{nearest.nearest_zone.km} km</span> from{" "}
                    <span className="text-sky-300">{nearest.nearest_zone.name}</span>.
                  </p>
                )}
                {weather && (
                  <p className="text-zinc-400">
                    Wind is pushing {weather.wind_to} at {weather.wind_kmh} km/h with {weather.humidity}% humidity.
                    <span className="block text-[11px] text-zinc-600">
                      Wind direction only. Sentinel does not predict where a fire will go.
                    </span>
                  </p>
                )}
              </div>
            )}
          </section>

          <BriefPanel parkId={park.id} initial={briefing} />

          <IncidentPanel
            parkId={park.id}
            clusters={clusters.map((c) => ({
              event_ids: c.map((e) => e.id),
              kinds: [...new Set(c.map((e) => e.kind))],
              severity: Math.max(...c.map((e) => e.severity)),
              from: c[0].occurred_at,
              to: c[c.length - 1].occurred_at,
              summaries: c.map((e) => e.summary),
            }))}
          />

          <AskPanel parkId={park.id} />

          {/* sensors */}
          <section className="border-b border-panel-border px-5 py-4">
            <div className="flex items-baseline justify-between">
              <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">Cameras and microphones</h2>
              <span className="readout text-[10px] text-zinc-600">{cameras} camera · {acoustic} acoustic</span>
            </div>
            {sensors.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">No sensor network deployed at this park.</p>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-500/80">
                Real recordings from research datasets, replayed as if these sensors were uploading now.
              </p>
            )}
          </section>

          {/* event feed - grows with content; the whole rail scrolls */}
          <section>
            <div className="sticky top-0 z-10 border-b border-panel-border bg-panel/95 px-5 py-3 backdrop-blur">
              <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">What the sensors saw · last 3 days</h2>
            </div>
            <EventFeed parkId={park.id} initial={events} />
          </section>

          {/* species */}
          {species.length > 0 && (
            <section className="mt-auto border-t border-panel-border px-5 py-4">
              <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">
                Animals recorded here before
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {species.slice(0, 12).map((s) => (
                  <span key={s} className="rounded-sm border border-panel-border px-1.5 py-0.5 text-[10px] italic text-zinc-400">
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
