import { httpGet, withProxy } from './http';
import type { TransitProvider, ProviderOptions } from './provider';
import { kindFromNskType, nskTypeFromKind, parseJsonLoose, normRouteNumber } from './provider';
import { arrivalsFromRasp } from './rasp';
import type { Arrival, Route, Stop, StopBoard, StopBoardEntry, Vehicle } from './types';

/**
 * Живой источник Новосибирска (МКУ «ЦУГАЭТ», map.nskgortrans.ru).
 *
 * Используются те же публичные эндпоинты, что и у официального сайта:
 *  - listmarsh.php?r                  — справочник маршрутов по типам транспорта
 *  - markers.php?r=<type>-<marsh>-<W|A|B>-<name>[|<...>]
 *                                     — координаты машин, скорость, курс,
 *                                       прогнозы по остановкам (rasp)
 *  - trasses.php?r=<тот же id>        — геометрия линии по улицам и остановки с id
 *  - forecast.php?id=<id остановки>&type=platform — табло остановки (минуты)
 *
 * Особенности источника:
 *  - `type` в id маршрута — это `listmarsh.type + 1` (bus=1, trolley=2, tram=3,
 *    minibus=8): именно такой префикс понимают markers.php и trasses.php;
 *  - время в time_nav бывает в трёх форматах: «ГГГГ-ММ-ДД чч:мм:сс»,
 *    «дд.мм.гг чч:мм:сс» и просто «чч:мм:сс» (тогда берём серверную дату);
 *  - статистическая остановка без движения (speed=0, rasp=«Обеденный перерыв»).
 */

const NSK_BASE = 'https://map.nskgortrans.ru';

interface NskRouteGroup {
  type: number;
  ways: { marsh: string; name: string; stopb: string; stope: string }[];
}

interface NskMarker {
  title: string;
  id_typetr: string;
  marsh: string;
  graph: string;
  direction: string;
  lat: string;
  lng: string;
  time_nav: string;
  azimuth?: string;
  rasp?: string;
  speed?: string;
  ramp?: string;
}

const PATH_NAMES = ['bus', 'trolley', 'tram', 'minibus'];

/**
 * Префикс типа в запросах ЦУГАЭТ: `listmarsh.type + 1`
 * (0→1 автобус, 1→2 троллейбус, 2→3 трамвай, 7→8 маршрутка).
 */
export function sourceTypeOf(route: Route): number {
  const fromSource = route.sourceKind !== undefined ? Number(route.sourceKind) : NaN;
  if (Number.isFinite(fromSource)) return fromSource + 1;
  return nskTypeFromKind(route.kind) + 1;
}

interface NskTracePoint {
  lat: string;
  lng: string;
  /** id остановки (только на точках-остановках) */
  id?: string;
  /** название остановки */
  n?: string;
  len?: string;
}

interface NskForecastRoute {
  id_marsh: string;
  title: string;
  marsh: string;
  typetr: string;
  direction: string;
  markers: { id: string; time: number }[];
  stop_end?: string;
}

interface NskForecastResponse {
  routes: NskForecastRoute[];
}

interface NskTrassesResponse {
  trasses: { r: { pc?: string; marsh: string; u: NskTracePoint[] }[] }[];
}

export interface NskTrace {
  /** Геометрия линии по улицам, [lat, lon] */
  points: [number, number][];
  /** Остановки вдоль линии с id для табло */
  stops: Stop[];
}

function directionCode(dir?: string): string {
  if (dir === 'A' || dir === 'B') return dir;
  return 'W';
}

export class NskProvider implements TransitProvider {
  readonly id = 'nsk-live';
  readonly city = 'nsk' as const;
  readonly mode = 'live' as const;
  readonly label = 'ЦУГАЭТ · онлайн';
  private cache: { at: number; routes: Route[] } | null = null;
  private traceCache = new Map<string, { at: number; trace: NskTrace }>();
  private opts: ProviderOptions;

  constructor(opts: ProviderOptions = {}) {
    this.opts = opts;
  }

  async routes(): Promise<Route[]> {
    if (this.cache && Date.now() - this.cache.at < 6 * 60 * 60 * 1000) return this.cache.routes;
    const res = await httpGet(withProxy(`${NSK_BASE}/listmarsh.php?r`), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`listmarsh: HTTP ${res.status}`);
    const groups = parseJsonLoose<NskRouteGroup[]>(res.text);
    const routes: Route[] = [];
    for (const group of groups) {
      const kind = kindFromNskType(Number(group.type));
      for (const way of group.ways ?? []) {
        const number = way.name || normRouteNumber(way.marsh);
        routes.push({
          id: `${kind}:${way.marsh}`,
          city: 'nsk',
          kind,
          number,
          sourceId: way.marsh,
          sourceKind: String(group.type),
          from: way.stopb,
          to: way.stope,
        });
      }
    }
    // дедуп по id (у источника бывают повторы)
    const seen = new Set<string>();
    const unique = routes.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    this.cache = { at: Date.now(), routes: unique };
    return unique;
  }

  /**
   * Формат идентификатора в запросах ЦУГАЭТ: `<type>-<marsh>-<A|B|W>-<name>`,
   * где type — это `listmarsh.type + 1` (bus=1, trolley=2, tram=3, minibus=8).
   * Именно такой префикс понимают markers.php и trasses.php.
   */
  buildQuery(routes: Route[], direction?: string): string {
    return routes
      .map((r) => `${sourceTypeOf(r)}-${r.sourceId}-${directionCode(direction)}-${r.number}`)
      .join('|');
  }

  async vehiclesFor(routes: Route[], direction?: string): Promise<Vehicle[]> {
    if (!routes.length) return [];
    const q = encodeURIComponent(this.buildQuery(routes, direction));
    const res = await httpGet(withProxy(`${NSK_BASE}/markers.php?r=${q}`), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`markers: HTTP ${res.status}`);
    const data = parseJsonLoose<{ markers: NskMarker[] }>(res.text);
    const now = Date.now();
    const nowMin = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Asia/Novosibirsk', hour: '2-digit', minute: '2-digit' });
    const [hh, mm] = nowMin.split(':').map(Number);
    const nowMinutes = hh * 60 + mm;
    return (data.markers ?? []).map((m) => {
      const kind = kindFromNskType(Number(m.id_typetr) - 1);
      const routeId = `${kind}:${m.marsh}`;
      const status = (m.rasp ?? '').replace(/\+/g, ' ').replace(/\|$/, '').trim();
      const upcoming = arrivalsFromRasp(m.rasp ?? '', nowMinutes).slice(0, 5);
      const isIdle = /обед|перерыв|отстой|не\s*на\s*линии/i.test(status);
      return {
        id: `nsk:${m.id_typetr}:${m.marsh}:${m.graph}`,
        routeId,
        routeNumber: m.title || m.marsh,
        kind,
        lat: Number(m.lat),
        lon: Number(m.lng),
        bearing: m.azimuth !== undefined ? Number(m.azimuth) : undefined,
        speedKmh: m.speed !== undefined ? Number(m.speed) : undefined,
        updatedAt: parseNskTime(m.time_nav, now),
        label: `№ ${m.graph}`,
        status: isIdle ? status : undefined,
        upcoming: upcoming.length ? upcoming : undefined,
        direction: m.direction,
      } satisfies Vehicle;
    });
  }

  async vehicles(route: Route, direction?: string): Promise<Vehicle[]> {
    return this.vehiclesFor([route], direction);
  }

  /** Все машины выбранных маршрутов одним запросом — так делает и официальный сайт. */
  async vehiclesMany(routes: Route[], direction?: string): Promise<Vehicle[]> {
    return this.vehiclesFor(routes, direction);
  }

  /**
   * Остановки города. У ЦУГАЭТ нет отдельного справочника остановок,
   * зато trasses.php отдаёт остановки с id прямо вдоль линии маршрута,
   * поэтому собираем их из трасс выбранных маршрутов (кэш на 30 минут).
   */
  async stops(query?: string): Promise<Stop[]> {
    const routes = (await this.routes()).slice(0, 12);
    const out = new Map<string, Stop>();
    for (const route of routes) {
      try {
        const trace = await this.trace(route);
        for (const stop of trace.stops) out.set(stop.id, stop);
      } catch {
        /* отдельный маршрут мог не отдать трассу */
      }
    }
    const list = [...out.values()];
    const q = (query ?? '').trim().toLowerCase();
    return q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list;
  }

  /** Линия маршрута и остановки из trasses.php (кэш на 30 минут). */
  async trace(route: Route): Promise<NskTrace> {
    const key = route.id;
    const cached = this.traceCache.get(key);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.trace;
    const q = encodeURIComponent(this.buildQuery([route]));
    const res = await httpGet(withProxy(`${NSK_BASE}/trasses.php?r=${q}`), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`trasses: HTTP ${res.status}`);
    const data = parseJsonLoose<NskTrassesResponse>(res.text);
    const trace = parseNskTrace(data, route);
    this.traceCache.set(key, { at: Date.now(), trace });
    return trace;
  }

  /**
   * Табло остановки — официальный `forecast.php?id=<id>&type=platform`.
   * Ответ: `{routes: [{id_marsh, title, marsh, typetr, direction,
   *                    markers: [{id, time}], stop_end}]}`, где `time` — минуты.
   */
  async stopBoard(stop: Stop): Promise<StopBoard> {
    if (!stop.sourceId) throw new Error('Нет идентификатора остановки');
    const url = `${NSK_BASE}/forecast.php?id=${encodeURIComponent(stop.sourceId)}&type=platform`;
    const res = await httpGet(withProxy(url), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`stop board: HTTP ${res.status}`);
    const data = parseJsonLoose<NskForecastResponse>(res.text);
    return parseNskForecast(data, stop);
  }
}

/** Разбор трёх форматов времени Новосибирска. */
export function parseNskTime(raw: string | undefined, fallback: number): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    return toNovosibirskMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return toNovosibirskMs(year, +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0));
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    // время без даты: берём дату из fallback (серверное время)
    const base = new Date(fallback + 7 * 3600_000); // Новосибирск UTC+7
    return Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      +m[1] - 7,
      +m[2],
      +(m[3] ?? 0),
    );
  }
  return undefined;
}

function toNovosibirskMs(y: number, mon: number, d: number, h: number, min: number, sec: number): number {
  return Date.UTC(y, mon - 1, d, h - 7, min, sec);
}

function parseNskStops(raw: unknown): Stop[] {
  const out: Stop[] = [];
  const push = (o: Record<string, unknown>, fallbackName?: string) => {
    const lat = Number(o.lat ?? o.latitude ?? o.Lat);
    const lon = Number(o.lng ?? o.lon ?? o.longitude ?? o.Lng);
    const id = String(o.id ?? o.id_stop ?? o.stop_id ?? o.sid ?? '');
    const name = String(o.name ?? o.title ?? o.stop_name ?? o.stname ?? fallbackName ?? '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return;
    out.push({ id: `nsk:${id || name}`, name, lat, lon, sourceId: id || undefined });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) if (item && typeof item === 'object') push(item as Record<string, unknown>);
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const list = (obj.stops ?? obj.data ?? obj.items ?? obj.result) as unknown;
    if (Array.isArray(list)) {
      for (const item of list) if (item && typeof item === 'object') push(item as Record<string, unknown>);
    } else {
      // иногда приходит {"3": {"name": ..., "lat": ...}}
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object') push(value as Record<string, unknown>, key);
      }
    }
  }
  return out;
}

/**
 * Разбор `forecast.php`: на каждую машину-маршрут приходит свой список
 * прогнозов в минутах. В табло показываем ближайшие прибытия по всем маршрутам.
 */
export function parseNskForecast(data: NskForecastResponse, stop: Stop): StopBoard {
  const entries: StopBoardEntry[] = [];
  for (const route of data.routes ?? []) {
    const kind = kindFromNskType(Number(route.typetr) - 1);
    const title = route.title || normRouteNumber(String(route.marsh));
    for (const marker of route.markers ?? []) {
      const minutes = Number(marker.time);
      if (!Number.isFinite(minutes)) continue;
      entries.push({
        routeNumber: title,
        kind,
        minutes: Math.max(0, Math.round(minutes)),
        label: route.stop_end || undefined,
      });
    }
  }
  entries.sort((a, b) => a.minutes - b.minutes);
  return { stopId: stop.id, stopName: stop.name, entries: entries.slice(0, 30), fetchedAt: Date.now() };
}

export { PATH_NAMES };
export type { NskMarker };
export function nskDirectionLabel(dir: string): string {
  return dir === 'A' ? 'Прямое направление' : dir === 'B' ? 'Обратное направление' : 'Все направления';
}

export function nskUpcoming(v: Vehicle): Arrival[] {
  return v.upcoming ?? [];
}

/**
 * Разбор trasses.php: ответ содержит одно или два ответвления (`r`),
 * в каждом — точки линии; точки с `id`/`n` являются остановками.
 */
export function parseNskTrace(data: NskTrassesResponse, route: Route): NskTrace {
  const points: [number, number][] = [];
  const stops = new Map<string, Stop>();
  const branches = data.trasses?.[0]?.r ?? [];
  for (const branch of branches) {
    for (const p of branch.u ?? []) {
      const lat = Number(p.lat);
      const lon = Number(p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      points.push([lat, lon]);
      const stopId = p.id ? String(p.id) : '';
      const name = (p.n ?? '').trim();
      if (!stopId || !name) continue;
      const key = `${stopId}:${name}`;
      if (stops.has(key)) continue;
      stops.set(key, {
        id: `nsk:${stopId}:${name}`,
        name,
        lat,
        lon,
        sourceId: stopId,
        routes: [route.number],
      });
    }
  }
  return { points, stops: [...stops.values()] };
}
