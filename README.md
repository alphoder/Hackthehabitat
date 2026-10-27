# Sentinel

**An AI operations center for every protected area on Earth.**

There is roughly one ranger per 1,000 km² of protected land. The data to catch fires, logging
and poaching already exists — satellite fire detections, camera traps, acoustic sensors — but
it sits in silos, unwatched, and produces no action. Sentinel watches all of it, investigates
what matters, and acts: it writes the morning briefing, calls the ranger by voice, and compiles
the evidence packet.

---

## What is real, and what is not

This is the honest part, stated up front because a conservation tool that overstates itself is
worse than none.

| Layer | Status |
|---|---|
| Fire detections | **Live.** NASA FIRMS VIIRS S-NPP, refreshed hourly. 13,334 detections worldwide in the 24h this was built. |
| Weather | **Live.** Open-Meteo, per park centroid. |
| Species baseline | **Live.** GBIF occurrence records per park bounding box. |
| Satellite imagery | **Live.** NASA GIBS true colour (250 m/px). |
| Camera-trap images | **Real data, simulated delivery.** 132 labelled ENA24 images (LILA BC) replayed as if cameras were uploading them. |
| Acoustic recordings | **Real data, simulated delivery.** 30 ESC-50 field recordings replayed as if acoustic stations were uploading them. |
| Park boundaries | **Approximate.** 156 curated parks as centroid + radius; 3 featured parks have hand-drawn polygons and named zones. Not official WDPA geometry. |

There is no public live feed from any park's cameras or acoustic sensors, so those are replayed.
The detections on them are genuine model output on genuine field recordings — nothing is scripted.
The UI labels these feeds "field simulation — real data replay" wherever they appear.

**Never claimed:** fire-spread prediction (we report wind direction only), patrol schedules,
staffing, arrests, or any accuracy number we did not measure.

---

## The hovering agent

A dock on every page holds one Gemini Live session and can both answer from the database and
**operate the dashboard**. Tools split by what they need:

| Runs in the browser | Runs on the server |
|---|---|
| `navigate` — move between globe, park, backtest, dossier | `get_global_summary`, `find_park`, `get_park_status` |
| `read_view` — read what is on screen aloud | `get_recent_events`, `search_record`, `read_briefing`, `get_backtest` |
| `scroll_to` — bring a named panel into view | `write_briefing`, `build_dossier`, `refresh_fires` |

The dock lives in the root layout, so client-side navigation does **not** tear down the session —
the agent keeps talking while the page changes under it. It accepts typed input as well as voice,
which doubles as the on-stage fallback if a microphone misbehaves.

Verified end to end in production: *"Which park is worst hit right now? Take me there."* →
`get_global_summary` → `navigate` → page moves to Niassa Reserve → spoken answer. Then
*"Read the threat picture on this page to me"* → `read_view` → it reads the real numbers back,
expanding "ESE" to "East-Southeast" for speech.

The agent holds no data of its own. Every factual claim comes back through a tool.

---

## Performance

Three fixes took the deployed app from sluggish to instant. Measured on the production URL:

| Page | Before | After |
|---|---|---|
| Globe | 6,062–7,023 ms | **444–459 ms** |
| Park mission control | 869–1,528 ms | **309–563 ms** |
| Backtest | — | **202–220 ms** |

1. **Row count, not query cost, was the bottleneck.** Neon's HTTP SQL API costs roughly half a
   millisecond *per row* and degrades badly past a few thousand. Fetching a day of fires
   row-by-row took **24.8 s for 6,688 rows**; the same aggregation packed into a single row
   with `string_agg` takes **546 ms for 99 KB** — a 45× improvement. The `GROUP BY` itself was
   only 846 ms all along.
2. **Fewer round trips.** The park page made seven separate calls to a database in another
   country. Sensors, events and the latest briefing now come back as one JSON row, and incident
   clustering runs on rows already in memory instead of re-querying.
3. **Colocation and polling hygiene.** Functions now run in `sin1`, the same region as the
   database. Two independent pollers became one, at 10 s, paused while the tab is hidden.

A local-dev caveat worth knowing: from a home connection to Neon's Singapore region, the same
pages measure 3–19 s with wild variance. That is link instability, not the app — production is
consistently sub-second because Vercel sits next to the database.

---

## Measured performance

Every number below comes from a runnable check in `scripts/`. No number in the demo is estimated.

### Acoustic detection — `scripts/check-audio.ts`
30 ESC-50 clips, `gemini-3.1-flash-lite`:

- **73%** exact label accuracy across 9 classes
- **17/18** threat clips escalated (chainsaw 5/6, handsaw 2/3, vehicle 4/4, gunshot 3/4)
- **2/12** false alarms on non-threat clips — one wind heard as a vehicle, one rain as a chainsaw
- 23/30 clips returned a within-clip timestamp

Known weakness: a steady-pitch chainsaw reads as a vehicle; heavy weather can trip a machine label.

### Camera-trap vision — `scripts/check-vision.ts`
132 labelled ENA24 images in **11 API calls** (12 images per call):

- **95%** category accuracy (126/132)
- **86%** species identification (100/116, head-noun match)
- **16/16** vehicle intrusions caught, **0** downgraded to wildlife or blank
- 5 false blanks (subject present, frame called empty — all night frames)

Weakest classes: wild turkey 60% (read as guinea fowl), bird 63%, bobcat 70%.
ENA24's `Human` images are withheld by LILA for privacy, so **human-detection accuracy is
unmeasured** and is never claimed.

### Satellite change detection — `scripts/check-satdiff.ts` — **experimental**
At 250 m/px over a 160 km scene, burn scars were **not** reliably separable from dry-season
browning. The model declined to over-claim and correctly reported identical images as identical
(null control passed, confidence 1.0). Shipped labelled experimental. A real version needs
Sentinel-2 (10 m) or a burned-area product, not true colour.

### Backtest — `scripts/backtest.ts`
60 days of FIRMS archive over Pantanal Matogrossense, May–July 2024:

- Quiet baseline through May, then **6 detections (13 June) → 72 (14 June)** in 24 hours
- Total radiative power jumped **29 MW → 3,693 MW**, a 125× increase
- Season peak 15 June at 123 detections

A threshold watch escalates on the day of onset. This is detection, not response — it says
nothing about whether anyone acted.

---

## Quota discipline

Two Gemini pools of 500 requests/day at 15 RPM. The architecture is built around that limit.

| Job | Model | Technique |
|---|---|---|
| Camera images | `gemini-3.1-flash-lite` | **12 images per request** — 132 images cost 11 calls |
| Audio | `gemini-3.1-flash-lite` | one call per clip |
| Briefing / chat / dossier | `gemini-3.5-flash-lite` | one call each, separate pool |
| Voice | `gemini-3.1-flash-live-preview` | unlimited, no quota impact |

**Nothing is ever classified twice.** `media.sha256` is the cache key; a stored detection means
the file is never sent again. Events are rebuilt *from stored detections*, so the entire
operational picture can be regenerated for **zero API calls** — verified: re-running the full
ingest reports `Gemini calls spent this run: {}`.

The planetary triage layer — 13,334 fires intersected against 156 parks — costs **zero** calls.
It is point-in-circle geometry. AI is spent only on the parks that geometry flags.

---

## Pages

| Route | What it is | Who it is for |
|---|---|---|
| `/` | Landing page: the problem, the four-step flow, real detections with real verdicts, the honesty table, measured results | A first-time visitor or judge |
| `/globe` | Every fire on Earth now, protected areas ranked worst-first | Anyone triaging |
| `/park/[id]` | Map, sensors, live feed, AI briefing, question box, cases. Opens with a plain-language "How to read this page" key | Park manager |
| `/dossier/[id]` | Printable evidence packet | Investigator |
| `/backtest` | The 2024 Pantanal replay | Anyone asking "does it work" |
| `/voice-check` | Live API diagnostics with every step printed | Anyone asking "is the voice real" |

Design context lives in `PRODUCT.md` (who and why) and `DESIGN.md` (the visual system: dark
single theme, IBM Plex pairing, restrained emerald accent, semantic red and amber).

Copy standard: plain language first, technical term second. A reader with no conservation or GIS
background should not meet an unexplained term. `MW` is captioned as heat output, severity dots
have a visible legend, and "field simulation" is spelled out wherever it appears.

## Architecture

```
app/                      / (landing) · /globe · /park/[id] · /dossier/[id] · /backtest · /voice-check
app/api/                  global summary · park detail · ingest · briefing · chat · incidents · dossier · voice tools · media
lib/db.ts                 Neon client + types
lib/geo.ts                haversine, point-in-polygon, distance-to-ring (self-checking)
lib/firms.ts              NASA FIRMS fetch, park matching, bulk upsert
lib/park.ts               fires-near-park, weather, GBIF species
lib/gemini.ts             THE only Gemini entry point — per-model queue, ≥4.2s spacing, call counter
lib/brief.ts              context assembly + briefing generation
lib/chat.ts               SQL retrieval + grounded answering
lib/incident.ts           clustering + evidence dossier
lib/satellite.ts          NASA GIBS tiles
scripts/                  migrate · seed-parks · ingest-fires · fetch-audio · fetch-images
                          ingest-media · field-sim · backtest · check-audio · check-vision · check-satdiff
```

Bulk work runs as local `tsx` scripts writing to Neon; API routes only read and do single-call
generations, so nothing can hit a serverless timeout.

## Setup

```bash
npm install
cp .env.local.example .env.local     # add GEMINI_API_KEY, FIRMS_MAP_KEY, DATABASE_URL
npm run s scripts/migrate.ts
npm run s scripts/seed-parks.ts
npm run s scripts/ingest-fires.ts    # live global fires
npm run s scripts/fetch-audio.ts     # ESC-50 subset
npm run s scripts/fetch-images.ts    # ENA24 subset
npm run s scripts/ingest-media.ts    # classify (cached — safe to re-run)
npm run dev
```

Verification checks:

```bash
npx tsx lib/geo.ts                   # geometry self-check
npm run s scripts/check-audio.ts     # acoustic accuracy
npm run s scripts/check-vision.ts    # vision accuracy
npm run s scripts/backtest.ts        # Pantanal 2024 replay
```

Demo helpers:

```bash
npm run s scripts/field-sim.ts --incident   # stage a fused incident
npm run s scripts/field-sim.ts --every=6    # steady live replay
```

## Known limitations

- Camera and acoustic feeds are replayed, not live — no public park sensor stream exists.
- Boundaries are radius approximations for 153 of 156 parks; detections just outside a real
  park may be counted and some just inside missed.
- Satellite change detection is experimental and currently cannot support a deforestation claim.
- Human-detection accuracy is unmeasured (source images withheld for privacy).
- Vehicle detections are severity 3, not an alarm: most vehicles on park cameras are maintenance.
  Treating them as poaching would be a fabricated threat.
- Acoustic false alarms run about 2 in 12 on non-threat clips. A deployment should require a
  second corroborating detection before escalating.
