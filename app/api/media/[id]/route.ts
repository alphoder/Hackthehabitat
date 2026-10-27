import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Replayed field media lives in public/media/ so Vercel's CDN serves it directly - a runtime
// readFile() here worked locally but the files never made it into the deployed lambda bundle.
// This route stays as a stable id-based reference and redirects to the static asset.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [m] = (await sql`SELECT path FROM media WHERE id = ${Number(id)}`) as { path: string }[];
  if (!m) return new Response("not found", { status: 404 });
  if (!/^public\/media\/(images|audio)\/[\w.-]+$/.test(m.path)) return new Response("bad path", { status: 400 });
  return Response.redirect(new URL(m.path.replace(/^public/, ""), req.url), 307);
}
