"use client";

import { useState } from "react";

type Briefing = { id: number; content_md: string; created_at: string };

/** Minimal markdown: headings, bullets, bold. Enough for the briefing format we ask for. */
function render(md: string) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    blocks.push(
      <ul key={`u${k}`} className="my-1.5 space-y-1">
        {list.map((li, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
            <span className="text-zinc-600">·</span>
            <span dangerouslySetInnerHTML={{ __html: li.replace(/\*\*(.+?)\*\*/g, "<strong class='text-zinc-100'>$1</strong>") }} />
          </li>
        ))}
      </ul>
    );
    list = [];
  };

  md.split("\n").forEach((line, k) => {
    const t = line.trim();
    if (!t) { flush(k); return; }
    if (t.startsWith("##")) {
      flush(k);
      blocks.push(
        <h3 key={k} className="readout mt-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500 first:mt-0">
          {t.replace(/^#+\s*/, "")}
        </h3>
      );
    } else if (/^[-*]\s/.test(t)) {
      list.push(t.replace(/^[-*]\s/, ""));
    } else {
      flush(k);
      blocks.push(
        <p key={k} className="my-1 text-xs leading-relaxed text-zinc-300"
           dangerouslySetInnerHTML={{ __html: t.replace(/\*\*(.+?)\*\*/g, "<strong class='text-zinc-100'>$1</strong>") }} />
      );
    }
  });
  flush(9999);
  return blocks;
}

export default function BriefPanel({ parkId, initial }: { parkId: string; initial: Briefing | null }) {
  const [brief, setBrief] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/briefing/${parkId}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "failed");
      setBrief(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-panel-border px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">Ranger briefing</h2>
        <button
          onClick={generate}
          disabled={busy}
          className="readout rounded-sm border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40"
        >
          {busy ? "writing…" : brief ? "regenerate" : "generate"}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-400">Could not generate: {err}</p>}

      {brief ? (
        <>
          <div className="mt-2">{render(brief.content_md)}</div>
          <p className="readout mt-3 text-[10px] text-zinc-600">
            written {new Date(brief.created_at).toISOString().slice(0, 16).replace("T", " ")}Z from stored detections
          </p>
        </>
      ) : (
        !busy && <p className="mt-2 text-xs text-zinc-500">No briefing yet for this park.</p>
      )}
    </section>
  );
}
