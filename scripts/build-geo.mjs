/**
 * Собирает реальную геометрию демо-маршрутов в core/src/data/demo-geo.json.
 *
 * Новосибирск: порядок остановок и их координаты берём из trasses.php ЦУГАЭТ
 * (это официальный список остановок маршрута), а линию прокладываем по улицам
 * через публичный OSRM — сама ломаная из trasses.php содержит оба направления
 * и нулевые пробеги, поэтому для отрисовки она не годится.
 *
 * Красноярск: OSRM по опорным точкам из demo-lines.ts (источник геометрии
 * не отдаёт вовсе).
 *
 * Запуск: node scripts/build-geo.mjs   (нужен интернет; выполняется в CI)
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
const debug = [];

/** NSK: type у ЦУГАЭТ — это `listmarsh.type + 1` (bus=1, trolley=2, tram=3, minibus=8). */
const NSK_TYPE = { bus: 1, trolley: 2, tram: 3, minibus: 8 };

/** Справочник маршрутов: `<type>:<номер>` → internal marsh id. */
async function nskRouteIds() {
  const res = await fetch('https://map.nskgortrans.ru/listmarsh.php?r', {
    headers: { 'User-Agent': 'BusBus/1.0 (demo geometry builder)' },
  });
  if (!res.ok) throw new Error(`listmarsh: HTTP ${res.status}`);
  const groups = await res.json();
  const map = new Map();
  for (const group of groups) {
    const type = Number(group.type) + 1;
    for (const way of group.ways ?? []) map.set(`${type}:${way.name}`, way.marsh);
  }
  return map;
}

let NSK_IDS = null;

/** Остановки маршрута по порядку (только прямое направление). */
async function nskStops(line) {
  const type = NSK_TYPE[line.kind];
  if (!type) throw new Error('неизвестный тип транспорта');
  if (!NSK_IDS) NSK_IDS = await nskRouteIds();
  const marsh = NSK_IDS.get(`${type}:${line.number}`);
  if (!marsh) throw new Error(`маршрут не найден в справочнике (type ${type})`);
  const id = `${type}-${marsh}-W-${line.number}`;
  const url = `https://map.nskgortrans.ru/trasses.php?r=${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BusBus/1.0 (demo geometry builder)' } });
  if (!res.ok) throw new Error(`trasses: HTTP ${res.status}`);
  const data = await res.json();
  const branches = data.trasses?.[0]?.r ?? [];
  const stops = [];
  for (const branch of branches) {
    for (const p of branch.u ?? []) {
      const lat = Number(p.lat);
      const lon = Number(p.lng);
      if (!p.id || !p.n || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id2 = String(p.id);
      // обратное направление начинается с повторной остановки
      if (stops.some((s) => s.id === id2)) return dedupe(stops);
      stops.push({ id: id2, name: String(p.n).replace(/\s+/g, ' ').trim(), lat, lon });
    }
  }
  return dedupe(stops);
}

function dedupe(stops) {
  const seen = new Set();
  return stops.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** OSRM по опорным точкам [lat, lon] → ломаная по улицам с ~300 точками. */
async function osrm(points, max = 300) {
  if (points.length < 2) throw new Error('мало точек');
  // ограничиваем число waypoints, чтобы не упереться в длину URL
  const step = Math.max(1, Math.ceil((points.length - 2) / 22));
  const way = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const coords = way.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BusBus/1.0 (demo geometry builder)' } });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  const raw = data.routes?.[0]?.geometry?.coordinates;
  if (!raw?.length) throw new Error('нет геометрии');
  const stride = Math.max(1, Math.floor(raw.length / max));
  const pts = [];
  for (let i = 0; i < raw.length; i += stride) pts.push([+raw[i][1].toFixed(6), +raw[i][0].toFixed(6)]);
  const last = raw[raw.length - 1];
  pts.push([+last[1].toFixed(6), +last[0].toFixed(6)]);
  return { points: pts, km: +(data.routes[0].distance / 1000).toFixed(1) };
}

for (const line of lines) {
  const key = `${line.city}:${line.kind}:${line.number}`;
  let anchor = line.points;
  let stops;

  if (line.city === 'nsk') {
    try {
      stops = await nskStops(line);
      if (stops.length > 3) anchor = stops.map((s) => [s.lat, s.lon]);
      debug.push({ route: key, sourceStops: stops?.length ?? 0, first: stops?.[0]?.name, last: stops?.at(-1)?.name });
    } catch (e) {
      debug.push({ route: key, sourceStops: 0, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  try {
    const geo = await osrm(anchor);
    out[key] = geo.points;
    if (stops?.length > 1) {
      out[`${key}:stops`] = stops.map(({ id, name, lat, lon }) => ({ id, name, lat, lon }));
    }
    debug.push({ route: key, km: geo.km, points: geo.points.length, stops: stops?.length ?? 0 });
    console.log(`${key}: ${geo.points.length} точек, ${geo.km} км, остановок ${stops?.length ?? 0}`);
  } catch (e) {
    console.log(`${key}: не удалось (${e.message}) — останется схема из demo-lines.ts`);
    debug.push({ route: key, error: e.message });
  }
  await new Promise((r) => setTimeout(r, 600));
}

writeFileSync(new URL('../core/src/data/demo-geo.json', import.meta.url), JSON.stringify(out, null, 1));
writeFileSync(new URL('../scripts/.geo-debug.json', import.meta.url), JSON.stringify(debug, null, 1));
console.log('Записано:', Object.keys(out).filter((k) => !k.endsWith(':stops')).length, 'маршрутов');
