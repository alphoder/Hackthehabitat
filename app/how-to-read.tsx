// Plain-language key for the park page. Native <details> so it needs no JavaScript, stays
// keyboard accessible, and is closed by default: a ranger who knows the system is not slowed
// down, a first-time reader is one click from understanding every panel.

const ROWS: [string, string][] = [
  ["Detection", "One thing a sensor noticed at one moment: a hot spot from a satellite, an animal in a photo, a sound on a microphone. It is a machine's opinion, not a confirmed fact."],
  ["MW (megawatts)", "How much heat a fire is giving off right now. Bigger number, fiercer fire. A cooking fire is under 1 MW; 100 MW is a serious wildfire."],
  ["Inside the boundary", "The satellite placed this hot spot within the park itself, rather than on farmland nearby."],
  ["Named zone", "A part of the park we have drawn and named, so distances mean something to a ranger: \"4 km from the river sector\" rather than a pair of coordinates."],
  ["Field simulation", "The cameras and microphones are real recordings from public research datasets, replayed as if sensors were uploading them now. No park publishes a live sensor feed, so this is how a real deployment would look."],
];

const SEVERITY: [string, string, string][] = [
  ["bg-red-500", "Critical", "A chainsaw or a gunshot was heard. Someone may be cutting or shooting."],
  ["bg-amber-500", "High", "A person on foot where none is expected."],
  ["bg-sky-500", "Notable", "A vehicle. Usually park maintenance, so it is context rather than an alarm."],
  ["bg-zinc-600", "Routine", "Wildlife. The normal business of a working park."],
];

export default function HowToRead() {
  return (
    <details className="group border-b border-panel-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm text-zinc-300 transition-colors hover:text-zinc-100">
        <span>New here? How to read this page</span>
        <span className="readout text-[10px] text-zinc-500 transition-transform group-open:rotate-180">▾</span>
      </summary>

      <div className="space-y-4 px-5 pb-5">
        <dl className="space-y-2.5">
          {ROWS.map(([term, meaning]) => (
            <div key={term}>
              <dt className="text-xs font-medium text-zinc-200">{term}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-zinc-400">{meaning}</dd>
            </div>
          ))}
        </dl>

        <div>
          <p className="text-xs font-medium text-zinc-200">The coloured dot on each event</p>
          <ul className="mt-1.5 space-y-1.5">
            {SEVERITY.map(([dot, label, meaning]) => (
              <li key={label} className="flex gap-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                <span className="text-xs leading-relaxed text-zinc-400">
                  <span className="text-zinc-200">{label}. </span>{meaning}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          Everything here is a machine classification and can be wrong. Measured accuracy and the
          known failure cases are published on the home page.
        </p>
      </div>
    </details>
  );
}
