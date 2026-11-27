/**
 * Собирает реальную геометрию демо-маршрутов и сохраняет её в
 * core/src/data/demo-geo.json.
 *
 * Источники:
 *  1. Новосибирск — официальный trasses.php ЦУГАЭТ: настоящая линия по улицам
 *     и остановки с id (без внешних сервисов).
 *  2. Остальные города — публичный OSRM по опорным точкам из demo-lines.ts.
 *
 * Запуск: node scripts/build-geo.mjs   (нужен интернет; запускается в CI)
 */
import { writeFileSync, readFileSync } from 'node:fs';

const src = readFileSync(new URL('../core/src/data/demo-lines.ts', import.meta.url), 'utf8');

const lines = [];
// режем файл по объектам маршрутов, чтобы «жадный» regex не склеивал соседние
const chunks = src.split(/\n  \{\n    city:/).slice(1);
for (const chunk of chunks) {
  const body = 'city:' + chunk;
  const city = /city:\s*'(\w+)'/.exec(body)?.[1];
  const kind = /kind:\s*'(\w+)'/.exec(body)?.[1];
  const number = /number:\s*'([^']+)'/.exec(body)?.[1];
  const pointsBlock = /points:\s*\[([\s\S]*?)\n    \]/.exec(body)?.[1] ?? '';
  const points = [...pointsBlock.matchAll(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/g)].map((p) => [Number(p[1]), Number(p[2])]);
  if (city && kind && number && points.length) lines.push({ city, kind, number, points });
}

if (!lines.length) {
  console.error('Не удалось разобрать demo-lines.ts');
  process.exit(1);
}

const out = {};

/**
 * NSK: id маршрута у ЦУГАЭТ — `<type+1>-<marsh>-W-<name>`.
 * type 0 — автобус, 1 — троллейбус, 2 — трамвай; в trasses.php нумерация с 1.
 */
const NSK_TYPE = { bus: 1, trolley: 2, tram: 3, minibus: 8 };

async function fromNskTrasses(line) {
  const type = NSK_TYPE[line.kind];
  if (!type) return null;
  const id = `${type}-${line.number}-W-${line.number}`;
  const url = `https://map.nskgortrans.ru/trasses.php?r=${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BusBus/1.0 (demo geometry builder)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const branches = data.trasses?.[0]?.r ?? [];
  const points = [];
  const stops = [];
  for (const branch of branches) {
    for (const p of branch.u ?? []) {
      const lat = Number(p.lat);
      const lon = Number(p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push([+lat.toFixed(6), +lon.toFixed(6)]);
      if (p.id && p.n)
        stops.push({ id: String(p.id), name: String(p.n).replace(/\s+/g, ' ').trim(), lat, lon });
    }
  }
  if (points.length < 2) throw new Error('нет точек');

  // trasses.php отдаёт оба направления одной ломаной («туда → обратно»).
  // Режем на самом дальнем от начала отрезке, чтобы линия не рисовала петлю.
  const cut = farthestTurn(points);
  const forward = points.slice(0, cut + 1);
  // прореживаем геометрию до ~300 точек, остановки сохраняем все
  const step = Math.max(1, Math.floor(forward.length / 300));
  const thinned = forward.filter((_, i) => i % step === 0);
  const last = forward[forward.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);

  // оставляем только остановки первого направления (по близости к линии)
  const near = stops.filter((st) => distToLine(forward, st) < 120);
  return { points: thinned, stops: near };
}

/** Индекс самой дальней от начала точки — там заканчивается первое направление. */
function farthestTurn(points) {
  const [lat0, lon0] = points[0];
  let best = 0;
  let bestD = -1;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - lat0, points[i][1] - lon0);
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best > 5 ? best : points.length - 1;
}

/** Минимальное расстояние от остановки до линии, метры. */
function distToLine(line, stop) {
  const kx = Math.cos((stop.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [aLat, aLon] = line[i - 1];
    const [bLat, bLon] = line[i];
    const ax = (aLon - stop.lon) * kx;
    const ay = (aLat - stop.lat) * ky;
    const bx = (bLon - stop.lon) * kx;
    const by = (bLat - stop.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + dx * t;
    const py = ay + dy * t;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

for (const line of lines) {
  const key = `${line.city}:${line.kind}:${line.number}`;
  if (line.city === 'nsk') {
    try {
      const trace = await fromNskTrasses(line);
      out[key] = trace.points;
      out[`${key}:stops`] = trace.stops;
      console.log(`${key}: ${trace.points.length} точек, ${trace.stops.length} остановок (trasses.php)`);
    } catch (e) {
      console.log(`${key}: trasses не ответил (${e.message}) — пробуем OSRM`);
    }
    await new Promise((r) => setTimeout(r, 300));
    if (out[key]) continue;
  }
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
