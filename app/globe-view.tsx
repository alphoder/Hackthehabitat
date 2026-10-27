"use client";

import { useEffect, useRef } from "react";

type Point = [number, number, number]; // lat, lon, frp
type TopPark = { id: string; name: string; country: string; lat: number; lon: number; detections: number; max_frp: number };

// Animated rings are the expensive part of this scene: each one re-tessellates every frame.
// Ninety of them is smooth; a thousand is not. Cap it and rank by radiative power so the cap
// always keeps the most significant fires.
const MAX_RINGS = 90;

export default function GlobeView({ cells, hot, top }: { cells: Point[]; hot: Point[]; top: TopPark[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const Globe = (await import("globe.gl")).default;
      if (disposed || !ref.current) return;

      const rings = [...hot].sort((a, b) => b[2] - a[2]).slice(0, MAX_RINGS);

      const g = new Globe(ref.current)
        .globeImageUrl("//unpkg.com/three-globe/example/img/earth-dark.jpg")
        .backgroundColor("rgba(0,0,0,0)")
        .atmosphereColor("#3b82f6")
        .atmosphereAltitude(0.18)
        // every fire on Earth, merged into a single geometry so it costs one draw call
        .pointsData(cells.map((c) => ({ lat: c[0], lng: c[1] })))
        .pointLat("lat").pointLng("lng")
        .pointColor(() => "rgba(251,146,60,0.4)")
        .pointAltitude(0.004)
        .pointRadius(0.14)
        .pointsMerge(true)
        // fires inside protected areas
        .ringsData(rings.map((c) => ({ lat: c[0], lng: c[1] })))
        .ringLat("lat").ringLng("lng")
        .ringColor(() => (t: number) => `rgba(239,68,68,${1 - t})`)
        .ringMaxRadius(2.2)
        .ringPropagationSpeed(1.4)
        .ringRepeatPeriod(1400)
        .labelsData(top.map((p) => ({ ...p, lng: p.lon })))
        .labelLat("lat").labelLng("lng")
        .labelText((d: object) => (d as TopPark).name)
        .labelSize(0.9)
        .labelDotRadius(0.5)
        .labelColor(() => "#fca5a5")
        .labelResolution(2)
        .onLabelClick((d: object) => { window.location.href = `/park/${(d as TopPark).id}`; });

      // Cap the pixel ratio: a retina display would otherwise render 4x the pixels for a
      // scene whose detail does not benefit from it.
      const renderer = g.renderer();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

      const controls = g.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
      controls.enableDamping = true;

      const focus = top[0];
      g.pointOfView({ lat: focus?.lat ?? 10, lng: focus?.lon ?? 20, altitude: 2.4 }, 0);

      const resize = () => {
        if (!ref.current) return;
        g.width(ref.current.clientWidth);
        g.height(ref.current.clientHeight);
      };
      resize();
      window.addEventListener("resize", resize);

      // Stop spinning (and re-rendering) when the tab is hidden or the globe is scrolled away.
      const onVisibility = () => { controls.autoRotate = !document.hidden; };
      document.addEventListener("visibilitychange", onVisibility);

      cleanup = () => {
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibility);
        controls.autoRotate = false;
        renderer.dispose();
      };
    })();

    return () => { disposed = true; cleanup?.(); };
  }, [cells, hot, top]);

  return <div ref={ref} className="h-full w-full" />;
}
