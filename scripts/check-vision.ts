import { readFile, writeFile } from "node:fs/promises";
import { classifyImages, callCount, type ImageVerdict } from "../lib/gemini";

// GATING CHECK for camera-trap vision. npm run s scripts/check-vision.ts
// Batches 12 images per Gemini call — the batching is what keeps 132 images inside quota.
//
// MEASURED RESULT (2026-08-15, gemini-3.1-flash-lite, 132 ENA24 images, 11 calls):
//   category accuracy    95% (126/132)
//   species (head noun)  86% (100/116)
//   vehicle intrusions   16/16 caught, 0 downgraded to wildlife or blank
//   false blanks          5/132 (subject present but frame called empty — all night frames)
// Weakest classes: Wild Turkey 60% (read as guinea fowl), Bird 63%, Bobcat 70%.
// Full per-image record in data/vision-results.json.
//
// NOTE: ENA24's `Human` images are withheld by LILA for privacy (all 404), so human-intrusion
// accuracy is UNMEASURED. Vehicle intrusion is measured. Never claim a human-detection number.

type Manifest = { file: string; truth: string; source_id: string }[];
const BATCH = 12;

const norm = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").replace(/[^a-z ]/g, "").trim();
const headNoun = (s: string) => norm(s).split(" ").filter(Boolean).pop() ?? "";

/** What category should the ground-truth label map to? */
function truthCategory(truth: string): string {
  if (truth === "Vehicle") return "vehicle";
  if (truth === "Human") return "human";
  return "animal";
}

async function main() {
  const manifest = JSON.parse(await readFile("data/image-manifest.json", "utf8")) as Manifest;
  const scored: { file: string; truth: string; predicted: string; category: string; confidence: number; count: number; note: string }[] = [];

  for (let i = 0; i < manifest.length; i += BATCH) {
    const batch = manifest.slice(i, i + BATCH);
    const images = await Promise.all(
      batch.map(async (m) => ({ mimeType: "image/jpeg", data: (await readFile(m.file)).toString("base64") }))
    );
    let verdicts: ImageVerdict[] = [];
    try {
      verdicts = await classifyImages(images);
    } catch (e) {
      console.error(`batch ${i / BATCH} failed:`, (e as Error).message.slice(0, 120));
    }
    batch.forEach((m, j) => {
      const v = verdicts.find((x) => x.index === j) ?? verdicts[j];
      scored.push({
        file: m.file, truth: m.truth,
        predicted: v?.label ?? "(none)", category: v?.category ?? "(none)",
        confidence: v?.confidence ?? 0, count: v?.count ?? 0, note: v?.note ?? "",
      });
    });
    process.stdout.write(`batch ${i / BATCH + 1}/${Math.ceil(manifest.length / BATCH)} (${verdicts.length}/${batch.length} returned)\n`);
  }

  const catOk = scored.filter((s) => s.category === truthCategory(s.truth)).length;
  const speciesRows = scored.filter((s) => truthCategory(s.truth) === "animal");
  const speciesOk = speciesRows.filter((s) => norm(s.predicted).includes(headNoun(s.truth))).length;
  const vehicleRows = scored.filter((s) => s.truth === "Vehicle");
  const vehicleOk = vehicleRows.filter((s) => s.category === "vehicle").length;
  // A vehicle called wildlife is the dangerous error: an intrusion silently downgraded.
  const missedIntrusions = vehicleRows.filter((s) => s.category === "animal" || s.category === "blank").length;
  const falseBlanks = scored.filter((s) => s.category === "blank").length;

  console.log("\n=== MEASURED ===");
  console.log(`category accuracy      : ${catOk}/${scored.length} (${((catOk / scored.length) * 100).toFixed(0)}%)`);
  console.log(`species (head noun)    : ${speciesOk}/${speciesRows.length} (${((speciesOk / speciesRows.length) * 100).toFixed(0)}%)`);
  console.log(`vehicle intrusions     : ${vehicleOk}/${vehicleRows.length} caught, ${missedIntrusions} downgraded to wildlife/blank`);
  console.log(`frames called blank    : ${falseBlanks}/${scored.length} (all frames here contain a subject, so these are misses)`);

  const perClass: Record<string, { n: number; ok: number }> = {};
  for (const s of scored) {
    perClass[s.truth] ??= { n: 0, ok: 0 };
    perClass[s.truth].n++;
    const ok = truthCategory(s.truth) === "animal"
      ? norm(s.predicted).includes(headNoun(s.truth))
      : s.category === truthCategory(s.truth);
    if (ok) perClass[s.truth].ok++;
  }
  console.table(Object.entries(perClass).map(([truth, v]) => ({ truth, n: v.n, ok: v.ok, pct: `${((v.ok / v.n) * 100).toFixed(0)}%` })));

  console.log("misses:");
  for (const s of scored) {
    const ok = truthCategory(s.truth) === "animal"
      ? norm(s.predicted).includes(headNoun(s.truth))
      : s.category === truthCategory(s.truth);
    if (!ok) console.log(`  ${s.truth.padEnd(24)} -> ${s.predicted.padEnd(22)} [${s.category}] "${s.note}"`);
  }
  console.log(`\nBULK calls spent: ${JSON.stringify(callCount)} for ${scored.length} images`);

  await writeFile("data/vision-results.json", JSON.stringify({
    model: process.env.GEMINI_MODEL_BULK, measured_at: new Date().toISOString(),
    total: scored.length, catOk, speciesOk, speciesTotal: speciesRows.length,
    vehicleOk, vehicleTotal: vehicleRows.length, calls: callCount, scored,
  }, null, 2));
}

main();
