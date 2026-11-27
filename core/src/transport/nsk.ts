import { httpGet, withProxy } from './http';
import type { TransitProvider, ProviderOptions } from './provider';
import { kindFromNskType, nskTypeFromKind, parseJsonLoose, normRouteNumber } from './provider';
import { arrivalsFromRasp } from './rasp';
import { decodeCp1251 } from './encoding';
import type { Arrival, Route, Stop, StopBoard, StopBoardEntry, Vehicle } from './types';

/**
 * Живой источник Новосибирска (МКУ «ЦУГАЭТ», map.nskgortrans.ru).
 *
 * Используются те же публичные эндпоинты, что и у официального сайта:
 *  - listmarsh.php?r                  — справочник маршрутов по типам транспорта
 *  - markers.php?r=<type>-<marsh>-<W|A|B>-<name>[|<...>]
 *                                     — координаты машин, скорость, курс,
 *                                       прогнозы по остановкам (rasp)
 *  - m.nskgortrans.ru/index.php?m=..&tt=..&s=..&r=A — табло остановки (WAP)
 *
 * Особенности источника:
 *  - кириллица в WAP-табло приходит в cp1251;
 *  - время в time_nav бывает в трёх форматах: «ГГГГ-ММ-ДД чч:мм:сс»,
 *    «дд.мм.гг чч:мм:сс» и просто «чч:мм:сс» (тогда берём серверную дату);
 *  - статистическая остановка без движения (speed=0, rasp=«Обеденный перерыв»).
 */

const NSK_BASE = 'https://map.nskgortrans.ru';
const NSK_WAP = 'https://m.nskgortrans.ru';

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

  buildQuery(routes: Route[], direction?: string): string {
    return routes
      .map((r) => `${nskTypeFromKind(r.kind)}-${r.sourceId}-${directionCode(direction)}-${r.number}`)
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

  async stops(query?: string): Promise<Stop[]> {
    const url = `${NSK_BASE}/components/com_planrasp/helpers/grasp.php?q=${encodeURIComponent(query ?? '')}&typeview=stops`;
    const res = await httpGet(withProxy(url), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`grasp: HTTP ${res.status}`);
    const raw = parseJsonLoose<unknown>(res.text);
    return parseNskStops(raw);
  }

  async stopBoard(stop: Stop): Promise<StopBoard> {
    // WAP-табло: m=<маршрут>&tt=<тип>&s=<остановка>&r=<направление>&p=1
    if (!stop.sourceId) throw new Error('Нет идентификатора остановки');
    const url = `${NSK_WAP}/index.php?m=0&tt=0&s=${encodeURIComponent(stop.sourceId)}&r=W&p=1`;
    const res = await httpGet(withProxy(url), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`stop board: HTTP ${res.status}`);
    const html = decodeCp1251(res.text);
    return parseNskStopBoard(html, stop);
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

function parseNskStopBoard(html: string, stop: Stop): StopBoard {
  const entries: StopBoardEntry[] = [];
  // WAP-табло: строки вида «13 11:45» и «13 4 мин»
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row: RegExpExecArray | null;
  while ((row = re.exec(html))) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length < 2) continue;
    const timeCell = cells.find((c) => /^\d{1,2}\s*:\s*\d{2}$/.test(c) || /^\d+\s*мин/.test(c));
    const routeCell = cells.find((c) => /^[0-9А-ЯA-Z]{1,4}([КкAa])?$/.test(c));
    if (timeCell && routeCell) {
      const minutes = /мин/.test(timeCell) ? parseInt(timeCell, 10) : undefined;
      entries.push({
        routeNumber: routeCell,
        kind: 'bus',
        minutes: minutes ?? 0,
        time: /:/.test(timeCell) ? timeCell.replace(/\s/g, '') : undefined,
      });
    }
  }
  return { stopId: stop.id, stopName: stop.name, entries, fetchedAt: Date.now() };
}

export { PATH_NAMES };
export type { NskMarker };
export function nskDirectionLabel(dir: string): string {
  return dir === 'A' ? 'Прямое направление' : dir === 'B' ? 'Обратное направление' : 'Все направления';
}

export function nskUpcoming(v: Vehicle): Arrival[] {
  return v.upcoming ?? [];
}
