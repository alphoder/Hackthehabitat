"use client";

import { useEffect, useState } from "react";

export type FeedEvent = {
  id: number; kind: string; severity: number; occurred_at: string;
  summary: string; media_path: string | null; media_kind: string | null;
};

const KIND_STYLE: Record<string, string> = {
  chainsaw: "text-red-400 border-red-500/40",
  gunshot: "text-red-400 border-red-500/40",
  human: "text-amber-400 border-amber-500/40",
  vehicle: "text-amber-400 border-amber-500/40",
  fire: "text-orange-400 border-orange-500/40",
  animal: "text-emerald-400 border-emerald-500/40",
};

export function severityColor(s: number) {
  return s >= 5 ? "bg-red-500" : s >= 4 ? "bg-amber-500" : s >= 3 ? "bg-sky-500" : "bg-zinc-600";
}

/** Polls so the field simulation visibly lands on screen during the demo. */
export default function EventFeed({ parkId, initial }: { parkId: string; initial: FeedEvent[] }) {
  const [events, setEvents] = useState(initial);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      // Don't poll a page nobody is looking at - this ran alongside the agent's own watcher
      // and the two together kept a remote database busy for no benefit.
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/parks/${parkId}/events`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const next = (await res.json()) as FeedEvent[];
        setEvents((prev) => {
          const known = new Set(prev.map((e) => e.id));
          const added = next.filter((e) => !known.has(e.id)).map((e) => e.id);
          if (added.length) {
            setFreshIds(new Set(added));
            // let the agent's alert watcher reuse this result instead of fetching again
            window.dispatchEvent(new CustomEvent("sentinel:events", { detail: next }));
          }
          return next;
        });
      } catch { /* keep showing what we have */ }
    };
    const t = setInterval(tick, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [parkId]);

  if (!events.length) {
    return (
      <p className="px-5 py-6 text-xs leading-relaxed text-zinc-500">
        Nothing detected in the last three days. When a camera or microphone picks something
        up, it appears here within seconds.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-panel-border">
      {events.map((e) => (
        <li
          key={e.id}
          className={`flex gap-3 px-5 py-3 ${freshIds.has(e.id) ? "bg-red-500/10" : ""}`}
        >
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityColor(e.severity)} ${e.severity >= 5 ? "pulse-alert" : ""}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className={`readout rounded-sm border px-1 text-[9px] uppercase ${KIND_STYLE[e.kind] ?? "text-zinc-400 border-zinc-600"}`}>
                {e.kind}
              </span>
              <time className="readout text-[10px] text-zinc-500">
                {new Date(e.occurred_at).toISOString().slice(5, 16).replace("T", " ")}Z
              </time>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">{e.summary}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
