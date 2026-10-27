# prompt.md — Sentinel build plan, 5 parts

Feed one part per Claude Code session, in order. Each part ends demoable — if time dies, everything above the cut line still stands. Read `PRD.md` + `CLAUDE.md` first in every session.

---

## Part 1 — Foundation + planetary triage (the globe)

> Read PRD.md and CLAUDE.md. Build the foundation and the planetary triage layer of Sentinel.
>
> 1. Scaffold Next.js 15 (App Router, TypeScript, Tailwind). Set up Neon Postgres; create all tables from PRD §8 in a `scripts/migrate.ts` (plain SQL, idempotent `CREATE TABLE IF NOT EXISTS`).
> 2. `lib/db.ts`: neon client + small typed query helpers. `lib/geo.ts`: haversine distance, point-in-circle, point-in-polygon (ray casting) — pure functions with an assert self-check.
> 3. `data/parks.json`: curate ~200 major protected areas worldwide as `{id, name, country, center_lat, center_lon, radius_km}` (use well-known parks: Amazon reserves, Pantanal, Kruger, Serengeti, Kaziranga, Yellowstone, Okavango, Virunga, etc. — approximate radii are fine and are labeled as approximations). Mark 2 featured parks and give ONLY those hand-drawn `polygon_geojson` + 2–3 named `zones_geojson` (e.g. "rhino corridor", "river sector"). `scripts/seed-parks.ts` loads it.
> 4. `lib/firms.ts` + `POST /api/ingest/fires`: pull FIRMS world CSV (`VIIRS_SNPP_NRT`, last 24h) with FIRMS_MAP_KEY, parse, dedupe on (lat,lon,acq_date,acq_time,satellite), tag each fire with the park it falls inside (point-in-circle vs all parks; point-in-polygon for featured), insert. Support `?archive=YYYY-MM-DD&days=N&bbox=...` for the back-test later. Add `vercel.json` cron (hourly; if Hobby plan limits to daily, also add a manual refresh button in the UI).
> 5. `GET /api/global/summary`: total fires today, count of parks with intrusions, top-10 parks ranked by (detection count, max FRP, min distance to center), per-park fire coordinates.
> 6. Landing page `/`: globe.gl (dynamic import, ssr:false) with fire points (inside protected areas = red/large, outside = dim), headline stat "N protected areas currently have active fire intrusions", ranked top-10 list. Click a park → `/park/[id]`. Dark theme, mission-control aesthetic.
>
> Acceptance: `npx tsx scripts/migrate.ts && npx tsx scripts/seed-parks.ts` then hitting ingest fills real same-day fires; globe renders them; top-10 list is live and clicking navigates. Zero Gemini calls in this part.

---

## Part 2 — Park mission control

> Read PRD.md and CLAUDE.md. Build the per-park mission control page.
>
> 1. `GET /api/parks/[id]`: park meta, polygon + zones, sensors, fires inside/near park (with computed distance to each named zone), last-72h events, Open-Meteo current wind/temp/humidity for park center (no key needed).
> 2. `/park/[id]` page, dark mission-control layout:
>    - Leaflet map: park polygon, shaded named zones, fire markers sized by FRP with popup (time, distance to nearest zone), wind direction arrow overlay, sensor markers (camera/acoustic icons — sensors seeded in Part 3, render empty gracefully).
>    - Threat panel: fires ranked by proximity to zones, worded honestly ("3 detections, nearest 4.2 km from rhino corridor, wind pushing NE at 14 km/h").
>    - Live event feed (polls every 10s — this makes Part 3's field sim feel alive).
>    - Analytics strip (Chart.js): events by day, species frequency, activity by hour — reads `events`/`detections`, renders empty-state before Part 3.
> 3. Seed `sensors` for the 2 featured parks (4–6 cameras + 2–3 acoustic stations each, plausible coordinates inside the polygon) in `scripts/seed-parks.ts`.
> 4. GBIF species baseline: on park page, "notable species here" strip from GBIF occurrence API (free, no key) for the park's bbox — cache the response in the park row (jsonb in `meta`) so it's one fetch ever.
>
> Acceptance: featured park page shows real fires with real zone distances, real wind, GBIF species, and an event feed that will animate when Part 3 runs. Still zero Gemini calls.

---

## Part 3 — Sensor network + Gemini multimodal senses

> Read PRD.md and CLAUDE.md. Give Sentinel eyes and ears. FIRST TASK is the audio verification — do not build the pipeline before it passes.
>
> 1. **Verify (hour one):** `scripts/check-audio.ts` — run ~20 clips (ESC-50 chainsaw / gunshot-adjacent classes + rain + forest ambience; download script or manual instructions into `data/audio/`) through GEMINI_MODEL_BULK asking for JSON `{label, confidence, timestamp_hint}`. Print a confusion summary. Record the measured hit-rate in a comment in the script. If within-clip timestamps are unreliable, note it — we report file-level time only.
> 2. `lib/gemini.ts`: single client, per-model queue enforcing ≥4s spacing, `classifyImages(batch)` (10–16 images/call, JSON array out, responseMimeType json), `classifyAudio(clip)`, plus stubs for briefing/chat/dossier prompts (Part 4).
> 3. Media pipeline: `scripts/ingest-media.ts` — takes a manifest (`data/media-manifest.json`: file path/URL, sensor_id, captured_at), computes sha256, skips anything already in `detections` (cache rule), batches images through BULK, writes `media` + `detections`, and promotes to `events` with severity: human/vehicle/chainsaw/gunshot → 4–5; notable species → 2; blank → no event. Idempotent, resumable, prints call-count spent.
> 4. Camera data: download script/instructions for a LILA Snapshot Serengeti subset (~300–800 images incl. blanks, vehicles/humans if available) into `data/images/` + manifest generator assigning them to seeded camera sensors with staggered timestamps (including night hours). Keep the LILA ground-truth labels in the manifest; `scripts/check-vision.ts` computes measured accuracy vs labels and prints it — this number goes in the demo.
> 5. `scripts/field-sim.ts`: replays a chosen slice of the manifest "live" — every N seconds, ingests one media item (through the same cached pipeline), so the park page event feed pops in real time. Flag `--incident` queues a scripted cluster: chainsaw clip at a named zone + vehicle image at a nearby camera within the same window (this is the fused-incident fuel for Part 4).
> 6. Satellite diff: `scripts/check-satdiff.ts` + `lib` helper — fetch NASA GIBS true-color tiles for a bbox at two dates, send the pair to BULK ("compare: new clearing/burn scars? JSON verdict"), store as an event on the featured park. ~5 pairs max. If GIBS resolution proves too coarse to say anything honest, mark the feature "experimental" in UI and move on — do not fake it.
>
> Acceptance: check-audio and check-vision print measured numbers; ingest of the full image set costs ≤ ~70 BULK calls and a re-run costs 0; field-sim makes the park page feel alive; UI labels sensor feeds "field simulation — real data replay".

---

## Part 4 — Fusion brain: briefing, chat, dossier, back-test

> Read PRD.md and CLAUDE.md. Build the reasoning layer on GEMINI_MODEL_REASON.
>
> 1. `POST /api/briefing/[parkId]`: gather last-24h events + fires + wind into a compact context (cap size; summarize counts, include only high-severity verbatim), one REASON call → ranger morning briefing in markdown: threats ranked, cross-signal inferences ("chainsaw audio 02:41 at river sector + vehicle on camera 7 at 02:55 → probable illegal logging operation, confidence: high"), recommended checks (worded as suggestions, never "patrol schedule"). Store in `briefings`. Park page: briefing panel + generate button + auto-show latest.
> 2. `POST /api/chat/[parkId]`: grounded Q&A. Parse the question for time/place hints → SQL filter events/fires → REASON answers ONLY from retrieved rows, citing event times/sensors. If nothing matches: say so. Chat UI on park page.
> 3. Incidents + dossier: `POST /api/incidents` groups selected/auto-clustered events (same zone, ≤2h window, severity ≥4) into an `incidents` row. `POST /api/dossier/[incidentId]`: 2 REASON calls max → `dossier_html`: title page, incident timeline, map snapshot (static Leaflet screenshot or inline map), media thumbnails, audio-detection details, satellite before/after if present, confidence assessment, drafted report addressed to the relevant authority for the park's country. `/dossier/[id]` renders it print-clean (@media print CSS) → browser print-to-PDF. One-click "Generate dossier" button on incident cards.
> 4. Back-test: `scripts/backtest.ts` — pull FIRMS archive for the Pantanal, June 1–15 2024 (bbox around Pantanal, `?archive=` path from Part 1), run the same triage ranking per day, output an escalation timeline (day → rank/score). Simple `/backtest` page: chart of Sentinel's escalation score by day with an annotation line "international news coverage" (find the actual date of major coverage; if it can't be verified, annotate with a sourced event date instead — never invent). 
>
> Acceptance: briefing reads like the PRD sample but grounded in real DB rows; chat refuses to hallucinate ("no events match"); dossier prints clean; backtest page shows escalation preceding the annotated news date. REASON spend for a full rehearsal < 15 calls.

---

## Part 5 — Voice agent, polish, deploy, demo

> Read PRD.md and CLAUDE.md. The showstopper, then ship.
>
> 1. **Verify first:** minimal page connecting browser mic + speakers to Gemini Live API (`GEMINI_MODEL_LIVE`, native audio) via `@google/genai` in the browser with NEXT_PUBLIC_GEMINI_API_KEY. Confirm: audio in/out works, and a declared function gets called and its response is spoken. Only then build features.
> 2. Voice tools: declare `get_recent_events(park_id, hours, kind?)`, `get_fires(park_id)`, `get_latest_briefing(park_id)` → each fetches from existing API routes. System prompt: ranger-operations tone, concise, grounded — answer only from tool results.
> 3. Inbound: mic button on park page → Live session scoped to that park → judge asks "what happened near the river this week?" → spoken grounded answer.
> 4. Outbound-style alert: when field-sim creates a severity-5 event, park page raises a ringing call UI (ringtone, accept button) → on accept, Live session opens and speaks the alert FIRST (inject alert text as initial context/turn), then takes questions. This is the demo's peak — make the ring impossible to miss.
> 5. Fallback: if Live API fails on stage, the same tools power the text chat (Part 4) — one toggle. Record a 30s backup video of a successful voice round-trip.
> 6. Polish: landing globe headline stat animates in; loading/empty/error states everywhere (stale-data timestamp, never blank); consistent dark mission-control theme; favicon/name.
> 7. Deploy: Neon + env vars on Vercel, `npm run build` clean, cron configured, deployed-URL walkthrough of the full demo script (PRD §10). Fires ingest refresh button works in prod.
> 8. `README.md`: what's live vs replayed (honesty contract verbatim), architecture diagram, measured accuracy numbers from Part 3 checks, quota-budget table, setup steps.
>
> Acceptance: full 4-minute demo runs on the deployed URL: globe → park → field-sim incident → ringing voice alert → judge Q&A by voice → dossier → backtest. Total Gemini quota spent during a rehearsal < 50 calls (verify via the call counter in lib/gemini.ts).
