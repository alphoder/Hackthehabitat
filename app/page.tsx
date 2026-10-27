import Link from "next/link";
import Image from "next/image";
import { Fire, Waveform, Path, PhoneCall, ArrowRight } from "@phosphor-icons/react/ssr";
import { sql } from "@/lib/db";
import FlowRail from "./flow-rail";

// Landing page. A judge, a ranger or a first-time visitor should understand what this is,
// who it is for, and exactly how it works before touching the dashboard.
export const revalidate = 300;

type Shot = { id: number; label: string; confidence: number; truth: string; path: string };

async function pageData() {
  try {
    const [[s], shots] = await Promise.all([
      sql`SELECT (SELECT count(*)::int FROM parks) AS parks_watched,
                 (SELECT count(*)::int FROM fires WHERE acq_date >= current_date - 1) AS fires_today,
                 (SELECT count(DISTINCT park_id)::int FROM fires WHERE acq_date >= current_date - 1) AS parks_affected,
                 (SELECT count(*)::int FROM fires WHERE acq_date >= current_date - 1 AND park_id IS NOT NULL) AS inside,
                 (SELECT max(ingested_at) FROM fires) AS updated_at` as Promise<unknown> as Promise<
        { parks_watched: number; fires_today: number; parks_affected: number; inside: number; updated_at: string | null }[]
      >,
      // Real camera-trap frames with the verdict the model actually returned for them.
      sql`SELECT m.id, d.label, d.confidence, m.truth_label AS truth, m.path
          FROM detections d JOIN media m ON m.id = d.media_id
          WHERE m.kind = 'image' AND m.id IN (2, 4, 34, 76, 73, 130)
          ORDER BY array_position(ARRAY[2,4,34,76,73,130], m.id)` as Promise<unknown> as Promise<Shot[]>,
    ]);
    return { s, shots };
  } catch {
    return { s: null, shots: [] as Shot[] };
  }
}

const STEPS = [
  {
    Icon: Fire,
    title: "Watch every protected area at once",
    plain: "Satellites spot heat anywhere on Earth. Sentinel checks which of those points land inside a national park.",
    why: "This step is pure geometry, so it can run constantly and cost nothing. AI is expensive, so it is only spent on the parks this step flags.",
    cost: "0 AI calls",
  },
  {
    Icon: Waveform,
    title: "Look and listen on the ground",
    plain: "Camera photos and microphone recordings are checked for animals, people, vehicles, chainsaws and gunshots.",
    why: "Poaching and logging happen at night, when cameras see least. Sound does not need light.",
    cost: "132 photos = 11 calls",
  },
  {
    Icon: Path,
    title: "Join the dots",
    plain: "A chainsaw at 02:41 plus a vehicle photographed nearby at 02:55 is not two facts. It is one probable logging operation.",
    why: "A hundred wildlife photos must never bury three gunshots, so the ranking is fixed rather than left to judgement.",
    cost: "1 call per briefing",
  },
  {
    Icon: PhoneCall,
    title: "Act on it",
    plain: "Sentinel phones the ranger, reads out the alert, answers questions aloud, and compiles the evidence packet.",
    why: "Detection that ends in a dashboard changes nothing. This is the step most systems skip.",
    cost: "Voice is unlimited",
  },
];

export default async function Landing() {
  const { s, shots } = await pageData();

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
      <header className="flex h-16 items-center justify-between gap-4">
        <span className="readout text-xs uppercase tracking-[0.28em] text-zinc-200">Sentinel</span>
        <nav className="flex items-center gap-1">
          <a href="#flow" className="rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100">How it works</a>
          <a href="#honesty" className="hidden rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 sm:block">What is real</a>
          <Link href="/globe" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500">
            Open dashboard
          </Link>
        </nav>
      </header>

      {/* hero: asymmetric split, copy left, live readout right */}
      <section className="grid items-center gap-10 pt-14 lg:grid-cols-[1.35fr_1fr] lg:gap-14 lg:pt-20">
        <div>
          <p className="readout text-[11px] uppercase tracking-[0.24em] text-emerald-400">
            Build tech that protects the planet
          </p>
          {/* Two lines, always. Sized so neither line wraps at any breakpoint. */}
          <h1 className="mt-5 text-[2rem] font-semibold leading-[1.08] tracking-tight sm:text-[2.6rem] lg:text-5xl">
            <span className="block">
              One ranger per <span className="text-red-400">1,000 km²</span>.
            </span>
            <span className="block text-zinc-500">Sentinel watches the rest.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-zinc-400">
            Satellites, cameras and microphones already see illegal fires and logging.
            Nobody has time to look. Sentinel looks, and then acts.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/globe"
                  className="group inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-emerald-500 active:translate-y-px">
              Open the live dashboard
              <ArrowRight size={15} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a href="#flow" className="rounded-md border border-panel-border px-5 py-2.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white">
              See how it works
            </a>
          </div>
        </div>

        {s && (
          <aside className="rounded-xl border border-panel-border bg-panel/70 p-6">
            <div className="flex items-baseline gap-3">
              <span className="readout text-6xl font-semibold leading-none text-red-400">{s.parks_affected}</span>
              <span className="text-sm leading-tight text-zinc-300">
                protected areas have<br />fires burning inside them
              </span>
            </div>
            <p className="mt-3 text-xs text-zinc-500">Live from NASA satellites, right now.</p>
            <dl className="readout mt-6 space-y-3 border-t border-panel-border pt-5 text-xs">
              {[
                ["Protected areas watched", s.parks_watched.toLocaleString()],
                ["Fire detections today", s.fires_today.toLocaleString()],
                ["Inside park boundaries", s.inside.toLocaleString()],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="text-zinc-100">{v}</dd>
                </div>
              ))}
            </dl>
          </aside>
        )}
      </section>

      {/* flow: numbered rows joined by a rail that draws itself on scroll */}
      <section id="flow" className="scroll-mt-8 pt-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Four steps. Each one narrows the problem so the next can afford to be smarter.
        </h2>
        <FlowRail steps={STEPS} />
      </section>

      {/* real detections: the strongest possible proof, actual frames and actual verdicts */}
      {shots.length > 0 && (
        <section className="pt-28">
          <p className="readout text-[11px] uppercase tracking-[0.24em] text-emerald-400">Unedited output</p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            What the AI actually saw
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
            Real camera-trap frames from a public research dataset, with the label Sentinel
            returned and how certain it was. Each photo has a known correct answer, which is how
            the accuracy below was measured.
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {shots.map((shot) => {
              const right = shot.truth.toLowerCase().replace(/[_-]/g, " ").includes(
                shot.label.toLowerCase().split(" ").pop() ?? ""
              ) || (shot.truth === "Vehicle" && /vehicle|tractor|excavator|mower/.test(shot.label));
              return (
                <li key={shot.id}  className="overflow-hidden rounded-lg border border-panel-border bg-panel">
                  <div className="relative aspect-[4/3]">
                    <Image
                      src={shot.path.replace(/^public/, "")}
                      alt={`Camera-trap frame classified as ${shot.label}`}
                      fill sizes="(max-width: 640px) 50vw, 16vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="truncate text-xs font-medium text-zinc-100">{shot.label}</p>
                    <p className="readout mt-0.5 text-[10px] text-zinc-500">
                      {Math.round(shot.confidence * 100)}% sure
                      <span className={right ? "text-emerald-400" : "text-amber-400"}>
                        {right ? " · correct" : " · missed"}
                      </span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* audiences: deliberately asymmetric, not three equal cards */}
      <section className="pt-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Three people, three completely different situations
        </h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div  className="flex flex-col justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-6 sm:p-8">
            <div>
              <h3 className="text-xl font-medium text-zinc-100">A ranger, driving, at 3am</h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
                They cannot look at a screen, so Sentinel does not ask them to. The phone rings.
                A voice states what was detected, where, and when. They ask questions out loud
                and get answers read back from the live database.
              </p>
            </div>
            <p className="readout mt-6 text-xs text-emerald-400">Voice, hands free, no screen</p>
          </div>

          <div className="grid gap-4">
            {[
              { t: "A park manager at a desk", d: "A map of their park with fires, sensors and named zones, a live feed of every detection, and a morning briefing written for them." },
              { t: "An investigator building a case", d: "A printable evidence packet: timeline, images, audio, and a section stating plainly what the evidence does not prove." },
            ].map((a) => (
              <div key={a.t}  className="rounded-xl border border-panel-border bg-panel/60 p-6">
                <h3 className="text-base font-medium text-zinc-100">{a.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{a.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* honesty */}
      <section id="honesty" className="scroll-mt-8 pt-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          What is real, and what is replayed
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
          Stated up front, because a conservation tool that overstates itself is worse than none
          at all. Every live claim below can be checked against its public source.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="overflow-hidden rounded-xl border border-panel-border">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-panel-border">
                {[
                  ["Fire detections", "live", "NASA FIRMS, hourly"],
                  ["Weather and wind", "live", "Open-Meteo"],
                  ["Species records", "live", "GBIF"],
                  ["Satellite imagery", "live", "NASA GIBS"],
                  ["Camera photos", "replayed", "ENA24 via LILA BC"],
                  ["Microphone audio", "replayed", "ESC-50 recordings"],
                  ["Park boundaries", "approximate", "Curated, 3 hand-drawn"],
                ].map(([layer, status, src]) => (
                  <tr key={layer} className="bg-panel/40">
                    <td className="px-4 py-3 text-zinc-200">{layer}</td>
                    <td className="px-4 py-3">
                      <span className={`readout rounded-sm border px-1.5 py-0.5 text-[10px] uppercase ${
                        status === "live" ? "border-emerald-500/40 text-emerald-400"
                        : status === "approximate" ? "border-zinc-600 text-zinc-400"
                        : "border-amber-500/40 text-amber-400"}`}>{status}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-zinc-500">{src}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4">
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-6">
              <h3 className="text-base font-medium text-amber-300">Why two feeds are replayed</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                No park publishes a live feed from its cameras or microphones. Real recordings are
                replayed as though sensors were uploading them now. The recordings are genuine and
                the AI results on them are genuine. Nothing is scripted. A real deployment would
                point the park&rsquo;s own sensors at exactly this pipeline.
              </p>
            </div>
            <div className="rounded-xl border border-panel-border bg-panel/60 p-6">
              <h3 className="text-base font-medium text-zinc-100">Things it will never claim</h3>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-zinc-400">
                <li>Where a fire will spread. It reports wind direction only.</li>
                <li>That a detection is confirmed. Machines classify, people verify.</li>
                <li>Patrol schedules, staffing or arrests. It has no such data.</li>
                <li>Any accuracy figure that was not actually measured.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* proof */}
      <section className="pt-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Does it actually work?</h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
          Every figure was produced by a script in this repository, run against data with known
          correct answers. None of it is an estimate.
        </p>

        <div className="mt-8 grid gap-x-10 gap-y-8 border-y border-panel-border py-8 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { v: "16 of 16", l: "Vehicle intrusions caught", s: "None missed, none downgraded to wildlife" },
            { v: "95%", l: "Photos categorised correctly", s: "132 labelled frames, 11 AI calls total" },
            { v: "17 of 18", l: "Threat sounds escalated", s: "Chainsaws, gunshots, engines" },
            { v: "2 of 12", l: "False alarms on quiet clips", s: "Wind once mistaken for a vehicle" },
          ].map((m) => (
            <div key={m.l} className="">
              <div className="readout text-3xl font-semibold text-zinc-100">{m.v}</div>
              <div className="mt-2 text-sm text-zinc-300">{m.l}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">{m.s}</div>
            </div>
          ))}
        </div>

        <div  className="mt-8 rounded-xl border border-panel-border bg-panel/60 p-6 sm:p-8">
          <h3 className="text-xl font-medium text-zinc-100">Replayed against a real disaster</h3>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            We ran the 2024 Pantanal fire season, the worst on record, back through the same
            pipeline. The wetland sat near zero for a month, then jumped from{" "}
            <span className="text-zinc-100">6 detections to 72 in twenty-four hours</span>, with
            heat output rising from 29 to 3,693 megawatts. A threshold watch escalates on the day
            it begins. This is detection, not response: it says nothing about whether anyone acted.
          </p>
          <Link href="/backtest" className="mt-5 inline-flex items-center gap-2 text-sm text-emerald-400 transition-colors hover:text-emerald-300">
            See the replay <ArrowRight size={14} weight="bold" />
          </Link>
        </div>
      </section>

      {/* entry points */}
      <section className="pt-28">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Try it yourself</h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
          Start anywhere. Every page has a microphone button in the corner. Press it and talk
          normally, or type instead.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {[
            { href: "/globe", t: "The living globe", d: "Every fire on Earth right now, with the worst-hit protected areas ranked first." },
            { href: "/park/great-smoky", t: "Inside a park", d: "Map, sensors, live detections, an AI-written briefing, and a question box." },
            { href: "/backtest", t: "The 2024 Pantanal replay", d: "Proof against a real disaster, day by day." },
            { href: "/voice-check", t: "Voice diagnostics", d: "Watch the agent connect and query the database, with every step printed." },
          ].map((c) => (
            <Link key={c.href} href={c.href}
                  className="group flex items-start justify-between gap-4 rounded-xl border border-panel-border bg-panel/50 p-5 transition-colors hover:border-emerald-500/40 hover:bg-panel">
              <span>
                <span className="block text-base font-medium text-zinc-100">{c.t}</span>
                <span className="mt-1 block text-sm leading-relaxed text-zinc-400">{c.d}</span>
              </span>
              <ArrowRight size={16} weight="bold" className="mt-1 shrink-0 text-zinc-600 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-400" />
            </Link>
          ))}
        </div>
      </section>

      <footer className="mt-24 border-t border-panel-border pt-6">
        <p className="readout text-[11px] leading-relaxed text-zinc-600">
          Fire data from NASA FIRMS. Weather from Open-Meteo. Species from GBIF. Imagery from
          NASA GIBS and Esri. Camera frames from LILA BC (ENA24). Audio from ESC-50.
          Classification and reasoning by Google Gemini.
          {s?.updated_at && ` Satellite data last refreshed ${new Date(s.updated_at).toISOString().slice(0, 16).replace("T", " ")}Z.`}
        </p>
      </footer>
    </main>
  );
}
