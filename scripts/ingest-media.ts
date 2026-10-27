import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sql } from "../lib/db";
import { classifyAudio, classifyImages, callCount, MODEL, type ImageVerdict } from "../lib/gemini";

// Classifies field media into detections + events. Idempotent and resumable:
// media.sha256 is the cache key, and a media+model row in `detections` means we NEVER pay again.
// npm run s scripts/ingest-media.ts [--park=great-smoky] [--limit=N] [--images] [--audio]

const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const PARK = arg("park", "great-smoky")!;
const LIMIT = Number(arg("limit", "999"));
const ONLY = { images: process.argv.includes("--images"), audio: process.argv.includes("--audio") };
const doImages = ONLY.images || !ONLY.audio;
const doAudio = ONLY.audio || !ONLY.images;
const BATCH = 12;

type MediaPlan = { file: string; sensorId: string; capturedAt: Date; truth: string | null; kind: "image" | "audio" };

/** Severity ladder.
 *  5 = cutting or shooting heard — the signals that mean someone is destroying or killing.
 *  4 = a person on foot where none should be.
 *  3 = a vehicle. Deliberately NOT 5: most vehicles seen on park cameras are maintenance
 *      (tractors, mowers, excavators on service roads). Flagging those as poaching would be
 *      a fabricated threat. A vehicle matters as corroboration, not as an alarm on its own.
 *  2 = wildlife, the routine business of a working park.
 */
function classify(category: string, label: string): { kind: string; severity: number } | null {
  const l = label.toLowerCase();
  if (category === "vehicle") return { kind: "vehicle", severity: 3 };
  if (category === "human") return { kind: "human", severity: 4 };
  if (l.includes("chainsaw") || l.includes("handsaw")) return { kind: "chainsaw", severity: 5 };
  if (l.includes("gunshot")) return { kind: "gunshot", severity: 5 };
  if (l === "human_voice") return { kind: "human", severity: 4 };
  if (category === "animal" || l === "animal") return { kind: "animal", severity: 2 };
  return null; // blank frames and weather are recorded as detections but raise no event
}

type Cached = { label: string; confidence: number; meta: Record<string, unknown> | null };

async function upsertMedia(p: MediaPlan): Promise<{ id: number; cached: Cached | null; data: string; mime: string }> {
  const buf = await readFile(p.file);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const mime = p.kind === "image" ? "image/jpeg" : "audio/wav";

  const existing = (await sql`SELECT id FROM media WHERE sha256 = ${sha256}`) as { id: number }[];
  let id: number;
  if (existing.length) {
    id = existing[0].id;
  } else {
    const [row] = (await sql`
      INSERT INTO media (sensor_id, kind, path, captured_at, sha256, truth_label)
      VALUES (${p.sensorId}, ${p.kind}, ${p.file}, ${p.capturedAt.toISOString()}, ${sha256}, ${p.truth})
      RETURNING id`) as { id: number }[];
    id = row.id;
  }

  // A stored detection means we never pay Gemini for this file again. Events are still
  // rebuilt from it, so the operational picture can be regenerated for free.
  const done = (await sql`
    SELECT label, confidence, meta FROM detections
    WHERE media_id = ${id} AND model = ${MODEL.bulk}`) as Cached[];
  return { id, cached: done[0] ?? null, data: buf.toString("base64"), mime };
}

async function saveDetection(mediaId: number, label: string, confidence: number, meta: object) {
  await sql`
    INSERT INTO detections (media_id, label, confidence, model, meta)
    VALUES (${mediaId}, ${label}, ${confidence}, ${MODEL.bulk}, ${JSON.stringify(meta)})
    ON CONFLICT (media_id, model) DO NOTHING`;
}

async function raiseEvent(p: MediaPlan, mediaId: number, sensor: { lat: number; lon: number; name: string }, kind: string, severity: number, summary: string, meta: object) {
  // One event per media item — re-running the ingest must not multiply the feed.
  await sql`DELETE FROM events WHERE media_id = ${mediaId}`;
  await sql`
    INSERT INTO events (park_id, kind, severity, lat, lon, occurred_at, summary, media_id, meta)
    VALUES (${PARK}, ${kind}, ${severity}, ${sensor.lat}, ${sensor.lon}, ${p.capturedAt.toISOString()}, ${summary}, ${mediaId}, ${JSON.stringify(meta)})`;
}

async function main() {
  const sensors = (await sql`SELECT id, kind, name, lat, lon FROM sensors WHERE park_id = ${PARK}`) as
    { id: string; kind: string; name: string; lat: number; lon: number }[];
  if (!sensors.length) throw new Error(`no sensors seeded for park ${PARK}`);
  const cams = sensors.filter((s) => s.kind === "camera");
  const acos = sensors.filter((s) => s.kind === "acoustic");
  const byId = new Map(sensors.map((s) => [s.id, s]));

  const plans: MediaPlan[] = [];
  const now = Date.now();

  if (doImages && existsSync("data/image-manifest.json")) {
    const m = JSON.parse(await readFile("data/image-manifest.json", "utf8")) as { file: string; truth: string }[];
    m.slice(0, LIMIT).forEach((x, i) => {
      // spread across cameras and across the last 48h, weighted to night hours
      const hoursAgo = (i % 48) + (i % 7) / 7;
      plans.push({
        file: x.file, kind: "image", truth: x.truth,
        sensorId: cams[i % cams.length].id,
        capturedAt: new Date(now - hoursAgo * 3600_000),
      });
    });
  }

  if (doAudio && existsSync("data/audio-manifest.json")) {
    const m = JSON.parse(await readFile("data/audio-manifest.json", "utf8")) as { file: string; truth: string }[];

    // The audio manifest is deliberately threat-heavy so accuracy is measurable. Replaying all
    // of it into a park would imply constant illegal logging, which is not what a real 48 hours
    // sounds like. Sample a realistic mix instead: mostly quiet, a couple of genuine incidents.
    // --all-audio replays everything (used for measurement, not for the operational picture).
    const REALISTIC: Record<string, number> = { chainsaw: 2, gunshot: 2, handsaw: 0, vehicle: 1, human_voice: 1, animal: 4, rain: 2, wind: 2, ambient: 2 };
    const picked = process.argv.includes("--all-audio")
      ? m
      : Object.entries(REALISTIC).flatMap(([truth, n]) => m.filter((x) => x.truth === truth).slice(0, n));

    // Distinct offsets so nothing collides by accident — a genuine coincidence must be staged
    // deliberately (field-sim --incident), never manufactured by the scheduler.
    const THREAT_HOURS = [3.5, 9.8, 16.4, 22.1, 29.6, 35.2];
    let threatN = 0;
    picked.slice(0, LIMIT).forEach((x, i) => {
      const isThreat = x.truth === "chainsaw" || x.truth === "gunshot";
      const hoursAgo = isThreat ? THREAT_HOURS[threatN++ % THREAT_HOURS.length] : ((i * 3.7) % 44) + 1.3;
      plans.push({
        file: x.file, kind: "audio", truth: x.truth,
        sensorId: acos[(isThreat ? threatN : i) % acos.length].id,
        capturedAt: new Date(now - hoursAgo * 3600_000),
      });
    });
  }

  console.log(`${plans.length} media items planned for ${PARK}`);

  // ---- images, batched ----
  const imagePlans = plans.filter((p) => p.kind === "image");
  const pending: { plan: MediaPlan; id: number; data: string; mime: string }[] = [];
  let cachedCount = 0;

  for (const p of imagePlans) {
    const m = await upsertMedia(p);
    if (m.cached) {
      cachedCount++;
      const cat = String(m.cached.meta?.category ?? "");
      const ev = classify(cat, m.cached.label);
      if (ev) {
        const s = byId.get(p.sensorId)!;
        const note = String(m.cached.meta?.note ?? "");
        const count = Number(m.cached.meta?.count ?? 1) || 1;
        const summary = ev.kind === "animal"
          ? `${count} ${m.cached.label} on ${s.name}`
          : `${m.cached.label} detected on ${s.name} — ${note}`;
        await raiseEvent(p, m.id, s, ev.kind, ev.severity, summary, { source: "camera", confidence: m.cached.confidence, note });
      }
      continue;
    }
    pending.push({ plan: p, id: m.id, data: m.data, mime: m.mime });
  }
  console.log(`images: ${cachedCount} cached (free), ${pending.length} to classify`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let verdicts: ImageVerdict[] = [];
    try {
      verdicts = await classifyImages(batch.map((b) => ({ mimeType: b.mime, data: b.data })));
    } catch (e) {
      console.error(`  batch failed, will resume on next run: ${(e as Error).message.slice(0, 100)}`);
      continue; // DB is the checkpoint — nothing written, so a re-run retries exactly this batch
    }
    for (const [j, b] of batch.entries()) {
      const v = verdicts.find((x) => x.index === j) ?? verdicts[j];
      if (!v) continue;
      await saveDetection(b.id, v.label, v.confidence, { category: v.category, count: v.count, note: v.note });
      const ev = classify(v.category, v.label);
      if (ev) {
        const s = byId.get(b.plan.sensorId)!;
        const summary = ev.kind === "animal"
          ? `${v.count || 1} ${v.label} on ${s.name}`
          : `${v.label} detected on ${s.name} — ${v.note}`;
        await raiseEvent(b.plan, b.id, s, ev.kind, ev.severity, summary, { source: "camera", confidence: v.confidence, note: v.note });
      }
    }
    process.stdout.write(`  images ${Math.min(i + BATCH, pending.length)}/${pending.length}\n`);
  }

  // ---- audio, one call each ----
  const audioPlans = plans.filter((p) => p.kind === "audio");
  let audioCached = 0, audioDone = 0;
  const emitAudio = async (p: MediaPlan, mediaId: number, label: string, confidence: number, timestamp_s: number | null, note: string) => {
    const ev = classify("audio", label);
    if (!ev) return;
    const s = byId.get(p.sensorId)!;
    const at = timestamp_s !== null ? ` at +${timestamp_s}s into the clip` : "";
    await raiseEvent(p, mediaId, s, ev.kind, ev.severity, `${label} heard on ${s.name}${at} — ${note}`, {
      source: "acoustic", confidence, timestamp_s, note,
    });
  };

  for (const p of audioPlans) {
    const m = await upsertMedia(p);
    if (m.cached) {
      audioCached++;
      await emitAudio(p, m.id, m.cached.label, m.cached.confidence,
        (m.cached.meta?.timestamp_s as number | null) ?? null, String(m.cached.meta?.note ?? ""));
      continue;
    }
    try {
      const v = await classifyAudio({ mimeType: m.mime, data: m.data });
      await saveDetection(m.id, v.label, v.confidence, { timestamp_s: v.timestamp_s, note: v.note });
      await emitAudio(p, m.id, v.label, v.confidence, v.timestamp_s, v.note);
      audioDone++;
    } catch (e) {
      console.error(`  audio ${p.file} failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  console.log(`audio: ${audioCached} cached (free), ${audioDone} classified`);

  const [{ events }] = (await sql`SELECT count(*)::int AS events FROM events WHERE park_id = ${PARK}`) as { events: number }[];
  console.log(`\ntotal events for ${PARK}: ${events}`);
  console.log(`Gemini calls spent this run: ${JSON.stringify(callCount)}`);
  await writeFile("data/last-ingest.json", JSON.stringify({ park: PARK, at: new Date().toISOString(), calls: callCount }, null, 2));
}

main();
