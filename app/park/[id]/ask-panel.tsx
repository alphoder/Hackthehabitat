"use client";

import { useState } from "react";

type Turn = { q: string; a: string; matched: number; hours: number };

const SUGGESTED = [
  "What happened near the river this week?",
  "Any signs of poaching in the last 48 hours?",
  "Which animals were seen overnight?",
];

export default function AskPanel({ parkId }: { parkId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true); setQ("");
    try {
      const res = await fetch(`/api/chat/${parkId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await res.json();
      setTurns((t) => [...t, { q: question, a: j.error ? `Could not answer: ${j.error}` : j.answer, matched: j.matched ?? 0, hours: j.hours ?? 0 }]);
    } catch (e) {
      setTurns((t) => [...t, { q: question, a: `Could not answer: ${(e as Error).message}`, matched: 0, hours: 0 }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-panel-border px-5 py-4">
      <h2 className="readout text-[11px] uppercase tracking-[0.2em] text-zinc-400">Ask the park</h2>

      {turns.length === 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-sm border border-panel-border px-2 py-1 text-left text-[10px] leading-tight text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 space-y-3">
        {turns.map((t, i) => (
          <div key={i}>
            <p className="text-xs font-medium text-zinc-100">{t.q}</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">{t.a}</p>
            <p className="readout mt-1 text-[10px] text-zinc-600">
              grounded in {t.matched} stored event{t.matched === 1 ? "" : "s"} · {t.hours}h window
            </p>
          </div>
        ))}
        {busy && <p className="text-xs text-zinc-500">checking the record…</p>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(q); }}
        className="mt-3 flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about this park…"
          className="min-w-0 flex-1 rounded-sm border border-panel-border bg-black/30 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="readout rounded-sm border border-zinc-700 px-2.5 text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40"
        >
          ask
        </button>
      </form>
    </section>
  );
}
