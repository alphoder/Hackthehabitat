import { sql } from "./db";
import { reason } from "./gemini";

// Grounded Q&A. Retrieval is plain SQL; the model only summarises rows it was handed.
// If retrieval returns nothing, the model is told to say so rather than fill the gap.

export type Retrieved = { events: Record<string, unknown>[]; fires: Record<string, unknown>[]; hours: number; place: string | null };

const PLACE_WORDS = ["river", "corridor", "cove", "valley", "watershed", "gap", "ridge", "north", "south", "east", "west", "boundary", "road", "trail"];

/** Pull a time window and optional place hint out of the question. Deliberately simple. */
export function parseQuestion(q: string): { hours: number; place: string | null; kind: string | null } {
  const s = q.toLowerCase();
  let hours = 24;
  if (/week|7 days|seven days/.test(s)) hours = 168;
  else if (/month|30 days/.test(s)) hours = 720;
  else if (/last night|overnight|tonight/.test(s)) hours = 16;
  else if (/hour/.test(s)) hours = Number(s.match(/(\d+)\s*hour/)?.[1] ?? 6);
  else if (/today|24|day/.test(s)) hours = 24;
  else if (/(\d+)\s*days?/.test(s)) hours = Number(s.match(/(\d+)\s*days?/)![1]) * 24;

  const place = PLACE_WORDS.find((w) => s.includes(w)) ?? null;

  let kind: string | null = null;
  if (/chainsaw|logging|cutting|saw/.test(s)) kind = "chainsaw";
  else if (/gun|shot|poach|shoot/.test(s)) kind = "gunshot";
  else if (/vehicle|truck|car|tractor/.test(s)) kind = "vehicle";
  else if (/people|person|human|intrud/.test(s)) kind = "human";
  else if (/animal|wildlife|species|bear|deer/.test(s)) kind = "animal";
  else if (/fire|burn|smoke/.test(s)) kind = "fire";

  return { hours, place, kind };
}

export async function retrieve(parkId: string, question: string): Promise<Retrieved> {
  const { hours, place, kind } = parseQuestion(question);

  const events = (await sql`
    SELECT e.id, e.kind, e.severity, e.occurred_at, e.summary
    FROM events e
    WHERE e.park_id = ${parkId}
      AND e.occurred_at > now() - (${hours} || ' hours')::interval
      AND (${kind}::text IS NULL OR e.kind = ${kind})
      AND (${place}::text IS NULL OR e.summary ILIKE '%' || ${place} || '%')
    ORDER BY e.severity DESC, e.occurred_at DESC
    LIMIT 40`) as Record<string, unknown>[];

  const fires = (await sql`
    SELECT lat, lon, frp, acq_date::text, acq_time, (park_id IS NOT NULL) AS inside
    FROM fires
    WHERE park_id = ${parkId} AND acq_date >= current_date - 2
    ORDER BY frp DESC LIMIT 10`) as Record<string, unknown>[];

  return { events, fires, hours, place };
}

const SYSTEM = `You answer questions from rangers about their protected area.
You are given database rows and nothing else.

- Answer ONLY from the rows provided. If they do not contain the answer, say plainly that
  there are no matching detections in that window. Never guess or extrapolate.
- Cite times (UTC) and sensor names from the rows.
- Camera and acoustic results are machine classifications: say "reported" or "classified as".
- Never predict fire spread. Never invent patrols, arrests, or outcomes.
- Two or three sentences unless asked for detail. Plain language, spoken aloud comfortably.`;

export async function answer(parkId: string, question: string) {
  const r = await retrieve(parkId, question);
  const rows = r.events.length
    ? r.events.map((e) => `- id=${e.id} ${new Date(e.occurred_at as string).toISOString().slice(5, 16).replace("T", " ")}Z sev${e.severity} ${e.kind}: ${e.summary}`).join("\n")
    : "(no events matched)";
  const fireRows = r.fires.length
    ? r.fires.map((f) => `- ${f.acq_date} ${String(f.acq_time).slice(0, 2)}:${String(f.acq_time).slice(2)}Z, ${f.frp} MW inside boundary`).join("\n")
    : "(no fire detections inside the boundary in the last 48h)";

  const text = await reason(
    `Question: "${question}"

Matching sensor events from the last ${r.hours} hours${r.place ? ` mentioning "${r.place}"` : ""}:
${rows}

Fire detections inside the boundary:
${fireRows}

Answer the question.`,
    { system: SYSTEM, temperature: 0.2 }
  );

  return { answer: text.trim(), matched: r.events.length, hours: r.hours };
}
