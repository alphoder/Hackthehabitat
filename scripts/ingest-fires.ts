import { fetchFires, ingestFires } from "../lib/firms";
import { sql } from "../lib/db";

// npm run s scripts/ingest-fires.ts [--area=world|bbox] [--days=N] [--date=YYYY-MM-DD] [--source=VIIRS_SNPP_NRT]
const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;

async function main() {
  const opts = {
    area: arg("area", "world")!,
    days: Number(arg("days", "1")),
    date: arg("date"),
    source: arg("source", "VIIRS_SNPP_NRT")!,
  };
  console.log("fetching", opts);
  const t0 = Date.now();
  const rows = await fetchFires(opts);
  console.log(`fetched ${rows.length} detections in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const r = await ingestFires(rows, opts.source);
  console.log(`inserted ${r.inserted} new (${r.inParks} inside protected areas)`);

  const top = (await sql`
    SELECT p.name, p.country, count(*)::int AS n, round(max(f.frp)::numeric, 1) AS max_frp
    FROM fires f JOIN parks p ON p.id = f.park_id
    WHERE f.acq_date >= current_date - 1
    GROUP BY p.name, p.country ORDER BY n DESC LIMIT 10`) as Record<string, unknown>[];
  console.table(top);
}

main();
