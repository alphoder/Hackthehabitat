import { sql } from "../lib/db";

// Replays already-classified media as if sensors were uploading it right now, so the park
// page feed animates during the demo. Costs ZERO Gemini calls — it re-times existing
// detections rather than re-classifying them (that is the whole point of the sha256 cache).
//
// npm run s scripts/field-sim.ts [--park=great-smoky] [--every=6] [--incident]
//   --incident  stages the fused case: chainsaw on an acoustic station, then a vehicle
//               on a nearby camera minutes later, in the same zone.

const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const PARK = arg("park", "great-smoky")!;
const EVERY_S = Number(arg("every", "6"));
const INCIDENT = process.argv.includes("--incident");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ev = { id: number; kind: string; severity: number; summary: string; media_id: number | null; lat: number; lon: number };

async function push(e: Ev, at: Date) {
  await sql`UPDATE events SET occurred_at = ${at.toISOString()} WHERE id = ${e.id}`;
  const t = at.toISOString().slice(11, 19);
  console.log(`${t}  sev${e.severity} ${e.kind.padEnd(9)} ${e.summary.slice(0, 78)}`);
}

async function main() {
  const all = (await sql`
    SELECT id, kind, severity, summary, media_id, lat, lon
    FROM events WHERE park_id = ${PARK} ORDER BY id`) as Ev[];
  if (!all.length) throw new Error(`no events for ${PARK} — run scripts/ingest-media.ts first`);

  if (INCIDENT) {
    // One coherent story: motor noise, then a vehicle seen nearby shortly after.
    const chainsaw = all.find((e) => e.kind === "chainsaw");
    const vehicle = all.find((e) => e.kind === "vehicle");
    if (!chainsaw || !vehicle) throw new Error("need one chainsaw and one vehicle event to stage an incident");

    console.log(`staging incident at ${PARK}\n`);
    const now = new Date();
    await push(chainsaw, new Date(now.getTime() - 14 * 60_000));
    await sleep(EVERY_S * 1000);
    await push(vehicle, now);
    console.log(`\nincident staged — severity ${chainsaw.severity} ${chainsaw.kind} and severity ${vehicle.severity} ${vehicle.kind}, 14 minutes apart`);
    return;
  }

  // Steady trickle: wildlife mostly, with the occasional escalation, newest last.
  const wildlife = all.filter((e) => e.severity <= 2);
  const threats = all.filter((e) => e.severity >= 4);
  const order: Ev[] = [];
  wildlife.forEach((w, i) => {
    order.push(w);
    if (i % 5 === 4 && threats.length) order.push(threats[(i / 5) % threats.length | 0]);
  });

  console.log(`replaying ${order.length} events at ${PARK}, one every ${EVERY_S}s — Ctrl-C to stop\n`);
  for (const e of order) {
    await push(e, new Date());
    await sleep(EVERY_S * 1000);
  }
}

main();
