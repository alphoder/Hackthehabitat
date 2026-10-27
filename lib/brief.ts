import { sql, type Park } from "./db";
import { firesNear, weatherAt, zonesOf } from "./park";
import { haversineKm } from "./geo";
import { reason } from "./gemini";

// Builds the compact context the REASON model reasons over. Keeping this small is both a
// quota and a quality decision: high-severity events verbatim, everything else counted.

export type EventCtx = {
  id: number; kind: string; severity: number; occurred_at: string;
  summary: string; lat: number | null; lon: number | null; meta: Record<string, unknown> | null;
};

export async function parkContext(parkId: string, hours = 24) {
  const [park] = (await sql`SELECT * FROM parks WHERE id = ${parkId}`) as Park[];
  if (!park) throw new Error(`unknown park ${parkId}`);

  const events = (await sql`
    SELECT id, kind, severity, occurred_at, summary, lat, lon, meta
    FROM events WHERE park_id = ${parkId} AND occurred_at > now() - (${hours} || ' hours')::interval
    ORDER BY occurred_at DESC`) as EventCtx[];

  const [fires, weather] = await Promise.all([firesNear(park), weatherAt(park.center_lat, park.center_lon)]);
  const zones = zonesOf(park);

  // Which named zone is each event in (or nearest to)?
  const zoneOf = (e: EventCtx) => {
    if (e.lat == null || e.lon == null || !zones.length) return null;
    let best: { name: string; km: number } | null = null;
    for (const z of zones) {
      const c = z.ring.reduce((a, [lon, lat]) => ({ lat: a.lat + lat / z.ring.length, lon: a.lon + lon / z.ring.length }), { lat: 0, lon: 0 });
      const km = haversineKm({ lat: e.lat, lon: e.lon }, c);
      if (!best || km < best.km) best = { name: z.name, km };
    }
    return best?.name ?? null;
  };

  const high = events.filter((e) => e.severity >= 4);
  const low = events.filter((e) => e.severity < 4);
  const counts = low.reduce<Record<string, number>>((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + 1 }), {});
  const species = low
    .map((e) => e.summary.replace(/^\d+\s+/, "").split(" on ")[0])
    .reduce<Record<string, number>>((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {});

  return { park, zones, events, high, low, counts, species, fires, weather, zoneOf, hours };
}

export function contextBlock(c: Awaited<ReturnType<typeof parkContext>>) {
  const t = (s: string) => new Date(s).toISOString().slice(11, 16);
  const lines: string[] = [];

  lines.push(`PARK: ${c.park.name}, ${c.park.country}`);
  if (c.zones.length) lines.push(`NAMED ZONES: ${c.zones.map((z) => z.name).join(", ")}`);
  lines.push(`WINDOW: last ${c.hours} hours, ending ${new Date().toISOString().slice(0, 16)}Z`);

  if (c.weather) {
    lines.push(`WEATHER: ${c.weather.temp_c}C, ${c.weather.humidity}% humidity, wind pushing ${c.weather.wind_to} at ${c.weather.wind_kmh} km/h`);
  }

  const inside = c.fires.filter((f) => f.inside);
  if (c.fires.length) {
    lines.push(`FIRE DETECTIONS (NASA FIRMS satellite): ${inside.length} inside the boundary, ${c.fires.length - inside.length} within 25 km`);
    for (const f of c.fires.slice(0, 6)) {
      lines.push(`  - ${f.acq_date} ${f.acq_time.slice(0, 2)}:${f.acq_time.slice(2)}Z, ${f.frp} MW, ${f.inside ? "inside" : "outside"} boundary` +
        (f.nearest_zone ? `, ${f.nearest_zone.km} km from ${f.nearest_zone.name}` : ""));
    }
  } else {
    lines.push("FIRE DETECTIONS: none inside or within 25 km");
  }

  if (c.high.length) {
    lines.push(`HIGH-PRIORITY SENSOR EVENTS (${c.high.length}):`);
    for (const e of c.high) {
      const z = c.zoneOf(e);
      lines.push(`  - id=${e.id} ${t(e.occurred_at)}Z sev${e.severity} ${e.kind}: ${e.summary}${z ? ` [zone: ${z}]` : ""}`);
    }
  } else {
    lines.push("HIGH-PRIORITY SENSOR EVENTS: none");
  }

  const sp = Object.entries(c.species).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (sp.length) lines.push(`ROUTINE WILDLIFE (${c.low.length} detections): ${sp.map(([s, n]) => `${s} x${n}`).join(", ")}`);

  return lines.join("\n");
}

const SYSTEM = `You write operational briefings for protected-area rangers.
You are given ONLY verified detections from satellite, camera and acoustic sensors.

Absolute rules:
- Use only the facts in the context. Never invent a detection, a patrol, a schedule, or a number.
- You may state wind direction. You must NEVER predict where a fire will spread or when it
  will arrive - no fire-spread modelling exists in this system.
- Camera and acoustic detections are machine classifications and can be wrong. Say "reported"
  or "classified as", not "confirmed", unless two independent sensors agree.
- If two or more signals coincide in time and place, say so explicitly and name the event ids.
- Recommendations are suggestions to check something, never orders or scheduled patrols.
- Be terse. A ranger reads this on a phone at dawn.`;

export async function generateBriefing(parkId: string) {
  const c = await parkContext(parkId, 24);
  const prompt = `${contextBlock(c)}

Write the morning briefing in markdown, at most 200 words, with exactly these sections:

## Situation
One or two sentences: the overall state of the park right now.

## Priority
The single most important thing. Reference event ids.

Ranking is not a judgement call - follow it exactly:
1. Any gunshot or chainsaw/handsaw detection. Someone is shooting or cutting. These ALWAYS
   lead, no matter how few there are or how many routine events surround them.
2. A person on foot away from roads.
3. Fire inside the boundary.
4. Vehicles, only if several cluster in one place or coincide with a level-1 signal.
Write "Nothing requiring attention" ONLY when none of 1-4 is present. Three gunshots among a
hundred wildlife photos is still three gunshots - volume of routine data never outranks a
level-1 signal.

If several signals coincide in time and place, state the combined interpretation and how
confident it is. Note when a vehicle is likely park maintenance rather than an intrusion.

## Also noted
Two or three short bullets covering everything else worth knowing, including routine wildlife.

## Suggested checks
One to three bullets. Each names a specific place. Phrase as suggestions.`;

  const content = await reason(prompt, { system: SYSTEM, temperature: 0.3 });
  const [row] = (await sql`
    INSERT INTO briefings (park_id, content_md) VALUES (${parkId}, ${content})
    RETURNING id, content_md, created_at`) as { id: number; content_md: string; created_at: string }[];
  return row;
}
