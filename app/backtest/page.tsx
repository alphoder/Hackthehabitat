import Link from "next/link";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";

type Day = { date: string; detections: number; total_frp: number; max_frp: number };
type Backtest = {
  park: string; source: string; start: string; days: number; threshold: number;
  daily: Day[]; peak: Day; escalation: Day | null; measured_at: string;
};

async function load(): Promise<Backtest | null> {
  try {
    return JSON.parse(await readFile("data/backtest.json", "utf8")) as Backtest;
  } catch {
    return null;
  }
}

export default async function BacktestPage() {
  const bt = await load();

  if (!bt) {
    return (
      <main className="mx-auto max-w-2xl p-10">
        <p className="text-sm text-zinc-400">
          No backtest yet. Run <code className="readout text-zinc-200">npm run s scripts/backtest.ts</code>.
        </p>
      </main>
    );
  }

  // Fill missing dates so the timeline is honest about quiet days.
  const byDate = new Map(bt.daily.map((d) => [d.date, d]));
  const days: Day[] = [];
  const cur = new Date(bt.start + "T00:00:00Z");
  for (let i = 0; i < bt.days; i++) {
    const iso = cur.toISOString().slice(0, 10);
    days.push(byDate.get(iso) ?? { date: iso, detections: 0, total_frp: 0, max_frp: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const maxDet = Math.max(...days.map((d) => d.detections), 1);
  const esc = bt.escalation;
  const escIdx = esc ? days.findIndex((d) => d.date === esc.date) : -1;
  const dayBefore = escIdx > 0 ? days[escIdx - 1] : null;
  const frpJump = dayBefore && dayBefore.total_frp > 0 && esc ? esc.total_frp / dayBefore.total_frp : null;

  const W = 900, H = 260, PAD = 34;
  const bw = (W - PAD * 2) / days.length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/globe" className="readout text-xs text-zinc-500 transition-colors hover:text-zinc-200">← globe</Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Backtest - Pantanal, 2024</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
        The same triage the live system runs, replayed over {bt.days} days of NASA FIRMS archive
        detections ({bt.source}) inside the Pantanal Matogrossense boundary. Nothing here is
        simulated - these are the fires as the satellites recorded them.
      </p>

      {/* headline */}
      {esc && dayBefore && (
        <div className="mt-6 grid gap-px overflow-hidden rounded border border-panel-border bg-panel-border sm:grid-cols-3">
          <div className="bg-panel px-4 py-3">
            <div className="readout text-[10px] uppercase tracking-[0.18em] text-zinc-500">Escalation raised</div>
            <div className="readout mt-1 text-xl text-red-400">{esc.date}</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">first day at or above {bt.threshold} detections</div>
          </div>
          <div className="bg-panel px-4 py-3">
            <div className="readout text-[10px] uppercase tracking-[0.18em] text-zinc-500">Day-over-day</div>
            <div className="readout mt-1 text-xl text-amber-400">
              {dayBefore.detections} → {esc.detections}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              detections{frpJump ? `, radiative power ×${frpJump.toFixed(0)}` : ""}
            </div>
          </div>
          <div className="bg-panel px-4 py-3">
            <div className="readout text-[10px] uppercase tracking-[0.18em] text-zinc-500">Season peak</div>
            <div className="readout mt-1 text-xl text-zinc-100">{bt.peak.date}</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">{bt.peak.detections} detections, {bt.peak.total_frp} MW</div>
          </div>
        </div>
      )}

      {/* chart */}
      <div className="mt-6 overflow-x-auto rounded border border-panel-border bg-panel p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[720px]" role="img"
             aria-label="Daily fire detections inside the Pantanal boundary, May to July 2024">
          <line x1={PAD} y1={H - 24} x2={W - PAD} y2={H - 24} stroke="#27303f" />
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD} y1={H - 24 - f * (H - 60)} x2={W - PAD} y2={H - 24 - f * (H - 60)} stroke="#1a2230" />
              <text x={PAD - 6} y={H - 20 - f * (H - 60)} fontSize="9" fill="#52525b" textAnchor="end" fontFamily="monospace">
                {Math.round(f * maxDet)}
              </text>
            </g>
          ))}

          {/* escalation threshold */}
          <line x1={PAD} y1={H - 24 - (bt.threshold / maxDet) * (H - 60)} x2={W - PAD} y2={H - 24 - (bt.threshold / maxDet) * (H - 60)}
                stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3" />
          <text x={PAD + 4} y={H - 28 - (bt.threshold / maxDet) * (H - 60)} fontSize="9" fill="#f59e0b" fontFamily="monospace">
            escalation threshold ({bt.threshold})
          </text>

          {days.map((d, i) => {
            const h = (d.detections / maxDet) * (H - 60);
            const isEsc = d.date === esc?.date;
            return (
              <rect key={d.date} x={PAD + i * bw} y={H - 24 - h} width={Math.max(1, bw - 1.5)} height={h}
                    fill={isEsc ? "#ef4444" : d.detections >= bt.threshold ? "#f97316" : "#3f4756"}>
                <title>{`${d.date}: ${d.detections} detections, ${d.total_frp} MW`}</title>
              </rect>
            );
          })}

          {escIdx >= 0 && (
            <line x1={PAD + escIdx * bw + bw / 2} y1={16} x2={PAD + escIdx * bw + bw / 2} y2={H - 24}
                  stroke="#ef4444" strokeWidth="1" strokeDasharray="3 3" />
          )}
          {escIdx >= 0 && (
            <text x={PAD + escIdx * bw + bw / 2 + 5} y={24} fontSize="10" fill="#ef4444" fontFamily="monospace">
              Sentinel escalates {esc!.date}
            </text>
          )}

          {days.map((d, i) => (i % 7 === 0 ? (
            <text key={d.date} x={PAD + i * bw} y={H - 10} fontSize="8.5" fill="#52525b" fontFamily="monospace">
              {d.date.slice(5)}
            </text>
          ) : null))}
        </svg>
      </div>

      <div className="mt-5 max-w-2xl space-y-2 text-xs leading-relaxed text-zinc-500">
        <p>
          <span className="text-zinc-300">What this shows.</span> The Pantanal sat near zero for
          a month, then jumped from {dayBefore?.detections ?? 0} detections to {esc?.detections ?? 0} in
          twenty-four hours. A threshold watch on satellite data crosses on the day of onset -
          no imagery review, no field report, no waiting for a weekly summary.
        </p>
        <p>
          <span className="text-zinc-300">What this does not show.</span> This is detection, not
          response. It says nothing about whether anyone acted, and the threshold is a simple
          count chosen ahead of the replay rather than a validated operational trigger. The
          boundary is an approximate radius, so detections just outside the real park may be
          included and some just inside excluded.
        </p>
        <p className="readout text-[10px] text-zinc-600">
          Source: NASA FIRMS {bt.source} archive · replayed {new Date(bt.measured_at).toISOString().slice(0, 10)}
        </p>
      </div>
    </main>
  );
}
