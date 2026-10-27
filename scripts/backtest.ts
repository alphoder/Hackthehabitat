import { writeFile } from "node:fs/promises";
import { sql } from "../lib/db";
import { fetchFires, ingestFires } from "../lib/firms";

// Replays the 2024 Pantanal fire season through the same triage the live system runs, to show
// when an automated watch would have escalated. npm run s scripts/backtest.ts
//
// Honesty note: this compares Sentinel's escalation date against the season's own peak, both
// derived from the same NASA archive. No claim is made about news coverage dates, which we
// cannot verify from inside this system.

const PARK = "pantanal-matogrossense";
const BBOX = "-58.5,-19,-56,-16.5";
const SOURCE = "VIIRS_SNPP_SP"; // standard processing — NRT only covers ~2 months
const START = "2024-05-15";
const DAYS = 60;
const CHUNK = 5; // FIRMS caps a request at 5 days

// A park escalates when a day's detections inside its boundary cross this.
// Chosen to sit well above the quiet-season baseline, not tuned to make the demo look good.
const ESCALATE_DETECTIONS = 10;

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`replaying ${DAYS} days from ${START} over ${BBOX}`);
  let fetched = 0, inserted = 0;

  for (let offset = 0; offset < DAYS; offset += CHUNK) {
    const from = addDays(START, offset);
    try {
      const rows = await fetchFires({ area: BBOX, days: CHUNK, date: from, source: SOURCE });
      const r = await ingestFires(rows, SOURCE);
      fetched += r.seen; inserted += r.inserted;
      process.stdout.write(`  ${from}: ${r.seen} detections (${r.inserted} new)\n`);
    } catch (e) {
      console.error(`  ${from}: FAILED ${(e as Error).message.slice(0, 90)}`);
    }
  }
  console.log(`\n${fetched} archive detections, ${inserted} stored`);

  const daily = (await sql`
    SELECT acq_date::text AS date, count(*)::int AS detections,
           round(sum(frp)::numeric, 1)::float AS total_frp,
           round(max(frp)::numeric, 1)::float AS max_frp
    FROM fires
    WHERE park_id = ${PARK} AND source = ${SOURCE}
      AND acq_date BETWEEN ${START}::date AND ${addDays(START, DAYS)}::date
    GROUP BY acq_date ORDER BY acq_date`) as
    { date: string; detections: number; total_frp: number; max_frp: number }[];

  if (!daily.length) {
    console.log("no detections inside the park boundary for this window — nothing to plot");
    return;
  }

  const peak = daily.reduce((a, d) => (d.detections > a.detections ? d : a));
  const escalation = daily.find((d) => d.detections >= ESCALATE_DETECTIONS) ?? null;
  const leadDays = escalation
    ? Math.round((new Date(peak.date).getTime() - new Date(escalation.date).getTime()) / 86400_000)
    : null;

  console.log("\n=== BACKTEST ===");
  console.log(`days with detections inside the boundary: ${daily.length}`);
  console.log(`peak day      : ${peak.date} — ${peak.detections} detections, ${peak.total_frp} MW total`);
  if (escalation) {
    console.log(`escalation at : ${escalation.date} — first day at or above ${ESCALATE_DETECTIONS} detections (${escalation.detections})`);
    console.log(`lead time     : ${leadDays} days before the season peak`);
  } else {
    console.log(`escalation    : never crossed ${ESCALATE_DETECTIONS} detections in this window`);
  }
  console.table(daily.filter((d) => d.detections > 2).slice(0, 20));

  await writeFile("data/backtest.json", JSON.stringify({
    park: PARK, source: SOURCE, start: START, days: DAYS,
    threshold: ESCALATE_DETECTIONS, daily, peak, escalation, leadDays,
    measured_at: new Date().toISOString(),
  }, null, 2));
  console.log("\nwrote data/backtest.json");
}

main();
