"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ToolListUnion } from "@google/genai";
import { AGENT_TOOL_DECLARATIONS, AGENT_VOICE, CLIENT_TOOLS, MUTATING_TOOLS, agentSystemPrompt } from "@/lib/agent-tools";

// A hovering agent available on every page. Holds one Gemini Live session and can both answer
// from the database and operate the dashboard: navigate, scroll, read the screen aloud, write a
// briefing, compile a dossier, refresh fires.
//
// It lives in the root layout so client-side navigation does NOT tear down the session - the
// agent keeps talking while the page changes underneath it.

type Status = "idle" | "connecting" | "live" | "error";
type Line = { who: "you" | "sentinel" | "action"; text: string };

const TOOLS = [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }] as unknown as ToolListUnion;
const isClientTool = (n: string) => (CLIENT_TOOLS as readonly string[]).includes(n);
const isMutating = (n: string) => (MUTATING_TOOLS as readonly string[]).includes(n);

/** Human-readable description of where the user is, for the system prompt. */
function describeView(pathname: string) {
  if (pathname === "/") return "the landing page explaining what Sentinel is";
  if (pathname === "/globe") return "the globe - planetary fire triage and the priority queue";
  if (pathname.startsWith("/park/")) return "a park mission control page";
  if (pathname === "/backtest") return "the Pantanal 2024 backtest";
  if (pathname.startsWith("/dossier/")) return "an evidence dossier";
  if (pathname === "/voice-check") return "the Live API diagnostic page";
  return pathname;
}

export default function AgentDock() {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [muted, setMuted] = useState(false);

  const sessionRef = useRef<{ close: () => void; sendRealtimeInput: (x: unknown) => void; sendToolResponse: (x: unknown) => void; sendClientContent: (x: unknown) => void } | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playAtRef = useRef(0);
  const mutedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The session outlives navigation, so tools must read the CURRENT path, not a closed-over one.
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [lines]);

  const say = (who: Line["who"], text: string) =>
    setLines((l) => {
      const last = l[l.length - 1];
      if (last?.who === who && who !== "action") return [...l.slice(0, -1), { who, text: last.text + text }];
      return [...l, { who, text }];
    });

  const currentParkId = () => {
    const m = pathRef.current.match(/^\/park\/([^/]+)/);
    return m?.[1] ?? null;
  };

  /** Tools that need the DOM or the router. */
  const runClientTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (name === "navigate") {
        const view = String(args.view ?? "");
        const target =
          view === "home" ? "/"
          : view === "globe" ? "/globe"
          : view === "backtest" ? "/backtest"
          : view === "park" ? (args.park_id ? `/park/${args.park_id}` : null)
          : view === "dossier" ? (args.dossier_id ? `/dossier/${args.dossier_id}` : null)
          : null;
        if (!target) return { ok: false, error: `cannot navigate to '${view}' without an id` };
        say("action", `→ opening ${target}`);
        router.push(target);
        return { ok: true, now_at: target };
      }

      if (name === "scroll_to") {
        const want = String(args.section ?? "").toLowerCase();
        const heads = Array.from(document.querySelectorAll("h1,h2,h3"));
        const hit = heads.find((h) => (h.textContent ?? "").toLowerCase().includes(want));
        if (!hit) return { ok: false, note: `no panel matching "${want}" on this page`, available: heads.map((h) => h.textContent?.trim()).filter(Boolean).slice(0, 12) };
        hit.scrollIntoView({ behavior: "smooth", block: "center" });
        say("action", `→ scrolled to ${hit.textContent?.trim()}`);
        return { ok: true, scrolled_to: hit.textContent?.trim() };
      }

      if (name === "read_view") {
        const main = document.querySelector("main");
        const text = (main as HTMLElement | null)?.innerText ?? document.body.innerText;
        const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((h) => h.textContent?.trim()).filter(Boolean);
        say("action", "→ reading the screen");
        return {
          view: describeView(pathRef.current),
          path: pathRef.current,
          panels: headings.slice(0, 15),
          // generous but bounded: the Live session has a 65k context to protect
          visible_text: text.replace(/\n{3,}/g, "\n\n").slice(0, 5000),
        };
      }

      return { error: `unknown client tool ${name}` };
    },
    [router]
  );

  const stop = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    inCtxRef.current?.close().catch(() => {});
    outCtxRef.current?.close().catch(() => {});
    inCtxRef.current = outCtxRef.current = null;
    playAtRef.current = 0;
    setStatus("idle");
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async (opts: { mic?: boolean; alert?: string } = {}) => {
    const wantMic = opts.mic !== false;
    setErr(null);
    setStatus("connecting");
    try {
      const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!key) throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is not set");

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: key });

      // Live API returns 24 kHz PCM and expects 16 kHz PCM in.
      const outCtx = new AudioContext({ sampleRate: 24000 });
      outCtxRef.current = outCtx;

      let parkName: string | null = null;
      const pid = currentParkId();
      if (pid) {
        parkName = await fetch("/api/agent", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ tool: "find_park", args: { name: "" } }),
        })
          .then((r) => r.json())
          .then((j: { matches?: { id: string; name: string }[] }) => j.matches?.find((m) => m.id === pid)?.name ?? pid)
          .catch(() => pid);
      }

      const session = await ai.live.connect({
        model: process.env.NEXT_PUBLIC_GEMINI_MODEL_LIVE || "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: AGENT_VOICE } } },
          systemInstruction: agentSystemPrompt(describeView(pathRef.current), parkName) +
            (opts.alert ? `\n\nURGENT: as soon as the connection opens, say exactly this and then stop and wait: "${opts.alert}"` : ""),
          tools: TOOLS,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => setStatus("live"),
          onerror: (e: ErrorEvent) => { setErr(e.message || "connection error"); setStatus("error"); },
          onclose: () => setStatus("idle"),
          onmessage: async (msg: unknown) => {
            const m = msg as Record<string, unknown>;
            const sc = m.serverContent as {
              modelTurn?: { parts?: { inlineData?: { data: string } }[] };
              outputTranscription?: { text: string };
              inputTranscription?: { text: string };
              interrupted?: boolean;
            } | undefined;

            for (const p of sc?.modelTurn?.parts ?? []) {
              const b64 = p.inlineData?.data;
              if (!b64) continue;
              const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
              const pcm = new Int16Array(bytes.buffer);
              const buf = outCtx.createBuffer(1, pcm.length, 24000);
              const ch = buf.getChannelData(0);
              for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
              const src = outCtx.createBufferSource();
              src.buffer = buf;
              src.connect(outCtx.destination);
              playAtRef.current = Math.max(playAtRef.current, outCtx.currentTime);
              src.start(playAtRef.current);
              playAtRef.current += buf.duration;
            }
            if (sc?.interrupted) playAtRef.current = 0;
            if (sc?.outputTranscription?.text) say("sentinel", sc.outputTranscription.text);
            if (sc?.inputTranscription?.text) say("you", sc.inputTranscription.text);

            const tc = m.toolCall as { functionCalls?: { id: string; name: string; args: Record<string, unknown> }[] } | undefined;
            if (!tc?.functionCalls?.length) return;

            const responses = await Promise.all(tc.functionCalls.map(async (fc) => {
              const args = fc.args ?? {};
              try {
                if (isClientTool(fc.name)) {
                  return { id: fc.id, name: fc.name, response: await runClientTool(fc.name, args) };
                }
                // Fill in the park the ranger is looking at when they did not name one.
                // Tools that take no park_id simply ignore it.
                if (!args.park_id) {
                  const pid = currentParkId();
                  if (pid) args.park_id = pid;
                }
                const label = fc.name.replace(/_/g, " ");
                say("action", `→ ${label}${args.park_id ? ` · ${args.park_id}` : ""}`);
                const r = await fetch("/api/agent", {
                  method: "POST", headers: { "content-type": "application/json" },
                  body: JSON.stringify({ tool: fc.name, args }),
                }).then((x) => x.json());
                // The agent just changed stored data. Pull the server components again so the
                // ranger sees the new numbers instead of being told to reload the page.
                if (isMutating(fc.name) && r?.ok !== false) {
                  router.refresh();
                  say("action", "→ view refreshed");
                }
                return { id: fc.id, name: fc.name, response: r };
              } catch (e) {
                return { id: fc.id, name: fc.name, response: { error: (e as Error).message } };
              }
            }));
            sessionRef.current?.sendToolResponse({ functionResponses: responses });
          },
        },
      });
      sessionRef.current = session as unknown as typeof sessionRef.current;

      if (wantMic) {
        const inCtx = new AudioContext({ sampleRate: 16000 });
        inCtxRef.current = inCtx;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;
        const source = inCtx.createMediaStreamSource(stream);
        const node = inCtx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          if (mutedRef.current) return;
          const f32 = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(f32.length);
          for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-1, Math.min(1, f32[i])) * 32767;
          let bin = "";
          const b = new Uint8Array(pcm.buffer);
          for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
          sessionRef.current?.sendRealtimeInput({ audio: { data: btoa(bin), mimeType: "audio/pcm;rate=16000" } });
        };
        source.connect(node);
        node.connect(inCtx.destination);
      }

      if (opts.alert) say("action", "→ critical detection - briefing you now");
    } catch (e) {
      setErr((e as Error).message);
      setStatus("error");
      stop();
    }
  }, [runClientTool, stop]);

  /** Typed input - works without a microphone, and is the on-stage fallback. */
  const send = async () => {
    const q = typed.trim();
    if (!q) return;
    setTyped("");
    if (!sessionRef.current) await start({ mic: false });
    // give the socket a moment if it was just opened
    for (let i = 0; i < 40 && !sessionRef.current; i++) await new Promise((r) => setTimeout(r, 50));
    say("you", q);
    sessionRef.current?.sendClientContent({ turns: [{ role: "user", parts: [{ text: q }] }], turnComplete: true });
  };

  /** Raise a call when a fresh severity-5 detection lands at the park being viewed.
   *  Piggybacks on the event feed's existing poll rather than opening a second one. */
  useEffect(() => {
    if (!currentParkId()) return;
    const seen = new Set<number>();
    let primed = false;

    const consider = (events: { id: number; severity: number; kind: string; summary: string; occurred_at: string }[]) => {
      const critical = events.filter((e) => e.severity >= 5);
      if (!primed) { critical.forEach((e) => seen.add(e.id)); primed = true; return; }
      const fresh = critical.find((e) => !seen.has(e.id));
      if (!fresh || status !== "idle") return;
      seen.add(fresh.id);
      setOpen(true);
      setLines([]);
      start({ alert: `${fresh.kind} detected at ${new Date(fresh.occurred_at).toISOString().slice(11, 16)} UTC. ${fresh.summary}` });
    };

    const onEvents = (e: Event) => consider((e as CustomEvent).detail ?? []);
    window.addEventListener("sentinel:events", onEvents);

    // Prime once so an already-present alert does not fire on arrival.
    fetch(`/api/parks/${currentParkId()}/events`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(consider)
      .catch(() => {});

    return () => window.removeEventListener("sentinel:events", onEvents);
  }, [pathname, status, start]);

  const live = status === "live";

  return (
    <>
      {/* dock */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex max-h-[70vh] w-[min(92vw,23rem)] flex-col overflow-hidden rounded-lg border border-panel-border bg-panel/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 border-b border-panel-border px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-400 pulse-alert" : status === "connecting" ? "bg-amber-400" : status === "error" ? "bg-red-500" : "bg-zinc-600"}`} />
              <span className="readout text-[10px] uppercase tracking-[0.18em] text-zinc-300">Sentinel agent</span>
            </div>
            <div className="flex items-center gap-1.5">
              {live && (
                <button onClick={() => setMuted((v) => !v)}
                        className="readout rounded-sm border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400 hover:text-zinc-100">
                  {muted ? "unmute" : "mute"}
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close agent"
                      className="readout px-1 text-xs text-zinc-500 hover:text-zinc-200">✕</button>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-24 flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
            {lines.length === 0 && (
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Ask by voice or type. I can move around the dashboard, read what is on screen,
                  and run what is on it.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["Take me to the worst-hit park", "Read this page to me", "What happened overnight?", "Compile a dossier"].map((s) => (
                    <button key={s} onClick={() => { setTyped(s); }}
                            className="rounded-sm border border-panel-border px-1.5 py-1 text-[10px] leading-tight text-zinc-400 hover:border-zinc-600 hover:text-zinc-200">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lines.slice(-40).map((l, i) => (
              <p key={i} className={`text-xs leading-relaxed ${
                l.who === "you" ? "text-zinc-500" : l.who === "action" ? "readout text-[10px] text-sky-300" : "text-zinc-100"}`}>
                {l.who !== "action" && <span className="readout mr-1.5 text-[9px] uppercase text-zinc-500">{l.who}</span>}
                {l.text}
              </p>
            ))}
            {err && <p className="text-xs text-red-400">{err}</p>}
          </div>

          <div className="border-t border-panel-border p-2.5">
            <div className="flex gap-1.5">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                placeholder="Type, or use the mic…"
                className="min-w-0 flex-1 rounded-sm border border-panel-border bg-black/40 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <button onClick={send}
                      className="readout rounded-sm border border-zinc-700 px-2 text-[10px] uppercase text-zinc-300 hover:border-zinc-500">
                send
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              {live ? (
                <button onClick={stop} className="readout rounded-sm border border-red-500/50 px-2.5 py-1 text-[10px] uppercase tracking-wider text-red-400 hover:bg-red-500/10">
                  end session
                </button>
              ) : (
                <button onClick={() => start()} disabled={status === "connecting"}
                        className="readout rounded-sm bg-emerald-600 px-2.5 py-1 text-[10px] uppercase tracking-wider text-white hover:bg-emerald-500 disabled:opacity-40">
                  {status === "connecting" ? "connecting…" : "start voice"}
                </button>
              )}
              <span className="readout text-[9px] text-zinc-500">Live API · unlimited</span>
            </div>
          </div>
        </div>
      )}

      {/* hovering button */}
      <button
        onClick={() => { setOpen((v) => !v); if (!open && status === "idle") setLines([]); }}
        aria-label="Sentinel voice agent"
        className={`fixed bottom-4 right-4 z-50 flex h-12 items-center gap-2 rounded-full border px-4 shadow-xl transition-colors ${
          live ? "border-emerald-500/60 bg-emerald-600/20 text-emerald-300" : "border-panel-border bg-panel/95 text-zinc-300 hover:border-zinc-600"}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 19v3" />
        </svg>
        <span className="readout text-[10px] uppercase tracking-[0.16em]">
          {live ? (muted ? "muted" : "listening") : "ask sentinel"}
        </span>
      </button>
    </>
  );
}
