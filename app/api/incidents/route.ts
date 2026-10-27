import { createIncident, findClusters } from "@/lib/incident";

export const dynamic = "force-dynamic";

/** Candidate clusters for a park - pure SQL + geometry, no model call. */
export async function GET(req: Request) {
  const parkId = new URL(req.url).searchParams.get("park");
  if (!parkId) return Response.json({ error: "park required" }, { status: 400 });
  const clusters = await findClusters(parkId);
  return Response.json(clusters.map((c) => ({
    event_ids: c.map((e) => e.id),
    kinds: [...new Set(c.map((e) => e.kind))],
    severity: Math.max(...c.map((e) => e.severity)),
    from: c[0].occurred_at,
    to: c[c.length - 1].occurred_at,
    summaries: c.map((e) => e.summary),
  })));
}

export async function POST(req: Request) {
  const { parkId, eventIds } = (await req.json()) as { parkId: string; eventIds: number[] };
  if (!parkId || !eventIds?.length) return Response.json({ error: "parkId and eventIds required" }, { status: 400 });
  try {
    return Response.json(await createIncident(parkId, eventIds));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
