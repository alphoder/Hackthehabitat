# DESIGN.md - Sentinel

## Theme

Dark, single mode, locked. Rangers use this at night and judges see it in dim rooms. There is no
light mode and no toggle; a half-built second theme would be worse than one committed theme.

## Color

Tinted near-black neutrals with one accent. Red and amber are reserved for real severity, never
decoration.

| Token | Value | Role |
|---|---|---|
| `--background` | `#07090d` | page ground |
| `--panel` | `#0d1117` | raised surface |
| `--panel-border` | `#1c2431` | hairline separators |
| `--foreground` | `#e4e4e7` | body text |
| accent | `emerald-500/600` | the single brand accent, all interactive affordances |
| alert | `red-400` | fire and severity-5 data only |
| caution | `amber-400` | replayed-feed labels, severity 4, false-alarm figures |

Strategy: **restrained**. The accent carries under 10% of surface. Colour in this product is
almost entirely semantic: if something is red, something is burning.

## Typography

IBM Plex Sans for prose, IBM Plex Mono (`.readout`) for every number, code, timestamp and label.
The pairing is a deliberate contrast axis (humanist sans against a mono), not two similar sans
faces. All numeric readouts use `font-variant-numeric: tabular-nums` so values do not jitter as
they update.

## Layout

App shell is a full-height flex column: header, then a map/canvas region beside a scrolling right
rail of panels. Panels are separated by hairlines rather than nested cards; cards appear only
where elevation carries meaning (incident cases, the agent dock).

## Motion

Minimal and motivated. A pulse on live indicators, a rail that draws itself through the four-step
flow on the landing page, and tactile `active` states. No decorative reveal animations: content a
ranger needs must never be gated behind an animation that might not fire.

## Components

`readout` (mono numeric class), panel section, event feed row, severity dot, agent dock,
refresh button with staleness, incident card, evidence dossier (light, print-targeted; the one
deliberate exception to the dark theme, because it is a document meant for paper).
