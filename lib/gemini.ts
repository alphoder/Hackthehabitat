import { GoogleGenAI } from "@google/genai";

// The ONLY place Gemini is called. Two quota pools of 500 req/day at 15 RPM:
//   BULK   - image + audio classification
//   REASON - briefings, chat, dossiers
// Never swap the roles; that merges the pools and halves the day's budget.

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY missing");

export const MODEL = {
  bulk: process.env.GEMINI_MODEL_BULK ?? "gemini-3.1-flash-lite",
  reason: process.env.GEMINI_MODEL_REASON ?? "gemini-3.5-flash-lite",
  live: process.env.GEMINI_MODEL_LIVE ?? "gemini-3.1-flash-live-preview",
};

const ai = new GoogleGenAI({ apiKey });

// 15 RPM = one call per 4s. Serialise per model and keep ≥4.2s between calls.
const MIN_GAP_MS = 4200;
const queues = new Map<string, Promise<unknown>>();
const lastCall = new Map<string, number>();
export const callCount: Record<string, number> = {};

function enqueue<T>(model: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(model) ?? Promise.resolve();
  const next = prev.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - (lastCall.get(model) ?? 0));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall.set(model, Date.now());
    callCount[model] = (callCount[model] ?? 0) + 1;
    return fn();
  });
  queues.set(model, next.catch(() => {}));
  return next;
}

/** Parse JSON defensively - models occasionally wrap output in prose or fences. */
export function parseJson<T>(raw: string, fallback: T): T {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) { try { return JSON.parse(m[0]) as T; } catch { /* fall through */ } }
    return fallback;
  }
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

async function call(
  model: string,
  parts: Part[],
  opts: { json?: boolean; system?: string; temperature?: number; maxOutputTokens?: number } = {}
) {
  return enqueue(model, async () => {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(opts.system ? { systemInstruction: opts.system } : {}),
        temperature: opts.temperature ?? 0.2,
        // A 12-image batch truncated its JSON array at the default cap, silently dropping
        // verdicts for the tail of every batch. Give the array room.
        maxOutputTokens: opts.maxOutputTokens ?? 8192,
      },
    });
    return res.text ?? "";
  });
}

// ---------------------------------------------------------------- classification

export type ImageVerdict = {
  index: number;
  label: string;        // species common name, "human", "vehicle", or "blank"
  category: "animal" | "human" | "vehicle" | "blank" | "other";
  count: number;
  confidence: number;   // 0-1
  note: string;
};

const IMAGE_PROMPT = `You are analysing camera-trap frames from a protected area.
For EACH image, in order, report what it contains.

Rules:
- Most camera-trap frames are empty vegetation triggered by wind. Label those category "blank".
- category "animal": wildlife present. label = common species name (best guess, singular).
- category "human": any person on foot. category "vehicle": any car, truck, motorcycle or cart.
- Humans and vehicles inside a protected area matter more than animals - never miss them.
- count = number of individual subjects visible (0 for blank).
- confidence = your certainty from 0 to 1. Be honest; low confidence is useful.
- note = at most 12 words describing the frame.

Return ONLY a JSON array with one object per image, in the same order:
[{"index":0,"label":"","category":"","count":0,"confidence":0.0,"note":""}]`;

/** Classify 10-16 images in ONE call. Batching is what keeps this inside quota. */
export async function classifyImages(images: { mimeType: string; data: string }[]): Promise<ImageVerdict[]> {
  const parts: Part[] = [{ text: IMAGE_PROMPT }];
  images.forEach((img, i) => {
    parts.push({ text: `Image ${i}:` });
    parts.push({ inlineData: img });
  });
  const raw = await call(MODEL.bulk, parts, { json: true });
  const out = parseJson<ImageVerdict[]>(raw, []);
  if (!Array.isArray(out)) return [];
  // Normalise: the model sometimes omits `index` or returns them out of order.
  return out.map((v, i) => ({ ...v, index: typeof v.index === "number" ? v.index : i }));
}

export type AudioVerdict = {
  label: string;        // chainsaw | gunshot | vehicle | human_voice | animal | rain | wind | ambient | other
  confidence: number;
  timestamp_s: number | null;  // offset within the clip, null if not localisable
  note: string;
};

const AUDIO_PROMPT = `You are analysing a recording from an acoustic sensor in a protected area.
Identify the single most operationally significant sound present.

Priority order (report the highest-priority sound that is actually audible):
1. "chainsaw" - two-stroke motor whose pitch RISES AND FALLS as it bites into wood
2. "handsaw" - manual sawing: rhythmic rasping strokes, no motor
3. "gunshot" - firearm discharge, sharp impulsive crack with no motor
4. "vehicle" - engine at a STEADY pitch, passing or idling; no cutting
5. "human_voice" - speech, shouting, or footsteps
6. "animal" - any wildlife vocalisation (birdsong, insects, calls)
7. "rain", "wind", "ambient" - weather and background only

Distinguishing the machines matters more than anything else here:
- A chainsaw's pitch modulates as it cuts. A vehicle engine holds a steady note. If the
  pitch never changes, it is "vehicle", not "chainsaw".

Weather is the most common cause of false alarms. Before reporting any machine, rule these out:
- WIND: low broadband rumble that swells and fades smoothly. It has NO mechanical firing
  rhythm and no fixed pitch. Steady low roar alone is wind, NOT a vehicle.
- RAIN: continuous broadband hiss made of countless tiny impacts, no pitch at all.
  Rain is NEVER a chainsaw - a chainsaw has an obvious motor tone underneath.
- FIRE: irregular random pops and crackles. Not rhythmic, so never sawing.
A machine label requires a clearly periodic mechanical source. If you cannot hear one,
report the weather or "ambient" instead.

Do NOT invent threats. If it is only forest ambience, say "ambient".
timestamp_s = seconds into the clip where the sound is clearest, or null if it runs throughout.

Return ONLY: {"label":"","confidence":0.0,"timestamp_s":null,"note":"max 12 words"}
label must be exactly one of: chainsaw, handsaw, gunshot, vehicle, human_voice, animal, rain, wind, ambient`;

export async function classifyAudio(clip: { mimeType: string; data: string }): Promise<AudioVerdict> {
  const raw = await call(MODEL.bulk, [{ text: AUDIO_PROMPT }, { inlineData: clip }], { json: true });
  return parseJson<AudioVerdict>(raw, { label: "other", confidence: 0, timestamp_s: null, note: "unparseable response" });
}

// ---------------------------------------------------------------- reasoning

export async function reason(prompt: string, opts: { system?: string; json?: boolean; temperature?: number } = {}) {
  return call(MODEL.reason, [{ text: prompt }], opts);
}

/** Compare two satellite tiles of the same place at different dates. */
export async function compareSatellite(before: { mimeType: string; data: string }, after: { mimeType: string; data: string }, meta: string) {
  const raw = await call(MODEL.bulk, [
    {
      text: `Two satellite images of the same area. ${meta}
Compare them and report only what is visibly different.
Look for: new clearings, burn scars, new roads or tracks, water loss.

Rule out the innocent explanations first:
- SEASONAL DRYING turns vegetation uniformly from green to tan/brown across the whole scene,
  following terrain. That is not a burn scar - report "none".
- A BURN SCAR is dark grey/charcoal/near-black with sharp irregular edges that cut ACROSS
  terrain and vegetation boundaries, often in patches. Only call it a burn scar if you see that.
- CLOUD covering either image makes comparison impossible. Say so rather than guessing.

If you cannot see a clear difference, say so - do not speculate. These are coarse true-colour tiles;
small features may be unresolvable, and that is an acceptable answer.

Return ONLY: {"change":true|false,"type":"clearing|burn_scar|road|water_loss|none","confidence":0.0,"description":"max 25 words"}`,
    },
    { text: "BEFORE:" }, { inlineData: before },
    { text: "AFTER:" }, { inlineData: after },
  ], { json: true });
  return parseJson(raw, { change: false, type: "none", confidence: 0, description: "unparseable response" });
}
