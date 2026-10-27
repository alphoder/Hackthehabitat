import { writeFile, mkdir } from "node:fs/promises";
import { GoogleGenAI, Modality } from "@google/genai";

// Which prebuilt voices does the Live model actually accept, and what do they sound like?
// npm run s scripts/check-voices.ts
//
// Writes a WAV per accepted voice to data/voices/ so they can be auditioned before choosing.
// Live API usage is unlimited, so this costs no quota.

const MODEL = process.env.GEMINI_MODEL_LIVE ?? "gemini-3.1-flash-live-preview";
const LINE = "Sentinel online. Chainsaw detected at zero two forty, Little River watershed. Wind pushing north-east.";

// Candidates that are documented or commonly reported as male / lower register.
const CANDIDATES = [
  "Charon", "Orus", "Fenrir", "Puck", "Iapetus", "Algenib",
  "Alnilam", "Rasalgethi", "Sadaltager", "Umbriel", "Enceladus", "Zubenelgenubi",
];

/** Minimal WAV header so the PCM the API returns is playable. */
function wav(pcm: Buffer, sampleRate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function tryVoice(ai: GoogleGenAI, voiceName: string) {
  const chunks: Buffer[] = [];
  let error: string | undefined;

  await new Promise<void>((resolve) => {
    let settle: ReturnType<typeof setTimeout>;
    const bump = (ms: number) => { clearTimeout(settle); settle = setTimeout(resolve, ms); };
    bump(15000);

    ai.live.connect({
      model: MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        systemInstruction: "Repeat the user's line exactly, once, then stop.",
      },
      callbacks: {
        onopen: () => {},
        onerror: (e: ErrorEvent) => { error = e.message || "connection error"; resolve(); },
        onclose: (e: CloseEvent) => { if (!chunks.length && e?.reason) error = e.reason; resolve(); },
        onmessage: (msg: unknown) => {
          bump(3000);
          const sc = (msg as Record<string, unknown>).serverContent as
            { modelTurn?: { parts?: { inlineData?: { data: string } }[] } } | undefined;
          for (const p of sc?.modelTurn?.parts ?? []) {
            if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, "base64"));
          }
        },
      },
    })
      .then((s) => s.sendClientContent({ turns: [{ role: "user", parts: [{ text: LINE }] }], turnComplete: true }))
      .catch((e) => { error = (e as Error).message; resolve(); });
  });

  return { voiceName, ok: chunks.length > 0, bytes: Buffer.concat(chunks).length, pcm: Buffer.concat(chunks), error: error as string | undefined };
}

async function main() {
  await mkdir("data/voices", { recursive: true });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const rows: Record<string, unknown>[] = [];
  for (const v of CANDIDATES) {
    const r = await tryVoice(ai, v);
    if (r.ok) await writeFile(`data/voices/${v}.wav`, wav(r.pcm));
    rows.push({ voice: v, accepted: r.ok, kb: Math.round(r.bytes / 1024), error: r.error?.slice(0, 60) ?? "" });
    console.log(`${r.ok ? "OK  " : "FAIL"} ${v.padEnd(14)} ${(r.bytes / 1024).toFixed(0)}KB ${r.error ? "· " + r.error.slice(0, 70) : ""}`);
  }
  console.table(rows);
  console.log("\naudition: open data/voices/*.wav");
}

main();
