import type { Icon } from "@phosphor-icons/react";

// The four-step pipeline. A hairline rail joins the steps and draws itself as the section
// scrolls past, so the sequence reads as one funnel rather than four unrelated blocks.
export default function FlowRail({
  steps,
}: {
  steps: { Icon: Icon; title: string; plain: string; why: string; cost: string }[];
}) {
  return (
    <ol className="relative mt-10 space-y-px">
      {/* the rail itself, hidden on small screens where the steps stack tightly */}
      <span aria-hidden
            className="flow-rail absolute left-[27px] top-8 hidden w-px bg-gradient-to-b from-emerald-500/50 via-panel-border to-transparent sm:block"
            style={{ height: "calc(100% - 4rem)" }} />

      {steps.map(({ Icon: StepIcon, title, plain, why, cost }, i) => (
        <li key={title} className="reveal relative flex gap-5 rounded-xl border border-transparent p-5 transition-colors hover:border-panel-border hover:bg-panel/40 sm:gap-6 sm:p-6">
          <div className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-panel-border bg-panel">
            <StepIcon size={20} weight="duotone" className="text-emerald-400" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-lg font-medium text-zinc-100">
                <span className="readout mr-2 text-sm text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                {title}
              </h3>
              <span className="readout shrink-0 rounded-sm border border-emerald-500/30 px-1.5 py-0.5 text-[10px] uppercase text-emerald-400">
                {cost}
              </span>
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-zinc-300">{plain}</p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">{why}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
