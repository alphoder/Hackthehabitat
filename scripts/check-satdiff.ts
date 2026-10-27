import { writeFile, mkdir } from "node:fs/promises";
import { sql } from "../lib/db";
import { compareSatellite, callCount } from "../lib/gemini";
import { fetchTile, RESOLUTION_M } from "../lib/satellite";

// Before/after satellite comparison. npm run s scripts/check-satdiff.ts [--save]
//
// MEASURED RESULT (2026-08-15, gemini-3.1-flash-lite): FEATURE IS EXPERIMENTAL.
//   Pantanal 2024-04-18 -> 2024-07-20 : reported "no change — seasonal drying and cloud"
//   Null control (identical images)    : correctly reported identical, confidence 1.0
// Conclusion: at 250 m/px MODIS true colour over a 160 km scene, burn scars are not reliably
// separable from dry-season browning. The model declines to over-claim and does not invent
// change, which is the behaviour we want — but it cannot carry a deforestation claim.
// Most single-day tiles here are also cloud-covered. Ship this labelled experimental;
// a real version needs Sentinel-2 (10 m) or a burned-area product (MCD64A1), not true colour.
// Pantanal 2024 is the ground truth: the worst fire season on record burned a large share of
// the biome, so a real burn scar exists to be found. A control pair with no fire between the
// dates catches the opposite failure — a model that says "changed" to everything.
// If Gemini cannot see the scar at 250 m/px, that is a finding we report, not something to hide.

const SAVE = process.argv.includes("--save");

// Dates chosen by eye from GIBS for low cloud — most single-day MODIS tiles over the Pantanal
// are overcast, which is itself a real limitation of optical monitoring.
const CASES = [
  { park: "pantanal-matogrossense", label: "Pantanal — pre-fire vs during the 2024 fire season",
    lat: -17.75, lon: -57.4, spanKm: 80, before: "2024-04-18", after: "2024-07-20", expect: "burn_scar" },
  // Same image twice: if the model reports change here it is inventing it.
  { park: "pantanal-matogrossense", label: "Pantanal — null control, identical dates",
    lat: -17.75, lon: -57.4, spanKm: 80, before: "2024-07-20", after: "2024-07-20", expect: "none" },
];

async function main() {
  if (SAVE) await mkdir("data/satellite", { recursive: true });
  const results: Record<string, unknown>[] = [];

  for (const c of CASES) {
    console.log(`\n${c.label}\n  ${c.before} -> ${c.after}, ${c.spanKm} km span at ${RESOLUTION_M} m/px`);
    try {
      const [before, after] = await Promise.all([
        fetchTile(c.lat, c.lon, c.spanKm, c.before),
        fetchTile(c.lat, c.lon, c.spanKm, c.after),
      ]);
      console.log(`  tiles: ${(before.bytes / 1024).toFixed(0)} KB / ${(after.bytes / 1024).toFixed(0)} KB`);
      if (SAVE) {
        await writeFile(`data/satellite/${c.park}_${c.before}.jpg`, Buffer.from(before.data, "base64"));
        await writeFile(`data/satellite/${c.park}_${c.after}.jpg`, Buffer.from(after.data, "base64"));
      }

      const verdict = await compareSatellite(before, after,
        `Each image covers about ${c.spanKm * 2} km across at ${RESOLUTION_M} m per pixel. ` +
        `BEFORE is ${c.before}, AFTER is ${c.after}. Anything smaller than a few hundred metres is invisible at this scale.`);

      const hit = c.expect === "none" ? !verdict.change : verdict.type === c.expect;
      console.log(`  expected ${c.expect} -> got change=${verdict.change} type=${verdict.type} conf=${verdict.confidence}`);
      console.log(`  "${verdict.description}"  ${hit ? "OK" : "MISS"}`);
      results.push({ ...c, verdict, hit });

      if (verdict.change && verdict.confidence >= 0.6) {
        await sql`
          INSERT INTO events (park_id, kind, severity, lat, lon, occurred_at, summary, meta)
          VALUES (${c.park}, 'satellite', 3, ${c.lat}, ${c.lon}, ${c.after},
                  ${`Satellite change (${verdict.type}) between ${c.before} and ${c.after}: ${verdict.description}`},
                  ${JSON.stringify({ source: "gibs", layer: "MODIS_Terra_TrueColor", resolution_m: RESOLUTION_M, ...verdict })})`;
      }
    } catch (e) {
      console.error(`  FAILED: ${(e as Error).message}`);
      results.push({ ...c, error: (e as Error).message });
    }
  }

  console.log(`\ncalls: ${JSON.stringify(callCount)}`);
  await writeFile("data/satdiff-results.json", JSON.stringify({ measured_at: new Date().toISOString(), results }, null, 2));
}

main();
