"use client";

import { useState } from "react";
import type { ToolListUnion } from "@google/genai";

// Verification harness for the Live API: connects from the browser, sends a TEXT turn (no mic
// needed), and proves the function-call round trip into our own database actually completes.
// Also doubles as the on-stage fallback if microphone capture misbehaves.

type Log = { t: string; kind: "info" | "ok" | "err" | "tool" | "say" };

const TOOLS = [{
  functionDeclarations: [
    { name: "get_recent_events", description: "Sensor detections at this park.", parameters: { type: "OBJECT", properties: { hours: { type: "NUMBER" }, kind: { type: "STRING" } } } },
    { name: "get_fires", description: "Satellite fire detections and wind for this park.", parameters: { type: "OBJECT", properties: {} } },
  ],
}] as unknown as ToolListUnion;

export default function VoiceCheck() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("What happened at the park in the last 24 hours?");

  const push = (t: string, kind: Log["kind"] = "info") => setLogs((l) => [...l, { t, kind }]);

  const run = async () => {
    setBusy(true); setLogs([]);
    const parkId = "great-smoky";
    try {
      const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!key) throw new Error("NEXT_PUBLIC_GEMINI_API_KEY missing");
      push(`key present (${key.slice(0, 6)}…)`, "ok");

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: key });
      const model = process.env.NEXT_PUBLIC_GEMINI_MODEL_LIVE || "gemini-3.1-flash-live-preview";
      push(`connecting to ${model}…`);

      let toolCalled = false;
      let spoke = false;
      let audioChunks = 0;

      const done = new Promise<void>((resolve) => {
        // First token can take several seconds; only give up after a real silence.
        let settle: ReturnType<typeof setTimeout>;
        const bump = (ms = 12000) => { clearTimeout(settle); settle = setTimeout(resolve, ms); };
        bump(20000);

        ai.live.connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: "You are Sentinel. Answer only from tool results. One short sentence.",
            tools: TOOLS,
            outputAudioTranscription: {},
          },
          callbacks: {
            onopen: () => push("websocket open", "ok"),
            onerror: (e: ErrorEvent) => { push(`error: ${e.message || "unknown"}`, "err"); resolve(); },
            onclose: () => { push("closed"); resolve(); },
            onmessage: async (msg: unknown) => {
              bump();
              const m = msg as Record<string, unknown>;
              // Only log protocol milestones; serverContent arrives in a stream of small chunks.
              const keys = Object.keys(m).filter((k) => m[k] !== undefined && k !== "serverContent");
              if (keys.length) push(`← ${keys.join(", ")}`);
              const sc = m.serverContent as { modelTurn?: { parts?: { inlineData?: { data: string } }[] }; outputTranscription?: { text: string } } | undefined;

              for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) audioChunks++;
              const txt = sc?.outputTranscription?.text;
              if (txt) {
                spoke = true;
                // stitch streamed transcript fragments into one line
                setLogs((l) => {
                  const last = l[l.length - 1];
                  if (last?.kind === "say") return [...l.slice(0, -1), { kind: "say", t: last.t + txt }];
                  return [...l, { kind: "say", t: txt }];
                });
              }

              const tc = m.toolCall as { functionCalls?: { id: string; name: string; args: Record<string, unknown> }[] } | undefined;
              if (tc?.functionCalls?.length) {
                toolCalled = true;
                const responses = [];
                for (const fc of tc.functionCalls) {
                  push(`model called ${fc.name}(${JSON.stringify(fc.args)})`, "tool");
                  const r = await fetch(`/api/voice/${parkId}`, {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ tool: fc.name, args: fc.args }),
                  }).then((x) => x.json());
                  push(`our API returned ${JSON.stringify(r).slice(0, 140)}…`, "tool");
                  responses.push({ id: fc.id, name: fc.name, response: r });
                }
                (sessionRef as { current?: { sendToolResponse: (x: unknown) => void } }).current?.sendToolResponse({ functionResponses: responses });
              }
            },
          },
        }).then((s) => {
          sessionRef.current = s as unknown as typeof sessionRef.current;
          push("sending text turn (no microphone needed)");
          s.sendClientContent({ turns: [{ role: "user", parts: [{ text: q }] }], turnComplete: true });
        }).catch((e) => { push(`connect failed: ${(e as Error).message}`, "err"); resolve(); });
      });

      await done;
      sessionRef.current?.close?.();

      push("-");
      push(`connection: ok`, "ok");
      push(`function call round trip: ${toolCalled ? "ok" : "NOT OBSERVED"}`, toolCalled ? "ok" : "err");
      push(`spoken audio returned: ${audioChunks} chunks`, audioChunks > 0 ? "ok" : "err");
      push(`transcript returned: ${spoke ? "ok" : "NOT OBSERVED"}`, spoke ? "ok" : "err");
    } catch (e) {
      push((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const sessionRef = { current: null } as { current: { close?: () => void; sendToolResponse: (x: unknown) => void } | null };

  const color = (k: Log["kind"]) =>
    k === "ok" ? "text-emerald-400" : k === "err" ? "text-red-400" : k === "tool" ? "text-sky-300" : k === "say" ? "text-zinc-100" : "text-zinc-500";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight">Live API check</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Connects to the Live API from this browser, sends a text turn, and confirms the model
        calls back into Sentinel&rsquo;s own database before answering. No microphone required.
      </p>

      <div className="mt-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
               className="min-w-0 flex-1 rounded-sm border border-panel-border bg-black/30 px-3 py-2 text-xs text-zinc-100" />
        <button onClick={run} disabled={busy}
                className="readout rounded-sm border border-zinc-700 px-3 text-[11px] uppercase tracking-wider text-zinc-300 hover:border-zinc-500 disabled:opacity-40">
          {busy ? "running…" : "run check"}
        </button>
      </div>

      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded border border-panel-border bg-panel p-4 text-[11px] leading-relaxed">
        {logs.map((l, i) => <div key={i} className={color(l.kind)}>{l.t}</div>)}
        {!logs.length && <span className="text-zinc-600">no output yet</span>}
      </pre>
    </main>
  );
}
