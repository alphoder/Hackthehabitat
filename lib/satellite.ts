// NASA GIBS true-colour imagery. No API key.
// Native resolution is 250 m/pixel, so this can see burn scars and large clearings but NOT
// individual felled trees or narrow tracks. Claims must stay inside that limit.

import { bboxAround } from "./geo";

const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
export const LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor";
export const RESOLUTION_M = 250;

export function tileUrl(lat: number, lon: number, spanKm: number, date: string, px = 1024) {
  const [minLon, minLat, maxLon, maxLat] = bboxAround({ lat, lon }, spanKm);
  const q = new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0",
    LAYERS: LAYER, CRS: "EPSG:4326",
    BBOX: `${minLat},${minLon},${maxLat},${maxLon}`,
    WIDTH: String(px), HEIGHT: String(px),
    FORMAT: "image/jpeg", TIME: date,
  });
  return `${WMS}?${q}`;
}

export async function fetchTile(lat: number, lon: number, spanKm: number, date: string) {
  const res = await fetch(tileUrl(lat, lon, spanKm, date));
  if (!res.ok) throw new Error(`GIBS ${res.status} for ${date}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 3000) throw new Error(`GIBS returned an near-empty tile for ${date} (${buf.length} bytes)`);
  return { mimeType: "image/jpeg", data: buf.toString("base64"), bytes: buf.length };
}
