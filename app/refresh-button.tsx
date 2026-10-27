"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Pulls the latest satellite detections and re-renders the page. The server decides whether a
// pull is actually warranted (see /api/ingest/fires); this only reports what it decided.

export default function RefreshButton({ updatedAt }: { updatedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [age, setAge] = useState<string>("");

  // Live "updated N ago" so staleness is always visible without a reload.
  useEffect(() => {
    const tick = () => {
      if (!updatedAt) return setAge("never");
      const s = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 1000));
      setAge(s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [updatedAt]);

  const refresh = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/ingest/fires?area=world&days=1", { method: "POST" }).then((x) => x.json());
      if (r.ok && r.skipped) {
        setNote(`Already current - next pull in ${Math.ceil((r.seconds_until_next ?? 0) / 60)} min`);
      } else if (r.ok) {
        setNote(`${r.inserted.toLocaleString()} new detections · ${r.inParks.toLocaleString()} inside parks`);
        router.refresh();
      } else {
        setNote(r.error ?? "refresh failed");
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
      setTimeout(() => setNote(null), 8000);
    }
  };

  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1">
      <button
        onClick={refresh}
        disabled={busy}
        className="readout flex items-center gap-1.5 rounded-sm border border-panel-border bg-panel/80 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" aria-hidden className={busy ? "animate-spin" : ""}>
          <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
        </svg>
        {busy ? "pulling…" : `updated ${age}`}
      </button>
      {note && <span className="readout max-w-[15rem] text-right text-[9px] leading-tight text-zinc-500">{note}</span>}
    </div>
  );
}
