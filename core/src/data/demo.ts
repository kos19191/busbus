import { indexPolyline, pointAt, bearingAt, haversine } from '../transport/geo';
import { hhmmToMinutes } from '../transport/provider';
import type { TransitProvider } from '../transport/provider';
import type { Arrival, CityId, Route, Stop, StopBoard, StopBoardEntry, TransportKind, Vehicle } from '../transport/types';
import { CITIES } from '../transport/types';
import { demoLinesFor, type DemoLine } from './demo-lines';

/**
 * Демонстрационный источник: полностью автономен, без сети.
 * Машины двигаются по реалистичным линиям маршрутов с остановками и прогнозами.
 * Это позволяет показать интерфейс и проверить логику, даже если официальный
 * источник недоступен (ночь, блокировка, сбой).
 */

interface SimVehicle {
  id: string;
  line: DemoLine;
  route: Route;
  /** Позиция вдоль линии, м */
  along: number;
  speedMps: number;
  dir: 1 | -1;
  /** Остановка, у которой стоим (для выдержки) */
  dwellUntil?: number;
  label: string;
  kind: TransportKind;
}

const STOP_DWELL_MS = 12000;

function lineRoute(line: DemoLine): Route {
  return {
    id: `${line.kind}:${line.number}`,
    city: line.city,
    kind: line.kind,
    number: line.number,
    sourceId: line.number,
    from: line.from,
    to: line.to,
  };
}

export class DemoProvider implements TransitProvider {
  readonly id: string;
  readonly city: CityId;
  readonly mode = 'demo' as const;
  readonly label = 'демо-режим';
  private lines: DemoLine[];
  private sim: SimVehicle[] = [];
  private lastTick = Date.now();
  private idx = new Map<string, ReturnType<typeof indexPolyline>>();

  constructor(city: CityId, private seed = 1) {
    this.city = city;
    this.id = `${city}-demo`;
    this.lines = demoLinesFor(city);
    this.reset();
  }

  reset(): void {
    this.idx.clear();
    this.sim = [];
    let n = 0;
    for (const line of this.lines) {
      const count = line.kind === 'tram' ? 3 : 4;
      for (let i = 0; i < count; i++) {
        n++;
        this.sim.push({
          id: `${this.city}-demo-${n}`,
          line,
          route: lineRoute(line),
          along: 0,
          speedMps: 0,
          dir: i % 2 === 0 ? 1 : -1,
          label: `№ ${100 + n}`,
          kind: line.kind,
        });
      }
    }
    this.idx.clear();
    for (const line of this.lines) this.index(line);
    // равномерно расставить машины по линии
    const perLine = new Map<string, SimVehicle[]>();
    for (const v of this.sim) {
      const key = v.line.number + v.line.kind;
      perLine.set(key, [...(perLine.get(key) ?? []), v]);
    }
    for (const [, list] of perLine) {
      const line = list[0].line;
      const idx = this.index(line);
      list.forEach((v, i) => {
        const frac = (i + 0.5) / list.length;
        v.along = idx.total * (v.dir === 1 ? frac : 1 - frac);
        v.speedMps = 7 + (i % 3);
        v.dwellUntil = undefined;
      });
    }
    this.lastTick = Date.now();
  }

  private index(line: DemoLine) {
    const key = `${line.kind}:${line.number}`;
    let idx = this.idx.get(key);
    if (!idx) {
      idx = indexPolyline(line.points);
      this.idx.set(key, idx);
    }
    return idx;
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(5, (now - this.lastTick) / 1000);
    this.lastTick = now;
    for (const v of this.sim) {
      if (v.dwellUntil && now < v.dwellUntil) continue;
      v.dwellUntil = undefined;
      const idx = this.index(v.line);
      v.along += v.speedMps * dt * v.dir;
      // разворот на конечных
      if (v.along >= idx.total) {
        v.along = idx.total;
        v.dir = -1;
        v.dwellUntil = now + STOP_DWELL_MS;
      } else if (v.along <= 0) {
        v.along = 0;
        v.dir = 1;
        v.dwellUntil = now + STOP_DWELL_MS;
      }
      // выдержка на остановках
      for (const stop of v.line.stops) {
        const stopAlong = stop.t * idx.total;
        if (Math.abs(stopAlong - v.along) < 25 && !v.dwellUntil) {
          v.dwellUntil = now + STOP_DWELL_MS * 0.7;
          v.along = stopAlong;
        }
      }
    }
  }

  async routes(): Promise<Route[]> {
    return this.lines.map(lineRoute);
  }

  async vehicles(route: Route): Promise<Vehicle[]> {
    this.tick();
    const line = this.lines.find((l) => l.number === route.number && l.kind === route.kind) ?? this.lines[0];
    if (!line) return [];
    const idx = this.index(line);
    const nowMin = this.cityMinutes();
    return this.sim
      .filter((v) => v.line === line)
      .map((v) => {
        const point = pointAt(idx, v.along);
        const brg = bearingAt(idx, v.along) + (v.dir === -1 ? 180 : 0);
        const upcoming = this.upcoming(line, idx.total, v.along, v.dir, nowMin).slice(0, 4);
        return {
          id: v.id,
          routeId: route.id,
          routeNumber: line.number,
          kind: line.kind,
          lat: point[0],
          lon: point[1],
          bearing: (brg + 360) % 360,
          speedKmh: Math.round(v.speedMps * 3.6),
          updatedAt: Date.now(),
          label: v.label,
          status: v.dwellUntil && v.dwellUntil > Date.now() ? 'посадка' : undefined,
          upcoming,
          direction: v.dir === 1 ? 'A' : 'B',
        } satisfies Vehicle;
      });
  }

  private upcoming(line: DemoLine, total: number, along: number, dir: 1 | -1, nowMin: number): Arrival[] {
    const out: Arrival[] = [];
    for (const stop of line.stops) {
      const stopAlong = stop.t * total;
      const delta = dir === 1 ? stopAlong - along : along - stopAlong;
      if (delta > 40) {
        // delta — это метры вдоль линии (indexPolyline считает в метрах)
        const meters = delta;
        const minutes = Math.max(1, Math.round(meters / 1000 / 0.35)); // ~21 км/ч с остановками
        const target = nowMin + minutes;
        out.push({
          stop: stop.name,
          meters: Math.round(meters),
          minutes,
          time: `${String(Math.floor(target / 60) % 24).padStart(2, '0')}:${String(target % 60).padStart(2, '0')}`,
        });
      }
      if (out.length >= 5) break;
    }
    return out;
  }

  async stops(query?: string): Promise<Stop[]> {
    const seen = new Map<string, Stop>();
    for (const line of this.lines) {
      for (const stop of line.stops) {
        if (query && !stop.name.toLowerCase().includes(query.toLowerCase())) continue;
        const key = stop.name;
        if (!seen.has(key)) {
          const idx = this.index(line);
          const p = pointAt(idx, stop.t * idx.total);
          seen.set(key, { id: `${this.city}:demo:${key}`, name: stop.name, lat: p[0], lon: p[1] });
        }
      }
    }
    return [...seen.values()];
  }

  async stopBoard(stop: Stop): Promise<StopBoard> {
    this.tick();
    const entries: StopBoardEntry[] = [];
    const nowMin = this.cityMinutes();
    const body = stop.name.toLowerCase();
    for (const line of this.lines) {
      const lineStop = line.stops.find((s) => s.name.toLowerCase() === body);
      if (!lineStop) continue;
      const idx = this.index(line);
      const stopAlong = lineStop.t * idx.total;
      for (const v of this.sim.filter((x) => x.line === line)) {
        let delta = v.dir === 1 ? stopAlong - v.along : v.along - stopAlong;
        // остановка уже позади — машина вернётся на неё после разворота на конечной:
        // путь до конца линии + путь от начала линии до остановки на обратном ходе
        if (delta < 0) delta = idx.total - v.along + (idx.total - stopAlong);
        if (delta < 0) continue;
        const minutes = Math.max(0, Math.round(delta / 1000 / 0.35));
        const target = nowMin + minutes;
        entries.push({
          routeNumber: line.number,
          kind: line.kind,
          minutes,
          time: `${String(Math.floor(target / 60) % 24).padStart(2, '0')}:${String(target % 60).padStart(2, '0')}`,
        });
      }
    }
    if (!entries.length) {
      // на этой остановке ещё нет машин в демо-симуляции — покажем маршруты линии,
      // чтобы экран не выглядел «пустым» и было понятно, что тут ходит
      for (const line of this.lines) {
        if (line.stops.some((s2) => s2.name.toLowerCase() === body)) {
          entries.push({ routeNumber: line.number, kind: line.kind, minutes: 0, label: 'по расписанию' } as StopBoardEntry);
        }
      }
    }
    entries.sort((a, b) => a.minutes - b.minutes);
    return { stopId: stop.id, stopName: stop.name, entries: entries.slice(0, 12), fetchedAt: Date.now() };
  }

  private cityMinutes(): number {
    const cfg = CITIES[this.city];
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
    const local = new Date(utc + cfg.utcOffsetMinutes * 60_000);
    return local.getHours() * 60 + local.getMinutes();
  }
}

/** Расстояние между машиной и остановкой — используется в UI */
export function distanceTo(v: Vehicle, lat: number, lon: number): number {
  return haversine(v.lat, v.lon, lat, lon);
}

export { hhmmToMinutes };
