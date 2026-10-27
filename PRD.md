# Sentinel — PRD

**One-liner:** An AI operations center for every protected area on Earth. Math triages the planet; Gemini investigates the suspects; a voice calls the ranger.

**Theme fit:** "Build tech that protects the planet" — real environmental data (NASA FIRMS, satellite, camera traps, acoustic sensors, GBIF), real conservation problem (~1 ranger per 1,000 km² of protected land), functional end-to-end system.

---

## 1. Problem

Protected areas are chronically under-watched. Fires, illegal logging, and poaching are detected late or never. The data to catch them exists — satellite fire detections, camera traps, acoustic sensors — but it's siloed, unmonitored, and produces no *action*: no alert, no fused picture, no enforcement paperwork.

## 2. Solution

Sentinel watches all protected areas simultaneously, investigates the critical ones with multimodal AI, and **acts**: it calls the ranger by voice, answers questions in conversation, and generates prosecution-ready evidence dossiers.

### The four uncatchable moves
1. **Planetary scale, zero AI cost** — one global NASA FIRMS query intersected with protected-area boundaries (pure math) ranks every park on Earth by fire threat. Gemini quota is spent only on the parks that matter.
2. **It acts, not shows** — outbound voice alert via Gemini Live API; auto-generated evidence dossier (timeline, map, imagery, audio, satellite diff, drafted authority report).
3. **Proof via back-test** — replay a real historical disaster (2024 Pantanal fires) through the same pipeline; show Sentinel escalates days before the news cycle.
4. **Audio sensing** — Gemini natively hears chainsaws, gunshots, vehicles in rainforest soundscapes. Poaching happens at night; sound doesn't need light.

### Honesty contract (stated in the demo)
- **Live:** fires (FIRMS), weather (Open-Meteo), satellite tiles (NASA GIBS), biodiversity (GBIF).
- **Real data, simulated delivery:** camera-trap images (LILA/Snapshot Serengeti) and audio clips (ESC-50 + rainforest recordings) are real, replayed as if field sensors were uploading them. This mirrors how an actual pilot would work.
- **Never claimed:** fire-spread modeling (we say "wind pushing NE", not "fire will spread NE"), patrol schedules, live park sensor feeds.

## 3. Users

- **Primary:** rangers / park operations staff (voice-first — they're in vehicles, not at desks).
- **Secondary:** conservation NGOs, forest departments (dossiers, analytics).
- **Demo audience:** hackathon judges.

## 4. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript), deployed on Vercel |
| DB | Neon Postgres (Vercel marketplace, free tier), raw SQL via `@neondatabase/serverless` — no ORM |
| AI | `@google/genai` JS SDK. Two quota pools (500 req/day, 15 RPM each): **`gemini-3.1-flash-lite`** = BULK (image/audio classification), **`gemini-3.5-flash-lite`** = REASON (briefings, chat, dossiers). **`gemini-3.1-flash-live-preview`** = voice (unlimited, 65k ctx), connected **directly from the browser** |
| Maps | `globe.gl` (3D planetary view, dynamic import ssr:false), `leaflet` (park detail map) |
| UI | Tailwind CSS, Chart.js for analytics |
| Ingest | Local `tsx` scripts (bulk image/audio processing, archive replay) writing to Neon — avoids serverless timeouts. Vercel Cron hits `/api/ingest/fires` hourly for live fires |
| Dossier | Styled HTML page + browser print-to-PDF (no PDF lib) |

## 5. Data sources (all free)

| Source | What | Access |
|---|---|---|
| NASA FIRMS | Live + archive fire detections (VIIRS/MODIS), global CSV | Free MAP_KEY, `api/area/csv/{KEY}/VIIRS_SNPP_NRT/world/1` |
| Protected areas | Boundaries | Curated JSON bundled in repo: ~200 major parks as centroid+radius for the globe layer; hand-drawn precise polygons + named zones for 2–3 featured parks. (Full WDPA is GBs — out of scope; noted honestly as "boundary approximations") |
| LILA BC / Snapshot Serengeti | Real labeled camera-trap images | Public download, subset of ~300–800 images |
| ESC-50 + freesound | Chainsaw, gunshot, engine, rain, ambience clips | GitHub / public |
| NASA GIBS | Satellite true-color tiles by date (before/after) | No key, WMTS |
| Open-Meteo | Wind, temp, humidity → fire-risk context | No key |
| GBIF | Species occurrence per park region | No key |

## 6. Gemini call budget (hard constraint: 2 × 500/day, 15 RPM)

| Job | Model | Technique | Est. calls |
|---|---|---|---|
| Camera images | BULK | **10–16 images per request**, JSON array response | ~60 for 800 imgs |
| Audio clips | BULK | 1/clip, ~30 curated clips | 30 |
| Satellite diff | BULK | 1 per before/after pair, ~5 pairs | 5 |
| Briefing | REASON | 1 per generation | ~10/day |
| Chat | REASON | 1 per message | ~30/day |
| Dossier | REASON | 2 per dossier | ~6/day |
| Voice | Live API | Unlimited | 0 quota |

**Rules:** every result is cached in Postgres — nothing is ever classified twice; demo re-runs cost ~0 calls. A shared rate-limiter enforces ≥4s spacing per model. Ingest scripts checkpoint so they resume after failures.

## 7. Core features

### F1 — Planetary triage (globe)
Landing page: 3D globe with today's real fire detections colored by whether they fall inside a protected area. Headline stat: "N protected areas currently have fire intrusions." Ranked top-10 list (detections count × proximity to core). Click → park mission control. **Zero Gemini calls.**

### F2 — Park mission control
Per-park page: Leaflet map with park polygon, named zones (e.g., "rhino corridor"), live fire markers with distance-to-zone, wind vector overlay, sensor markers (cameras/acoustic stations), event feed, analytics charts (species frequency, activity by hour, events by day).

### F3 — Sensor network (real data, simulated delivery)
"Field sim" script replays camera images and audio clips as timestamped sensor uploads. Gemini classifies: species/human/vehicle/blank for images; chainsaw/gunshot/vehicle/rain/ambient for audio. Detections land in the events table with geo + time + confidence + media reference.

### F4 — Fusion brain
- **Briefing:** REASON model reads last-24h events for a park → ranger morning briefing (threats ranked, cross-signal inferences like "chainsaw audio + vehicle on camera + fresh clearing = probable illegal logging op").
- **Chat:** natural-language questions → SQL-backed retrieval (geo/time filter) → grounded answer citing actual events.
- **Dossier:** one click on an incident → HTML evidence packet: timeline, map snapshot, media, satellite before/after, confidence assessment, drafted report addressed to the relevant authority. Print-to-PDF.

### F5 — Voice agent (Live API)
- **Inbound:** judge speaks to the park. Browser mic → Live API with function declarations (`get_events`, `get_fires`, `get_briefing`) that call our API routes → spoken grounded answers.
- **Outbound-style alert:** critical event triggers a ringing UI + auto-started Live session that speaks the alert first ("Fire detected 4 km from the rhino corridor, wind pushing northeast"), then takes questions.

### F6 — Back-test (credibility)
Replay FIRMS archive data for the June 2024 Pantanal fires through the same triage pipeline. Timeline view: Sentinel's escalation date vs. the date it hit international news. One event is enough.

## 8. Data model (Postgres)

```sql
parks(id, name, country, center_lat, center_lon, radius_km, polygon_geojson, zones_geojson, featured bool)
fires(id, park_id nullable, lat, lon, frp, acq_date, acq_time, satellite, source, ingested_at)   -- unique on (lat,lon,acq_date,acq_time,satellite)
sensors(id, park_id, kind camera|acoustic, name, lat, lon)
media(id, sensor_id, kind image|audio, url, captured_at, sha256 unique)                          -- sha256 = cache key
detections(id, media_id, label, confidence, meta jsonb, model, created_at)                       -- cache: one row per media per model
events(id, park_id, kind fire|animal|human|vehicle|chainsaw|gunshot|other, severity 1-5, lat, lon, occurred_at, summary, media_id nullable, meta jsonb)
briefings(id, park_id, content_md, created_at)
incidents(id, park_id, title, event_ids int[], dossier_html, created_at)
```

## 9. API routes

```
GET  /api/global/summary        globe data: fires + park intersections + top-10 ranking
GET  /api/parks/[id]            park detail: zones, sensors, recent events, fires w/ distances
POST /api/ingest/fires          FIRMS pull (Vercel Cron hourly; ?archive=YYYY-MM-DD for back-test)
POST /api/briefing/[parkId]     generate briefing (REASON)
POST /api/chat/[parkId]         grounded Q&A (REASON)
POST /api/dossier/[incidentId]  generate dossier (REASON)
GET  /api/voice/token + function-call endpoints for Live API tools
```
Local scripts (not deployed): `scripts/ingest-media.ts` (batch classify via BULK), `scripts/field-sim.ts` (replay as live uploads), `scripts/backtest.ts` (Pantanal archive).

## 10. Demo script (4 min)

1. Globe: "Right now, N protected areas have active fire intrusions" — live, checkable.
2. Click worst park → mission control assembles.
3. Field sim pushes a chainsaw clip → flagged at 02:41 → fused with camera vehicle detection → incident created.
4. **The phone rings.** Voice briefs the room. Judge asks: "what happened near the river this week?" — grounded spoken answer.
5. One click → evidence dossier renders.
6. Back-test slide: "Pantanal 2024 — Sentinel escalates June 4, news breaks June 9."

## 11. Success criteria

- Globe shows real same-day fires in real protected areas with zero AI spend.
- ≥300 real camera-trap images classified with accuracy measured against LILA labels (report the number).
- Audio detection verified on ≥20 clips; chainsaw/gunshot hit-rate reported.
- Voice round-trip (speak → function call → spoken grounded answer) works live.
- Full demo re-run consumes < 50 Gemini calls (cache holds).
- Deployed on Vercel; demo works on the deployed URL.

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 15 RPM tripped mid-demo | Rate-limiter with queue; cache means demo needs almost no live calls |
| Live API flakes on stage | Pre-tested fallback: text chat with same function calling; record a backup video of the voice flow |
| FIRMS quiet day near featured parks | Featured park chosen from top-10 *live* ranking (mid-August: Amazon/Cerrado/African savanna guarantee fires); archive mode as fallback |
| Serverless timeout on bulk work | All bulk work runs in local scripts → DB; deployed app only reads + does single-call generations |
| Audio timestamp precision | Verified day one; if within-clip timestamps are weak, report file-level time only |
| Vercel Hobby cron limits (1/day) | Manual "refresh" button on dashboard calls ingest on demand |

## 13. Out of scope

Real sensor hardware, fire-spread modeling, WDPA full dataset, auth/multi-tenancy, mobile app, offline mode, patrol scheduling.
