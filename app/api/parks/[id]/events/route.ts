import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Polled by the live event feed.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await sql`
    SELECT e.id, e.kind, e.severity, e.occurred_at, e.summary, m.path AS media_path, m.kind AS media_kind
    FROM events e LEFT JOIN media m ON m.id = e.media_id
    WHERE e.park_id = ${id} AND e.occurred_at > now() - interval '72 hours'
    ORDER BY e.occurred_at DESC LIMIT 100`;
  return Response.json(rows);
}
