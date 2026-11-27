import { httpGet } from './http';
import type { TransitProvider, ProviderOptions } from './provider';
import type { CityId, Route, Stop, StopBoard, Vehicle } from './types';
import type { Arrival } from './types';

/**
 * Живые данные через опубликованный снапшот.
 *
 * Официальные порталы не отдают CORS-заголовки, поэтому браузер не может
 * обращаться к ним напрямую (в APK это решает нативный мост). GitHub Actions
 * каждые 10 минут складывает свежий срез в ветку `ci/live`, а raw.githubusercontent
 * отдаёт JSON с `access-control-allow-origin: *` — его читает веб-версия.
 *
 * Снапшот обновляется раз в 10 минут, поэтому позиции машин интерполируются
 * вдоль линии маршрута между двумя соседними снимками, чтобы карта «жила».
 */
export interface SnapshotVehicle {
  id: string;
  routeId: string;
  routeNumber: string;
  kind: Vehicle['kind'];
  lat: number;
  lon: number;
  bearing?: number;
  speedKmh?: number;
  updatedAt?: number;
  label?: string;
  status?: string;
  upcoming?: Arrival[];
  direction?: string;
}

export interface SnapshotCity {
  city: CityId;
  at: number;
  source: string;
  routes: Route[];
  vehicles: SnapshotVehicle[];
  stops: Stop[];
  boards: Record<string, StopBoard>;
}

export interface Snapshot {
  at: number;
  cities: Partial<Record<CityId, SnapshotCity>>;
}

/** URL снапшота: можно переопределить (свой хостинг или локальная разработка). */
export function snapshotUrl(city?: CityId): string {
  const custom = (globalThis as unknown as { BUSBUS_SNAPSHOT_URL?: string }).BUSBUS_SNAPSHOT_URL;
  if (custom) return city ? custom.replace('{city}', city) : custom;
  const base = 'https://raw.githubusercontent.com/kos19191/busbus/ci/live/data/live';
  return city ? `${base}/${city}.json` : `${base}/snapshot.json`;
}

const cache = new Map<string, { at: number; data: Snapshot }>();
const inflight = new Map<string, Promise<Snapshot>>();

export async function loadSnapshot(city?: CityId, force = false): Promise<Snapshot> {
  const key = city ?? 'all';
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 8 * 60_000) return hit.data;
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const res = await httpGet(snapshotUrl(city), { timeoutMs: 20000 });
    if (res.status !== 200) throw new Error(`снапшот: HTTP ${res.status}`);
    const data = JSON.parse(res.text) as Snapshot;
    cache.set(key, { at: Date.now(), data });
    return data;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

export class SnapshotProvider implements TransitProvider {
  readonly id: string;
  readonly mode = 'live' as const;
  readonly label = 'Онлайн · обновляется каждые 10 минут';
  private opts: ProviderOptions;
  private data: SnapshotCity | null = null;

  constructor(readonly city: CityId, opts: ProviderOptions = {}) {
    this.id = `${city}-snapshot`;
    this.opts = opts;
  }

  private async cityData(): Promise<SnapshotCity> {
    const snapshot = await loadSnapshot(this.city);
    const data = snapshot.cities[this.city];
    if (!data) throw new Error('снапшот города пуст — повторим позже');
    this.data = data;
    return data;
  }

  async routes(): Promise<Route[]> {
    return (await this.cityData()).routes;
  }

  /** Все машины города одним запросом — для обзорного слоя карты. */
  async allVehicles(): Promise<Vehicle[]> {
    const data = await this.cityData();
    const ageSec = Math.max(0, Math.min(600, (Date.now() - data.at) / 1000));
    return data.vehicles.map((v) => this.advance(v, ageSec));
  }

  async vehicles(route: Route): Promise<Vehicle[]> {
    const data = await this.cityData();
    const own = data.vehicles.filter((v) => v.routeId === route.id);
    if (!own.length) return [];
    // «оживляем» позиции: сдвигаем вдоль линии на прошедшее с момента снимка время
    const ageSec = Math.max(0, Math.min(600, (Date.now() - data.at) / 1000));
    return own.map((v) => this.advance(v, ageSec));
  }

  /** Смещение машины вдоль линии маршрута на `ageSec` секунд при её скорости. */
  private advance(vehicle: SnapshotVehicle, ageSec: number): Vehicle {
    const speed = vehicle.speedKmh ?? 18;
    if (speed < 3 || !this.data) return vehicle;
    const line = this.lineFor(vehicle.routeId);
    if (!line) return vehicle;
    const idx = indexOf(line);
    const from = project(idx, vehicle.lat, vehicle.lon);
    const ahead = Math.min(idx.total, from + (speed * 1000 * ageSec) / 3600);
    const at = pointAtDistance(idx, ahead);
    return { ...vehicle, lat: at[0], lon: at[1] };
  }

  private lineFor(routeId: string): [number, number][] | undefined {
    const line = this.lines.get(routeId);
    return line?.length && line.length > 1 ? line : undefined;
  }

  /** Линии маршрутов подставляются снаружи (демо-геометрия = реальные улицы). */
  private lines = new Map<string, [number, number][]>();

  setLine(routeId: string, points: [number, number][]): void {
    this.lines.set(routeId, points);
  }

  async stops(query?: string): Promise<Stop[]> {
    const data = await this.cityData();
    const q = (query ?? '').trim().toLowerCase();
    return q ? data.stops.filter((s) => s.name.toLowerCase().includes(q)) : data.stops;
  }

  async stopBoard(stop: Stop): Promise<StopBoard> {
    const data = await this.cityData();
    const board = data.boards[stop.id];
    if (board) return board;
    return { stopId: stop.id, stopName: stop.name, entries: [], fetchedAt: data.at };
  }
}

/* ---------- вспомогательная геометрия вдоль ломаной ---------- */

interface LineIndex {
  points: [number, number][];
  cum: number[];
  total: number;
}

function indexOf(points: [number, number][]): LineIndex {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + meters(points[i - 1], points[i]));
  }
  return { points, cum, total: cum[cum.length - 1] ?? 0 };
}

function meters(a: [number, number], b: [number, number]): number {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dy = (b[0] - a[0]) * 110540;
  const dx = (b[1] - a[1]) * 111320 * Math.cos(lat);
  return Math.hypot(dx, dy);
}

function project(idx: LineIndex, lat: number, lon: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < idx.points.length; i++) {
    const d = meters(idx.points[i], [lat, lon]);
    if (d < bestD) {
      bestD = d;
      best = idx.cum[i];
    }
  }
  return best;
}

function pointAtDistance(idx: LineIndex, along: number): [number, number] {
  const { points, cum } = idx;
  if (along <= 0) return points[0];
  if (along >= idx.total) return points[points.length - 1];
  let i = 1;
  while (i < cum.length && cum[i] < along) i++;
  const a = points[i - 1];
  const b = points[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (along - cum[i - 1]) / seg;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
