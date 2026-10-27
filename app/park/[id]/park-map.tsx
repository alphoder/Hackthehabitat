"use client";

import { useEffect, useRef } from "react";
import type { FireNear, Zone } from "@/lib/park";

type Sensor = { id: string; kind: string; name: string; lat: number; lon: number };

export default function ParkMap({
  center, radiusKm, polygon, zones, fires, sensors, wind,
}: {
  center: [number, number];
  radiusKm: number;
  polygon: { coordinates: number[][][] } | null;
  zones: Zone[];
  fires: FireNear[];
  sensors: Sensor[];
  wind: { wind_deg: number; wind_kmh: number; wind_to: string } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: { remove: () => void } | null = null;
    let cleanup: (() => void) | null = null;
    let disposed = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !ref.current || ref.current.dataset.ready) return;
      ref.current.dataset.ready = "1";

      const m = L.map(ref.current, { zoomControl: false }).setView(center, 10);
      map = m as unknown as typeof map;
      L.control.zoom({ position: "bottomright" }).addTo(m);

      // Satellite imagery reads better than street tiles for wilderness
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 17,
        attribution: "Esri World Imagery",
      }).addTo(m);

      const toLatLng = (ring: number[][]) => ring.map(([lon, lat]) => [lat, lon] as [number, number]);

      let fit: (() => void) | null = null;
      if (polygon?.coordinates?.[0]) {
        const boundary = L.polygon(toLatLng(polygon.coordinates[0]), {
          color: "#34d399", weight: 2, fill: false, dashArray: "6 4",
        }).addTo(m);
        fit = () => m.fitBounds(boundary.getBounds(), { padding: [40, 40] });
      } else {
        const circle = L.circle(center, { radius: radiusKm * 1000, color: "#34d399", weight: 2, fill: false, dashArray: "6 4" }).addTo(m);
        fit = () => m.fitBounds(circle.getBounds(), { padding: [40, 40] });
      }

      // Leaflet measures the container on init; in a flex layout that happens before
      // the pane has its final size, so re-measure then frame the boundary.
      const ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(ref.current);
      requestAnimationFrame(() => { m.invalidateSize(); fit?.(); });
      cleanup = () => ro.disconnect();

      for (const z of zones) {
        L.polygon(toLatLng(z.ring), { color: "#38bdf8", weight: 1, fillColor: "#38bdf8", fillOpacity: 0.1 })
          .bindTooltip(z.name, { sticky: true })
          .addTo(m);
      }

      for (const f of fires) {
        const r = Math.max(6, Math.min(20, 6 + Math.sqrt(f.frp) * 1.6));
        L.circleMarker([f.lat, f.lon], {
          radius: r / 2,
          color: f.inside ? "#ef4444" : "#f59e0b",
          fillColor: f.inside ? "#ef4444" : "#f59e0b",
          fillOpacity: 0.55, weight: 1.5,
        })
          .bindPopup(
            `<div style="font:12px/1.5 ui-monospace,monospace">
               <b>${f.inside ? "Fire inside boundary" : "Fire near boundary"}</b><br/>
               ${f.acq_date} ${f.acq_time.slice(0, 2)}:${f.acq_time.slice(2)} UTC · ${f.daynight === "N" ? "night" : "day"}<br/>
               ${f.frp} MW radiative power<br/>
               ${f.nearest_zone ? `${f.nearest_zone.km} km from ${f.nearest_zone.name}` : `${f.km_from_center} km from centre`}
             </div>`
          )
          .addTo(m);
      }

      for (const s of sensors) {
        const isCam = s.kind === "camera";
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className: "",
            html: `<div style="width:16px;height:16px;border-radius:3px;border:1.5px solid ${isCam ? "#a78bfa" : "#22d3ee"};background:rgba(9,12,18,.85);display:grid;place-items:center;font:9px ui-monospace,monospace;color:${isCam ? "#a78bfa" : "#22d3ee"}">${isCam ? "C" : "A"}</div>`,
            iconSize: [16, 16], iconAnchor: [8, 8],
          }),
        }).bindTooltip(s.name, { direction: "top" }).addTo(m);
      }

      if (wind) {
        // wind_deg is the direction wind comes FROM; the arrow shows where it is pushing
        const WindControl = L.Control.extend({
          onAdd() {
            const d = L.DomUtil.create("div");
            d.style.cssText = "background:rgba(9,12,18,.85);border:1px solid #1c2431;border-radius:6px;padding:8px 10px;font:11px ui-monospace,monospace;color:#d4d4d8;text-align:center";
            d.innerHTML = `<div style="font-size:20px;line-height:1;transform:rotate(${wind.wind_deg + 180}deg)">↑</div>
              <div style="margin-top:4px">pushing ${wind.wind_to} · ${wind.wind_kmh} km/h</div>`;
            return d;
          },
        });
        new WindControl({ position: "topright" }).addTo(m);
      }
    })();

    return () => { disposed = true; cleanup?.(); map?.remove(); };
  }, [center, radiusKm, polygon, zones, fires, sensors, wind]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={ref} className="h-full w-full bg-[#0b0e14]" />
    </>
  );
}
