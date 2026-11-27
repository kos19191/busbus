/** Геометрия: расстояния, проекции, сглаживание треков. */

const R = 6371008.8; // радиус Земли, м

export function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export type LatLon = [number, number];

/** Длина ломаной в метрах */
export function polylineLength(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

export interface PolylineIndex {
  points: LatLon[];
  /** Накопленное расстояние до точки i */
  cum: number[];
  total: number;
}

export function indexPolyline(points: LatLon[]): PolylineIndex {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  return { points, cum, total: cum[cum.length - 1] ?? 0 };
}

export interface Projection {
  /** Расстояние вдоль линии, м */
  along: number;
  /** Отклонение от линии, м */
  off: number;
  /** Точка на линии */
  point: LatLon;
  /** Доля от общей длины 0..1 */
  t: number;
}

/** Проекция точки на ломаную (по ближайшей точке в метрах, локальная плоская аппроксимация). */
export function projectOnPolyline(idx: PolylineIndex, lat: number, lon: number): Projection {
  const { points, cum, total } = idx;
  if (points.length === 0) return { along: 0, off: Infinity, point: [lat, lon], t: 0 };
  if (points.length === 1) {
    return { along: 0, off: haversine(lat, lon, points[0][0], points[0][1]), point: points[0], t: 0 };
  }
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  let best = { d2: Infinity, along: 0, point: points[0] as LatLon };
  for (let i = 1; i < points.length; i++) {
    const [aLat, aLon] = points[i - 1];
    const [bLat, bLon] = points[i];
    const ax = (aLon - lon) * kx;
    const ay = (aLat - lat) * ky;
    const bx = (bLon - lon) * kx;
    const by = (bLat - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d2 = px * px + py * py;
    if (d2 < best.d2) {
      best = {
        d2,
        along: cum[i - 1] + t * (cum[i] - cum[i - 1]),
        point: [aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t],
      };
    }
  }
  return {
    along: best.along,
    off: Math.sqrt(best.d2),
    point: best.point,
    t: total > 0 ? best.along / total : 0,
  };
}

/** Точка на ломаной по расстоянию вдоль неё */
export function pointAt(idx: PolylineIndex, along: number): LatLon {
  const { points, cum, total } = idx;
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const d = Math.max(0, Math.min(total, along));
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 0 ? (d - cum[lo]) / seg : 0;
  return [points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t];
}

/** Направление в точке ломаной по расстоянию вдоль неё */
export function bearingAt(idx: PolylineIndex, along: number): number {
  const p1 = pointAt(idx, along - 25);
  const p2 = pointAt(idx, along + 25);
  return bearing(p1[0], p1[1], p2[0], p2[1]);
}

/** Интерполяция координат по времени для плавного движения маркера */
export function interpolate(
  a: { lat: number; lon: number; at: number },
  b: { lat: number; lon: number; at: number },
  now: number,
): { lat: number; lon: number } {
  const span = Math.max(1, b.at - a.at);
  const t = Math.max(0, Math.min(1, (now - b.at + span) / span));
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

export function formatDistance(m: number): string {
  if (m < 50) return 'на остановке';
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}

export function formatEta(minutes: number): string {
  if (minutes <= 0) return 'сейчас';
  if (minutes === 1) return '1 мин';
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
