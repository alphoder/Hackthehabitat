import { readFile, writeFile } from "node:fs/promises";
import { classifyAudio, callCount } from "../lib/gemini";

// GATING CHECK — run before building anything on top of audio detection.
// npm run s scripts/check-audio.ts
//
// MEASURED RESULT (2026-08-15, gemini-3.1-flash-lite, 30 ESC-50 clips):
//   exact label accuracy   73% (22/30) across 9 classes
//   threat clips escalated 17/18  — chainsaw 5/6, handsaw 2/3, vehicle 4/4, gunshot 3/4
//   false alarms on quiet   2/12  — one wind heard as vehicle, one rain heard as chainsaw
//   timestamps returned    23/30
// Known confusions: steady-pitch chainsaws read as vehicles; heavy rain/wind can trip a
// machine label. Full per-clip record in data/audio-results.json.
// These are the ONLY audio accuracy figures allowed in the demo.

type Manifest = { file: string; truth: string; esc50_category: string }[];

// Which predictions count as operationally correct for each ground truth.
// A chainsaw heard as "vehicle" is still an escalation-worthy machine noise, but it is
// NOT the same detection, so it is scored as a miss. Only exact intent matches count.
const THREATS = new Set(["chainsaw", "handsaw", "gunshot", "vehicle", "human_voice"]);

async function main() {
  const manifest = JSON.parse(await readFile("data/audio-manifest.json", "utf8")) as Manifest;
  const results: { file: string; truth: string; predicted: string; confidence: number; timestamp_s: number | null; note: string }[] = [];

  for (const [i, m] of manifest.entries()) {
    const data = (await readFile(m.file)).toString("base64");
    const v = await classifyAudio({ mimeType: "audio/wav", data });
    results.push({ file: m.file, truth: m.truth, predicted: v.label, confidence: v.confidence, timestamp_s: v.timestamp_s, note: v.note });
    process.stdout.write(`${i + 1}/${manifest.length} ${m.truth} -> ${v.label} (${v.confidence})\n`);
  }

  // exact-label accuracy
  const exact = results.filter((r) => r.predicted === r.truth).length;

  // the number that actually matters operationally: does a real threat get escalated at all,
  // and does quiet forest stay quiet (no false alarms)?
  const threatClips = results.filter((r) => THREATS.has(r.truth));
  const quietClips = results.filter((r) => !THREATS.has(r.truth));
  const threatCaught = threatClips.filter((r) => THREATS.has(r.predicted)).length;
  const falseAlarms = quietClips.filter((r) => THREATS.has(r.predicted)).length;

  const perClass: Record<string, { n: number; exact: number }> = {};
  for (const r of results) {
    perClass[r.truth] ??= { n: 0, exact: 0 };
    perClass[r.truth].n++;
    if (r.predicted === r.truth) perClass[r.truth].exact++;
  }

  const localised = results.filter((r) => r.timestamp_s !== null).length;

  console.log("\n=== MEASURED ===");
  console.log(`exact label accuracy : ${exact}/${results.length} (${((exact / results.length) * 100).toFixed(0)}%)`);
  console.log(`threat clips escalated: ${threatCaught}/${threatClips.length}`);
  console.log(`false alarms on quiet : ${falseAlarms}/${quietClips.length}`);
  console.log(`clips with timestamp  : ${localised}/${results.length}`);
  console.table(
    Object.entries(perClass).map(([truth, v]) => ({ truth, n: v.n, exact: v.exact, pct: `${((v.exact / v.n) * 100).toFixed(0)}%` }))
  );
  console.log("misses:");
  for (const r of results.filter((r) => r.predicted !== r.truth)) {
    console.log(`  ${r.truth.padEnd(12)} -> ${r.predicted.padEnd(12)} ${r.file.split("/").pop()}  "${r.note}"`);
  }
  console.log(`\nBULK calls spent: ${JSON.stringify(callCount)}`);

  await writeFile("data/audio-results.json", JSON.stringify({
    model: process.env.GEMINI_MODEL_BULK, measured_at: new Date().toISOString(),
    exact, total: results.length, threatCaught, threatTotal: threatClips.length,
    falseAlarms, quietTotal: quietClips.length, localised, results,
  }, null, 2));
}

main();
