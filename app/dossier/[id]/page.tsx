import { notFound } from "next/navigation";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [inc] = (await sql`SELECT dossier_html, title FROM incidents WHERE id = ${Number(id)}`) as
    { dossier_html: string | null; title: string }[];
  if (!inc) notFound();

  if (!inc.dossier_html) {
    return (
      <main className="mx-auto max-w-xl p-10 text-sm text-zinc-400">
        Dossier for <span className="text-zinc-100">{inc.title}</span> has not been generated yet.
      </main>
    );
  }

  // The dossier is a self-contained print document with its own light styling.
  return (
    <main className="min-h-dvh bg-white">
      <div dangerouslySetInnerHTML={{ __html: inc.dossier_html }} />
    </main>
  );
}
