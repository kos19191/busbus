/**
 * Прокладывает демо-маршруты по реальным улицам через публичный OSRM
 * и сохраняет геометрию в core/src/data/demo-geo.json.
 *
 * Запуск: node scripts/build-geo.mjs   (нужен интернет; в песочнице нет — запускается в CI)
 */
import { writeFileSync, readFileSync } from 'node:fs';

const src = readFileSync(new URL('../core/src/data/demo-lines.ts', import.meta.url), 'utf8');

const lines = [];
const re = /city:\s*'(\w+)',\s*kind:\s*'(\w+)',\s*number:\s*'([^']+)',[\s\S]*?points:\s*\[([\s\S]*?)\]/g;
let m;
while ((m = re.exec(src))) {
  const [, city, kind, number, rawPoints] = m;
  const points = [...rawPoints.matchAll(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g)].map((p) => [Number(p[1]), Number(p[2])]);
  lines.push({ city, kind, number, points });
}

if (!lines.length) {
  console.error('Не удалось разобрать demo-lines.ts');
  process.exit(1);
}

const out = {};
for (const line of lines) {
  const key = `${line.city}:${line.kind}:${line.number}`;
  const coords = line.points.map(([lat, lon]) => `${lon},${lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'BusBus/1.0 (demo geometry builder)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error('нет геометрии');
    const raw = route.geometry.coordinates;
    const step = Math.max(1, Math.floor(raw.length / 250));
    const pts = [];
    for (let i = 0; i < raw.length; i += step) pts.push([+raw[i][1].toFixed(6), +raw[i][0].toFixed(6)]);
    const last = raw[raw.length - 1];
    pts.push([+last[1].toFixed(6), +last[0].toFixed(6)]);
    out[key] = pts;
    console.log(`${key}: ${pts.length} точек, ${(route.distance / 1000).toFixed(1)} км`);
  } catch (e) {
    console.log(`${key}: не удалось (${e.message}) — останется прямая линия`);
  }
  await new Promise((r) => setTimeout(r, 600));
}

writeFileSync(new URL('../core/src/data/demo-geo.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('Записано:', Object.keys(out).length, 'маршрутов');
