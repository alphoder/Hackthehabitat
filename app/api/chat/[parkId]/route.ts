import { answer } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ parkId: string }> }) {
  const { parkId } = await ctx.params;
  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return Response.json({ error: "question required" }, { status: 400 });
  try {
    return Response.json(await answer(parkId, question.trim()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
