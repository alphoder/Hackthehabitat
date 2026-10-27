import { sql, type Park } from "./db";
import { haversineKm } from "./geo";
import { zonesOf } from "./park";
import { reason } from "./gemini";

// Clusters coincident high-severity events into an incident, then renders an evidence packet.
// Everything in the dossier traces to a stored row; nothing here is generated from nothing.

const CLUSTER_HOURS = 3;
const CLUSTER_KM = 12;

export type Ev = {
  id: number; kind: string; severity: number; occurred_at: string;
  summary: string; lat: number | null; lon: number | null;
  media_id: number | null; meta: Record<string, unknown> | null;
};

/** Group events that sit close in time and space. Pure function - pass rows you already have. */
export function clusterEvents(input: Ev[]) {
  const events = [...input].sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at));
  const clusters: Ev[][] = [];
  for (const e of events) {
    const near = clusters.find((c) =>
      c.some((o) => {
        const dt = Math.abs(new Date(o.occurred_at).getTime() - new Date(e.occurred_at).getTime()) / 3600_000;
        const dkm = o.lat != null && e.lat != null ? haversineKm({ lat: o.lat, lon: o.lon! }, { lat: e.lat, lon: e.lon! }) : 0;
        return dt <= CLUSTER_HOURS && dkm <= CLUSTER_KM;
      })
    );
    if (near) near.push(e); else clusters.push([e]);
  }
  // Rank: multi-signal clusters first, then by peak severity
  return clusters.sort((a, b) => b.length - a.length || Math.max(...b.map((e) => e.severity)) - Math.max(...a.map((e) => e.severity)));
}

/** Same clustering, but fetches the events itself. Used by the API routes and the agent. */
export async function findClusters(parkId: string, hours = 48) {
  const events = (await sql`
    SELECT id, kind, severity, occurred_at, summary, lat, lon, media_id, meta
    FROM events
    WHERE park_id = ${parkId} AND severity >= 4 AND occurred_at > now() - (${hours} || ' hours')::interval
    ORDER BY occurred_at`) as Ev[];
  return clusterEvents(events);
}

export async function createIncident(parkId: string, eventIds: number[]) {
  const events = (await sql`
    SELECT id, kind, severity, occurred_at, summary FROM events
    WHERE park_id = ${parkId} AND id = ANY(${eventIds}::int[]) ORDER BY occurred_at`) as Ev[];
  if (!events.length) throw new Error("no matching events");

  const kinds = [...new Set(events.map((e) => e.kind))];
  const title = `${kinds.join(" + ")} - ${events.length} signal${events.length > 1 ? "s" : ""}, ${new Date(events[0].occurred_at).toISOString().slice(0, 10)}`;

  const [row] = (await sql`
    INSERT INTO incidents (park_id, title, event_ids) VALUES (${parkId}, ${title}, ${eventIds}::int[])
    RETURNING id, title`) as { id: number; title: string }[];
  return row;
}

/** Simple SVG locator map - prints cleanly and needs no tile server or key. */
function locatorSvg(park: Park, events: Ev[]) {
  const zones = zonesOf(park);
  const pts = events.filter((e) => e.lat != null) as (Ev & { lat: number; lon: number })[];
  const all = [...zones.flatMap((z) => z.ring), ...pts.map((p) => [p.lon, p.lat])];
  if (!all.length) return "";

  const lons = all.map((p) => p[0]), lats = all.map((p) => p[1]);
  const pad = 0.02;
  const [x0, x1] = [Math.min(...lons) - pad, Math.max(...lons) + pad];
  const [y0, y1] = [Math.min(...lats) - pad, Math.max(...lats) + pad];
  const W = 640, H = 360;
  const sx = (lon: number) => ((lon - x0) / (x1 - x0)) * W;
  const sy = (lat: number) => H - ((lat - y0) / (y1 - y0)) * H;

  const zonePaths = zones.map((z) =>
    `<polygon points="${z.ring.map(([lon, lat]) => `${sx(lon).toFixed(1)},${sy(lat).toFixed(1)}`).join(" ")}" fill="#dbeafe" stroke="#60a5fa" stroke-width="1"/>
     <text x="${sx(z.ring[0][0]).toFixed(1)}" y="${(sy(z.ring[0][1]) - 4).toFixed(1)}" font-size="10" fill="#1e40af">${z.name}</text>`
  ).join("");

  const marks = pts.map((p, i) =>
    `<circle cx="${sx(p.lon).toFixed(1)}" cy="${sy(p.lat).toFixed(1)}" r="7" fill="${p.severity >= 5 ? "#dc2626" : "#f59e0b"}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"/>
     <text x="${sx(p.lon).toFixed(1)}" y="${(sy(p.lat) + 3.5).toFixed(1)}" font-size="9" fill="#fff" text-anchor="middle" font-weight="bold">${i + 1}</text>`
  ).join("");

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px">
    ${zonePaths}${marks}
  </svg>`;
}

const SYSTEM = `You prepare evidence summaries for protected-area enforcement.
The reader may be a prosecutor. Precision matters more than fluency.

- Every claim must trace to a listed detection. Never add facts.
- These are machine classifications from camera and acoustic sensors. Describe them as
  "an automated classifier reported X", never as confirmed fact.
- State plainly what the evidence does NOT establish. That is the most important part.
- No speculation about who, or intent. No predicted fire behaviour.`;

export async function generateDossier(incidentId: number) {
  const [inc] = (await sql`SELECT * FROM incidents WHERE id = ${incidentId}`) as
    { id: number; park_id: string; title: string; event_ids: number[]; created_at: string }[];
  if (!inc) throw new Error("incident not found");

  const [park] = (await sql`SELECT * FROM parks WHERE id = ${inc.park_id}`) as Park[];
  const events = (await sql`
    SELECT e.id, e.kind, e.severity, e.occurred_at, e.summary, e.lat, e.lon, e.media_id, e.meta,
           m.kind AS media_kind, m.path AS media_path, m.captured_at
    FROM events e LEFT JOIN media m ON m.id = e.media_id
    WHERE e.id = ANY(${inc.event_ids}::int[]) ORDER BY e.occurred_at`) as (Ev & { media_kind: string | null; media_path: string | null })[];

  const timeline = events.map((e) =>
    `${new Date(e.occurred_at).toISOString().replace("T", " ").slice(0, 16)}Z | ${e.kind} (severity ${e.severity}) | ${e.summary} | confidence ${e.meta?.confidence ?? "n/a"} | source ${e.meta?.source ?? "n/a"}`
  ).join("\n");

  const assessment = await reason(
    `Protected area: ${park.name}, ${park.country}
Incident: ${inc.title}

Detections, in order:
${timeline}

Write three short sections in markdown, no preamble:

### What the sensors recorded
Plain factual recounting with times.

### What this is consistent with
The most likely interpretation, and at least one innocent alternative that fits the same
evidence (park maintenance, legal activity nearby, classifier error). Be even-handed.

### What this evidence does not establish
Be specific and thorough. Include the limits of automated classification, the absence of
visual confirmation for sound-only detections, and anything a defence would rightly point out.`,
    { system: SYSTEM, temperature: 0.2 }
  );

  const authority = park.country === "United States" ? "National Park Service - Investigative Services Branch"
    : park.country === "India" ? "Divisional Forest Officer, State Forest Department"
    : park.country === "Brazil" ? "IBAMA - Instituto Brasileiro do Meio Ambiente"
    : `Protected area authority, ${park.country}`;

  const md = (s: string) => s
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split("\n\n").map((p) => (p.startsWith("<h3>") ? p : `<p>${p.replace(/\n/g, " ")}</p>`)).join("\n");

  const html = `<!doctype html><meta charset="utf-8">
<style>
  @page { margin: 18mm; }
  body { font: 12px/1.65 "IBM Plex Sans", system-ui, sans-serif; color: #0f172a; max-width: 820px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; color: #64748b; margin: 28px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
  h3 { font-size: 13px; margin: 16px 0 5px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 4px; }
  .ref { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 11px; color: #64748b; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th { text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #cbd5e1; padding: 5px 6px; }
  td { border-bottom: 1px solid #f1f5f9; padding: 5px 6px; vertical-align: top; }
  .sev5 { color: #b91c1c; font-weight: 600; }
  .sev4 { color: #b45309; font-weight: 600; }
  .note { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 3px; padding: 10px 12px; font-size: 11px; margin: 14px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
  .grid figure { margin: 0; }
  .grid img { width: 100%; border: 1px solid #cbd5e1; border-radius: 3px; display: block; }
  .grid figcaption { font-size: 9.5px; color: #64748b; margin-top: 3px; }
  footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; }
  @media print { body { padding: 0; } .noprint { display: none; } }
</style>
<h1>Evidence packet - ${inc.title}</h1>
<div class="sub">${park.name}, ${park.country}</div>
<div class="ref">Incident SEN-${String(inc.id).padStart(5, "0")} · compiled ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z · prepared for ${authority}</div>

<div class="note"><strong>Nature of this document.</strong> Automatically compiled from sensor
detections classified by an AI model. It is an investigative lead, not proof of an offence.
Every detection below is a machine classification that has not been verified by a person.</div>

<h2>Location</h2>
${locatorSvg(park, events)}

<h2>Timeline</h2>
<table>
  <tr><th>Time (UTC)</th><th>Type</th><th>Sensor detection</th><th>Model confidence</th></tr>
  ${events.map((e) => `<tr>
    <td class="ref">${new Date(e.occurred_at).toISOString().replace("T", " ").slice(0, 16)}</td>
    <td class="sev${e.severity}">${e.kind}</td>
    <td>${e.summary}</td>
    <td class="ref">${e.meta?.confidence != null ? Number(e.meta.confidence).toFixed(2) : "-"}</td>
  </tr>`).join("")}
</table>

${events.some((e) => e.media_kind === "image") ? `<h2>Camera evidence</h2><div class="grid">
  ${events.filter((e) => e.media_kind === "image").map((e) => `<figure>
    <img src="/api/media/${e.media_id}" alt="camera frame for event ${e.id}"/>
    <figcaption>Event ${e.id} · ${new Date(e.occurred_at).toISOString().slice(0, 16).replace("T", " ")}Z</figcaption>
  </figure>`).join("")}
</div>` : ""}

${events.some((e) => e.media_kind === "audio") ? `<h2>Acoustic evidence</h2>
  ${events.filter((e) => e.media_kind === "audio").map((e) => `<p><strong>Event ${e.id}</strong> - ${e.summary}<br/>
    <span class="ref">Recording: ${e.media_path} · offset ${e.meta?.timestamp_s ?? "not localised"} s</span><br/>
    <audio controls src="/api/media/${e.media_id}" class="noprint"></audio></p>`).join("")}` : ""}

<h2>Assessment</h2>
${md(assessment)}

<footer>
  Sentinel · fire detections from NASA FIRMS (VIIRS S-NPP) · camera and acoustic detections
  classified by ${process.env.GEMINI_MODEL_BULK} · assessment written by ${process.env.GEMINI_MODEL_REASON}.
  Sensor feeds are a field simulation replaying real recorded media. Boundary geometry is approximate.
</footer>`;

  await sql`UPDATE incidents SET dossier_html = ${html} WHERE id = ${incidentId}`;
  return { id: incidentId, html };
}
