"use client";

import { useState } from "react";

export type Cluster = {
  event_ids: number[]; kinds: string[]; severity: number;
  from: string; to: string; summaries: string[];
};

export default function IncidentPanel({ parkId, clusters }: { parkId: string; clusters: Cluster[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const build = async (c: Cluster, i: number) => {
    setBusy(i); setErr(null);
    try {
      const made = await fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parkId, eventIds: c.event_ids }),
      }).then((r) => r.json());
      if (made.error) throw new Error(made.error);

      const doc = await fetch(`/api/dossier/${made.id}`, { method: "POST" }).then((r) => r.json());
      if (doc.error) throw new Error(doc.error);

      window.open(`/dossier/${made.id}`, "_blank");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!clusters.length) return null;

  return (
    <section className="border-b border-panel-border px-5 py-4">
      <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">Open cases</h2>
      <p className="mt-1 text-[11px] text-zinc-600">
        High-severity detections grouped by time and place.
      </p>

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}

      <ul className="mt-2 space-y-2">
        {clusters.slice(0, 4).map((c, i) => (
          <li key={c.event_ids.join("-")} className="rounded-sm border border-panel-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                {c.kinds.map((k) => (
                  <span key={k} className={`readout rounded-sm border px-1 text-[9px] uppercase ${
                    c.severity >= 5 ? "border-red-500/40 text-red-400" : "border-amber-500/40 text-amber-400"}`}>
                    {k}
                  </span>
                ))}
                {c.event_ids.length > 1 && (
                  <span className="readout text-[9px] text-sky-300">{c.event_ids.length} signals</span>
                )}
              </span>
              <button
                onClick={() => build(c, i)}
                disabled={busy !== null}
                className="readout shrink-0 rounded-sm border border-zinc-700 px-2 py-0.5 text-[9px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40"
              >
                {busy === i ? "compiling…" : "dossier"}
              </button>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">{c.summaries[0]}</p>
            <p className="readout mt-1 text-[9px] text-zinc-600">
              {new Date(c.from).toISOString().slice(5, 16).replace("T", " ")}Z
              {c.to !== c.from && ` → ${new Date(c.to).toISOString().slice(11, 16)}Z`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
