import dynamicImport from "next/dynamic";
import Link from "next/link";
import { sql } from "@/lib/db";
import RefreshButton from "../refresh-button";

// Fires refresh hourly, so a few minutes of staleness costs nothing and makes navigation
// instant. The header prints the data timestamp, so "how fresh" stays visible and honest.
export const revalidate = 300;

const GlobeView = dynamicImport(() => import("../globe-view"));

type TopPark = {
  id: string; name: string; country: string; lat: number; lon: number;
  featured: boolean; detections: number; max_frp: number; total_frp: number;
};

async function getData() {
  // Neon's HTTP SQL API costs roughly half a millisecond PER ROW, and degrades badly past a
  // few thousand. Returning today's fires row-by-row took 25 seconds. Aggregating onto a 0.5°
  // grid (~55 km, visually identical at globe zoom) and packing the whole grid into ONE row
  // does the same job in about half a second for 99 KB. The cost was never the query - it was
  // the row count. Format per point: "lat,lon,frp,inPark" joined by ";".
  const [packed, top, meta] = await Promise.all([
    sql`
      SELECT string_agg(lat || ',' || lon || ',' || frp || ',' || inp, ';') AS points FROM (
        SELECT (round(lat * 2) / 2) AS lat,
               (round(lon * 2) / 2) AS lon,
               round(max(frp)::numeric, 1) AS frp,
               (bool_or(park_id IS NOT NULL))::int AS inp
        FROM fires
        WHERE acq_date >= current_date - 1
        GROUP BY 1, 2
      ) grid` as Promise<unknown> as Promise<{ points: string | null }[]>,
    sql`
      SELECT p.id, p.name, p.country, p.center_lat AS lat, p.center_lon AS lon, p.featured,
             count(*)::int AS detections,
             round(max(f.frp)::numeric, 1)::float AS max_frp,
             round(sum(f.frp)::numeric, 1)::float AS total_frp
      FROM fires f JOIN parks p ON p.id = f.park_id
      WHERE f.acq_date >= current_date - 1
      GROUP BY p.id ORDER BY count(*) DESC, max(f.frp) DESC LIMIT 10` as Promise<unknown> as Promise<TopPark[]>,
    sql`
      SELECT (SELECT count(*)::int FROM parks) AS parks_watched,
             (SELECT count(*)::int FROM fires WHERE acq_date >= current_date - 1) AS total_fires,
             (SELECT count(*)::int FROM fires WHERE acq_date >= current_date - 1 AND park_id IS NOT NULL) AS fires_in_parks,
             (SELECT count(DISTINCT park_id)::int FROM fires WHERE acq_date >= current_date - 1) AS parks_affected,
             (SELECT max(ingested_at) FROM fires) AS updated_at` as Promise<unknown> as Promise<
      { parks_watched: number; total_fires: number; fires_in_parks: number; parks_affected: number; updated_at: string | null }[]
    >,
  ]);

  const cells: [number, number, number][] = [];
  const hot: [number, number, number][] = [];
  for (const p of (packed[0]?.points ?? "").split(";")) {
    if (!p) continue;
    const [lat, lon, frp, inp] = p.split(",");
    (inp === "1" ? hot : cells).push([Number(lat), Number(lon), Number(frp)]);
  }

  return { stats: meta[0], cells, hot, top };
}

export default async function Home() {
  const { stats, cells, hot, top } = await getData();
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        {cells.length + hot.length > 0 ? (
          <GlobeView cells={cells} hot={hot} top={top} />
        ) : (
          <div className="grid h-full place-items-center text-zinc-500">
            No fire data yet - run <code className="readout mx-2 text-zinc-300">npm run s scripts/ingest-fires.ts</code>
          </div>
        )}
      </div>

      {/* Header stops short of the priority queue, which is absolutely positioned over the
          right edge - anything placed under it was invisible. */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 p-6 md:right-96 md:p-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="readout text-[11px] uppercase tracking-[0.25em] text-emerald-400">
              ● Sentinel · live
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Protected area operations
            </h1>
          </div>
          <div className="hidden items-end gap-1.5 md:flex md:flex-col">
            <div className="readout text-right text-[11px] text-zinc-500">
              <div>{stats.parks_watched} protected areas watched</div>
              <div>Satellite data from NASA</div>
            </div>
            <RefreshButton updatedAt={stats.updated_at} />
          </div>
        </div>
      </div>

      {/* headline stat */}
      <div className="pointer-events-none absolute bottom-8 left-6 max-w-lg md:left-8">
        <div className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-500">right now</div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="readout text-6xl font-semibold text-red-400 md:text-7xl">
            {stats.parks_affected ?? 0}
          </span>
          <span className="text-lg leading-tight text-zinc-300">
            protected areas have
            <br />fires burning inside them
          </span>
        </div>
        <p className="readout mt-3 text-xs text-zinc-500">
          {(stats.fires_in_parks ?? 0).toLocaleString()} hot spots inside park boundaries ·{" "}
          {(stats.total_fires ?? 0).toLocaleString()} detected worldwide in the last 24 hours
        </p>
      </div>

      {/* ranked list */}
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-panel-border bg-panel/80 backdrop-blur-md md:w-96">
        <div className="border-b border-panel-border px-5 py-4">
          <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">
            Priority queue
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Most satellite hot spots first. Working this out costs no AI at all, just geometry.
          </p>
        </div>

        <ol className="flex-1 divide-y divide-panel-border overflow-y-auto">
          {top.map((p, i) => (
            <li key={p.id}>
              <Link
                href={`/park/${p.id}`}
                prefetch={false}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.04]"
              >
                <span className="readout w-5 text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{p.name}</span>
                    {p.featured && (
                      <span className="readout shrink-0 rounded-sm border border-emerald-500/40 px-1 text-[9px] uppercase text-emerald-400">
                        sensors
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">{p.country}</span>
                </span>
                <span className="readout shrink-0 text-right">
                  <span className="block text-sm text-red-400">{p.detections}</span>
                  <span className="block text-[10px] text-zinc-600">{p.max_frp} MW heat</span>
                </span>
              </Link>
            </li>
          ))}
          {top.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-zinc-500">
              No fire intrusions detected in the last 24 hours.
            </li>
          )}
        </ol>

        <div className="border-t border-panel-border px-5 py-3">
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Most park outlines here are approximate circles, not official boundaries.
            Three parks have properly drawn outlines and named zones.
          </p>
        </div>
      </aside>
    </main>
  );
}
