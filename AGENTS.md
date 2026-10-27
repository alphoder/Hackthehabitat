<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CLAUDE.md — Sentinel

AI operations center for protected areas. Read `PRD.md` for the full spec; `prompt.md` for the 5-part build plan. This file is the rules.

## Stack (fixed — do not substitute)

- **Next.js 16.3.1**, App Router, TypeScript, deployed on Vercel. This version differs from training data — read `node_modules/next/dist/docs/01-app/` before using unfamiliar APIs.
- Neon Postgres via `@neondatabase/serverless`, **raw SQL only — no ORM, no Prisma, no Drizzle**
- `@google/genai` SDK for all Gemini use (including Live API)
- Tailwind CSS; `globe.gl` (dynamic import, `ssr: false`); `leaflet`; `chart.js`
- No component libraries, no state managers, no extra deps without a reason stated in the commit

## Environment variables

See `.env.local` (gitignored). Verified model IDs on this key:

```
GEMINI_MODEL_BULK=gemini-3.1-flash-lite          # image/audio classification (500/day, 15 RPM)
GEMINI_MODEL_REASON=gemini-3.5-flash-lite        # briefings, chat, dossiers (separate 500/day pool)
GEMINI_MODEL_LIVE=gemini-3.1-flash-live-preview  # voice, unlimited, 65k ctx
```
Also: `GEMINI_API_KEY`, `NEXT_PUBLIC_GEMINI_API_KEY` (browser Live connection), `FIRMS_MAP_KEY`, `DATABASE_URL`.

Note: `gemini-3.6-flash-lite` does NOT exist. If more reasoning muscle is needed, `gemini-3.6-flash` is available as a third pool.

## Hard rules

### Gemini quota (2 × 500/day, 15 RPM — the design constraint)
1. **Never call Gemini for something already classified.** `media.sha256` is the cache key; check `detections` before any classification call. Cache hit = zero cost.
2. **Batch images**: 10–16 images per BULK request, JSON array response. Never one-image-per-call in bulk paths.
3. All Gemini calls go through `lib/gemini.ts` which enforces ≥4s spacing per model (simple queue). No direct SDK calls elsewhere.
4. BULK model = classification. REASON model = briefings/chat/dossiers. Never swap roles (separate quota pools).
5. Ingest scripts checkpoint progress (DB is the checkpoint) and resume idempotently.
6. Live API is unlimited — voice features have no quota anxiety, but 65k context: never stuff datasets into the session; use function calling to fetch only relevant rows.

### Where code runs
- **Bulk/long work** (image batches, audio, archive replay, field sim) = local `tsx` scripts in `scripts/`, writing to Neon. Never in API routes (serverless timeout).
- **API routes** = reads + single-call generations only.
- Structured Gemini output: always request JSON with `responseMimeType: "application/json"` + a schema; parse defensively.

### Honesty (product rule, not just demo talk)
- Fires/weather/satellite-tiles/GBIF = live. Camera + audio = real data, simulated delivery. UI labels sensor feeds "field simulation — real data replay". Never fabricate detections, patrol data, or fire-spread predictions ("wind pushing NE" ✅, "fire will reach X by 6pm" ❌).
- Never invent numbers for accuracy claims — report measured values from the labeled LILA subset or say "unmeasured".

### Code style
- Ponytail applies: shortest working diff, stdlib/platform first, no speculative abstraction, fewest files.
- One `lib/db.ts` (sql client + typed query helpers), one `lib/gemini.ts` (rate-limited client + prompt builders). Resist splitting further until a file passes ~300 lines.
- Every non-trivial module gets one runnable check (`scripts/check-*.ts`) — smallest thing that fails if the logic breaks.
- Errors from external APIs (FIRMS, Gemini): fail loud in scripts, degrade gracefully in UI (show stale data + timestamp, never a blank page).

## Layout

```
app/                      # pages: / (globe), /park/[id], /dossier/[id]
app/api/                  # routes per PRD §9
lib/db.ts  lib/gemini.ts  lib/geo.ts  lib/firms.ts
scripts/                  # migrate.ts, seed-parks.ts, ingest-media.ts, field-sim.ts, backtest.ts, check-*.ts
data/                     # parks.json (curated), media manifests
```

## Commands

```
npm run dev
npx tsx scripts/<name>.ts
npm run build             # must pass before any deploy
vercel --prod
```

## Verification order for risky assumptions (do these before building on top)
1. Gemini audio: chainsaw/gunshot hit-rate on ~20 clips (Part 3, first task)
2. FIRMS world query returns same-day data near featured parks (Part 1) — ✅ verified 2026-08-15: 13,333 global detections
3. Live API browser connection + function calling round-trip (Part 5, first task)
