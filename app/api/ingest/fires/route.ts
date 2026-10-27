import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { fetchFires, ingestFires } from "@/lib/firms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly Vercel cron, the dashboard refresh button, and the agent's refresh_fires tool all
// land here. ?area=world&days=1&date=YYYY-MM-DD&source=VIIRS_SNPP_NRT
//
// Rate limiting lives HERE rather than in the button, so every caller is covered by one rule.
// FIRMS allows 5,000 transactions per 10 minutes, so the API is not the binding constraint -
// the real reasons to throttle are that VIIRS only passes overhead a few times a day (a pull
// two minutes after the last one returns the same rows) and that each world pull writes
// ~150k rows across the Atlantic. ?force=1 overrides for a live demo.
const MIN_INTERVAL_MS = 10 * 60_000;

async function run(req: Request) {
  const p = new URL(req.url).searchParams;
  const force = p.get("force") === "1";

  try {
    const [last] = (await sql`SELECT max(ingested_at) AS at FROM fires`) as { at: string | null }[];
    const ageMs = last?.at ? Date.now() - new Date(last.at).getTime() : Infinity;

    if (!force && ageMs < MIN_INTERVAL_MS) {
      const waitS = Math.ceil((MIN_INTERVAL_MS - ageMs) / 1000);
      return Response.json({
        ok: true,
        skipped: true,
        reason: "already up to date",
        seconds_until_next: waitS,
        last_updated: last.at,
        note: `Satellite data was refreshed ${Math.round(ageMs / 60000)} minutes ago. VIIRS only passes overhead a few times a day, so there is nothing new to fetch yet.`,
      });
    }

    const opts = {
      area: p.get("area") ?? "world",
      days: Number(p.get("days") ?? 1),
      date: p.get("date") ?? undefined,
      source: p.get("source") ?? "VIIRS_SNPP_NRT",
    };
    const rows = await fetchFires(opts);
    const r = await ingestFires(rows, opts.source);

    // Without this the globe keeps serving its cached render and the new numbers never appear.
    revalidatePath("/");
    revalidatePath("/park/[id]", "page");

    return Response.json({ ok: true, skipped: false, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export const GET = run;
export const POST = run;
