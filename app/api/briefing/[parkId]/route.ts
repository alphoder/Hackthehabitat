import { sql } from "@/lib/db";
import { generateBriefing } from "@/lib/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Latest stored briefing - free, no model call. */
export async function GET(_req: Request, ctx: { params: Promise<{ parkId: string }> }) {
  const { parkId } = await ctx.params;
  const rows = await sql`
    SELECT id, content_md, created_at FROM briefings
    WHERE park_id = ${parkId} ORDER BY created_at DESC LIMIT 1`;
  return Response.json(rows[0] ?? null);
}

/** Generate a new briefing - one REASON call. */
export async function POST(_req: Request, ctx: { params: Promise<{ parkId: string }> }) {
  const { parkId } = await ctx.params;
  try {
    return Response.json(await generateBriefing(parkId));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
