import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Downloads a labelled subset of ENA24 (real camera-trap images, Eastern North America,
// CC BY 4.0 via LILA BC). Ground-truth labels come with it, so vision accuracy is measurable.
// npm run s scripts/fetch-images.ts

const BASE = "https://lilawildlife.blob.core.windows.net/lila-wildlife/ena24";

// Weighted toward the classes that matter operationally (human, vehicle) plus a
// realistic spread of wildlife the detector must not confuse with them.
const SAMPLE: Record<string, number> = {
  Human: 22,
  Vehicle: 16,
  "American Black Bear": 14,
  White_Tailed_Deer: 14,
  "Northern Raccoon": 10,
  "Red Fox": 10,
  Coyote: 10,
  Bobcat: 10,
  "Wild Turkey": 10,
  "Virginia Opossum": 10,
  "Eastern Gray Squirrel": 8,
  Bird: 8,
  Dog: 6,
  Horse: 6,
};

type Cat = { id: number; name: string };
type Img = { id: string; file_name: string };
type Ann = { image_id: string; category_id: number };

async function main() {
  await mkdir("public/media/images", { recursive: true });

  const metaPath = "data/ena24.json";
  if (!existsSync(metaPath)) {
    console.log("downloading ENA24 metadata (3.7 MB)…");
    const res = await fetch(`${BASE}/ena24.json`);
    await writeFile(metaPath, Buffer.from(await res.arrayBuffer()));
  }
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as { images: Img[]; annotations: Ann[]; categories: Cat[] };

  const catName = new Map(meta.categories.map((c) => [c.id, c.name]));
  const imgById = new Map(meta.images.map((i) => [i.id, i]));

  // Only keep images whose annotations all agree — a single unambiguous ground truth.
  const labels = new Map<string, Set<string>>();
  for (const a of meta.annotations) {
    const n = catName.get(a.category_id);
    if (!n) continue;
    if (!labels.has(a.image_id)) labels.set(a.image_id, new Set());
    labels.get(a.image_id)!.add(n);
  }

  const pools = new Map<string, string[]>();
  for (const [imageId, set] of labels) {
    if (set.size !== 1) continue;
    const only = [...set][0];
    if (!SAMPLE[only]) continue;
    if (!pools.has(only)) pools.set(only, []);
    pools.get(only)!.push(imageId);
  }

  const manifest: { file: string; truth: string; source_id: string }[] = [];
  let downloaded = 0;
  for (const [truth, want] of Object.entries(SAMPLE)) {
    const pool = pools.get(truth) ?? [];
    // spread across the pool rather than taking consecutive frames from one burst
    const step = Math.max(1, Math.floor(pool.length / want));
    const picked = Array.from({ length: Math.min(want, pool.length) }, (_, i) => pool[i * step]);
    if (picked.length < want) console.warn(`${truth}: only ${picked.length}/${want} available`);

    for (const imageId of picked) {
      const img = imgById.get(imageId);
      if (!img) continue;
      const dest = `public/media/images/${img.file_name.replace(/\//g, "_")}`;
      if (!existsSync(dest)) {
        const res = await fetch(`${BASE}/images/${img.file_name}`);
        if (!res.ok) { console.warn(`skip ${img.file_name}: ${res.status}`); continue; }
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        downloaded++;
        if (downloaded % 10 === 0) process.stdout.write(".");
      }
      manifest.push({ file: dest, truth, source_id: imageId });
    }
  }

  await writeFile("data/image-manifest.json", JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} images (${downloaded} newly downloaded)`);
  console.table(
    Object.entries(manifest.reduce<Record<string, number>>((a, m) => ({ ...a, [m.truth]: (a[m.truth] ?? 0) + 1 }), {}))
      .map(([truth, n]) => ({ truth, n }))
  );
}

main();
