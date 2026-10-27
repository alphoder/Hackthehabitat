// Tool surface for the hovering agent. Shared between the browser (which declares them to the
// Live API and runs the view-level ones) and the server route (which runs data and actions).
//
// Split rule: anything that needs the DOM or the router runs CLIENT side. Anything that touches
// the database or Gemini runs SERVER side. The agent cannot invent data - every factual answer
// comes back through one of these.

export const CLIENT_TOOLS = ["navigate", "read_view", "scroll_to"] as const;

/** Tools that change stored state - the view must be re-rendered after these or the ranger
 *  is looking at stale numbers while the agent claims it updated something. */
export const MUTATING_TOOLS = ["refresh_fires", "write_briefing", "build_dossier"] as const;

/** Deep, level, unhurried. Confirmed accepted by gemini-3.1-flash-live-preview on 2026-08-17;
 *  audition the alternatives in data/voices/ (npm run s scripts/check-voices.ts).
 *  Other verified male voices: Orus, Fenrir, Iapetus, Sadaltager, Puck. */
export const AGENT_VOICE = process.env.NEXT_PUBLIC_AGENT_VOICE || "Charon";

export const AGENT_TOOL_DECLARATIONS = [
  // ---- moving around ----
  {
    name: "navigate",
    description:
      "Move the browser to a section of Sentinel. Use this whenever the ranger asks to go, open, show, or take them somewhere.",
    parameters: {
      type: "OBJECT",
      properties: {
        view: {
          type: "STRING",
          description: "One of: home (the landing page explaining Sentinel), globe (the planetary view and priority queue), park (one park's mission control), backtest (the Pantanal 2024 replay), dossier (an evidence packet).",
        },
        park_id: { type: "STRING", description: "Required when view is 'park'. The park id, e.g. great-smoky, kaziranga, kakadu." },
        dossier_id: { type: "NUMBER", description: "Required when view is 'dossier'." },
      },
      required: ["view"],
    },
  },
  {
    name: "read_view",
    description:
      "Read what is currently on screen. Use this when the ranger asks what they are looking at, asks you to read the page or a panel aloud, or asks about something visible.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "scroll_to",
    description: "Scroll a named panel into view, e.g. 'briefing', 'event feed', 'open cases', 'threat picture', 'species'.",
    parameters: {
      type: "OBJECT",
      properties: { section: { type: "STRING", description: "Words from the panel heading." } },
      required: ["section"],
    },
  },

  // ---- reading data ----
  {
    name: "get_global_summary",
    description: "Planet-wide status: how many protected areas have fire intrusions right now, and the worst-hit ones. Use for any question about the global picture or which park is worst.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "find_park",
    description: "Look up a park id by name, or list the parks that have field sensors. Call this before navigating if you only know a park's name.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Part of the park name to search for." },
        featured_only: { type: "BOOLEAN", description: "True to list only parks with a deployed sensor network." },
      },
    },
  },
  {
    name: "get_park_status",
    description: "Fires, weather and event counts for one park. Use for 'what is the situation at X'.",
    parameters: {
      type: "OBJECT",
      properties: { park_id: { type: "STRING" } },
      required: ["park_id"],
    },
  },
  {
    name: "get_recent_events",
    description: "Sensor detections at a park - animals seen, sounds heard, people or vehicles.",
    parameters: {
      type: "OBJECT",
      properties: {
        park_id: { type: "STRING" },
        hours: { type: "NUMBER", description: "How far back, in hours. Default 24, max 168." },
        kind: { type: "STRING", description: "Optional filter: chainsaw, gunshot, vehicle, human, animal." },
      },
      required: ["park_id"],
    },
  },
  {
    name: "search_record",
    description: "Free-text search of the detection record when the question names a place or a longer period, e.g. 'near the river last week'.",
    parameters: {
      type: "OBJECT",
      properties: { park_id: { type: "STRING" }, question: { type: "STRING", description: "The question, verbatim." } },
      required: ["park_id", "question"],
    },
  },
  {
    name: "read_briefing",
    description: "Read back the stored ranger briefing for a park. Use when asked to read or summarise the briefing. Does NOT write a new one.",
    parameters: {
      type: "OBJECT",
      properties: { park_id: { type: "STRING" } },
      required: ["park_id"],
    },
  },
  {
    name: "get_backtest",
    description: "Results of the Pantanal 2024 archive replay: when the escalation was raised and how sharply the fires jumped.",
    parameters: { type: "OBJECT", properties: {} },
  },

  // ---- doing things ----
  {
    name: "write_briefing",
    description: "Generate a NEW ranger briefing for a park from current detections. This spends model quota, so only do it when explicitly asked to write, generate or refresh the briefing.",
    parameters: {
      type: "OBJECT",
      properties: { park_id: { type: "STRING" } },
      required: ["park_id"],
    },
  },
  {
    name: "build_dossier",
    description: "Compile an evidence packet for the most significant open case at a park, then open it. Use when asked for a dossier, evidence packet, or report.",
    parameters: {
      type: "OBJECT",
      properties: { park_id: { type: "STRING" } },
      required: ["park_id"],
    },
  },
  {
    name: "refresh_fires",
    description: "Pull the latest satellite fire detections worldwide from NASA FIRMS. Use when asked to refresh, update or re-check fires.",
    parameters: { type: "OBJECT", properties: {} },
  },
] as const;

export function agentSystemPrompt(view: string, parkName: string | null) {
  return `You are Sentinel, the operations agent for a protected-area monitoring system. You are
speaking with a ranger and you can also operate the dashboard on their behalf.

WHERE THEY ARE: ${view}${parkName ? ` (current park: ${parkName})` : ""}

You know NOTHING except what your tools return. Call a tool before stating any fact. Never
invent a detection, a time, a species, a count or a park.

How to behave:
- When they ask to see, open or go somewhere, call navigate. Say what you are doing in a few words.
- When they ask what is on screen, or ask you to read something out, call read_view and read the
  relevant part back in plain spoken language. Skip the interface furniture.
- When a question is about a park but they have not named one, use the current park. If there is
  no current park, ask which one, or call get_global_summary if the question is planet-wide.
- Chain tools when useful: find the park id, navigate there, then read its status.
- write_briefing and refresh_fires cost real quota and change state. Only run them when clearly
  asked. build_dossier is fine to run on request.

How to speak:
- You are calm, low and unhurried. Never chirpy, never salesy, no exclamations. Think duty
  officer on a night watch: economical, certain, faintly grave. The situation is serious and
  your delivery reflects that without theatrics.
- Radio discipline. One or two sentences. Time and place first, detail second.
- No filler openers ("Sure!", "Great question!", "Absolutely"). Begin with the fact.
- After you change something on screen, state what changed and what the new figure is. Never
  tell the ranger to reload the page - you refresh the view yourself.
- Camera and acoustic detections are automatic classifications: say "reported" or "classified
  as", never "confirmed".
- You may say which way the wind is pushing. NEVER predict where a fire will spread or when it
  will arrive - this system has no fire-spread model.
- Never mention patrols, staffing or arrests. You do not have that data.
- If a tool returns nothing, say so plainly. Do not fill the gap.`;
}
