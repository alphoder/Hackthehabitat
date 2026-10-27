import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Downloads a labelled subset of ESC-50 (real field recordings, CC BY-NC).
// npm run s scripts/fetch-audio.ts

const REPO = "https://raw.githubusercontent.com/karoldvl/ESC-50/master";

// ESC-50 class -> what Sentinel should call it. Positives first, then the negatives
// that matter most: forest ambience the detector must NOT flag as a threat.
const WANT: Record<string, { truth: string; n: number }> = {
  chainsaw: { truth: "chainsaw", n: 6 },
  hand_saw: { truth: "handsaw", n: 3 },         // manual sawing — logging too, but a distinct sound
  engine: { truth: "vehicle", n: 4 },
  fireworks: { truth: "gunshot", n: 4 },        // ESC-50 has no gunshot class; closest impulsive analogue
  chirping_birds: { truth: "animal", n: 3 },    // wildlife vocalisation, not silence
  insects: { truth: "animal", n: 2 },
  rain: { truth: "rain", n: 3 },
  wind: { truth: "wind", n: 2 },
  crackling_fire: { truth: "ambient", n: 2 },
  footsteps: { truth: "human_voice", n: 1 },   // human presence
};

async function main() {
  await mkdir("public/media/audio", { recursive: true });

  const csv = await (await fetch(`${REPO}/meta/esc50.csv`)).text();
  const lines = csv.trim().split("\n").slice(1);
  const byCat = new Map<string, string[]>();
  for (const line of lines) {
    const c = line.split(",");
    const [filename, , , category] = [c[0], c[1], c[2], c[3]];
    if (!WANT[category]) continue;
    if (!byCat.has(category)) byCat.set(category, []);
    byCat.get(category)!.push(filename);
  }

  const manifest: { file: string; truth: string; esc50_category: string }[] = [];
  for (const [category, { truth, n }] of Object.entries(WANT)) {
    const files = (byCat.get(category) ?? []).slice(0, n);
    if (!files.length) console.warn(`no files found for ${category}`);
    for (const f of files) {
      const dest = `public/media/audio/${f}`;
      if (!existsSync(dest)) {
        const res = await fetch(`${REPO}/audio/${f}`);
        if (!res.ok) { console.warn(`skip ${f}: ${res.status}`); continue; }
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        process.stdout.write(".");
      }
      manifest.push({ file: dest, truth, esc50_category: category });
    }
  }

  await writeFile("data/audio-manifest.json", JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} clips in public/media/audio/, manifest written`);
  const counts = manifest.reduce<Record<string, number>>((a, m) => ({ ...a, [m.truth]: (a[m.truth] ?? 0) + 1 }), {});
  console.table(counts);
}

main();
