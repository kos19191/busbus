import { httpGet, withProxy } from './http';
import type { ProviderOptions, TransitProvider } from './provider';
import { hhmmToMinutes, minutesUntil, parseJsonLoose } from './provider';
import type { Arrival, Route, Stop, StopBoard, StopBoardEntry, TransportKind, Vehicle } from './types';

/**
 * Живой источник Красноярска (МКУ «Красноярскгортранс», mu-kgt.ru).
 *
 * Публичный JSON мобильной версии:
 *   /informing/wap/marsh/?m=<маршрут>&action=getMarshData
 *
 * Ответ содержит:
 *  - directions.A/B — названия конечных и длины;
 *  - ts_line.A/B   — упорядоченный список остановок с прогнозом (st_arrive)
 *                    и вперемешку записи о машинах (ts_numb, модель, «менее N метров»);
 *  - ts_endstop    — машины, стоящие на конечной;
 *  - forecast      — серверное время.
 *
 * Особенности:
 *  - координат машин источник НЕ отдаёт (только позицию «в очереди» между остановками);
 *    поэтому машины показываются на линии маршрута в точке ближайшей остановки;
 *  - номер маршрута кодируется с суффиксом типа: «1т» (троллейбус), «1тр» (трамвай),
 *    «1э» (электробус), автобус — без суффикса.
 */

const KRK_BASE = 'https://mu-kgt.ru';

interface KrkDirection {
  first?: string;
  last?: string;
  length?: number;
}

interface KrkStopRow {
  obj: 'stop';
  st_regnum?: number;
  st_title?: string;
  st_arrive?: string;
  dgt?: number;
}

interface KrkTsRow {
  obj: 'ts';
  ts_id?: number;
  ts_numb?: string;
  ts_model?: string;
  ts_coment?: string;
  ts_img?: string;
  dgt?: number;
}

type KrkRow = (KrkStopRow | KrkTsRow) & Record<string, unknown>;

interface KrkPayload {
  ts_type_id?: number;
  ts_type_title?: string;
  marsh_title?: string;
  forecast?: string;
  directions?: Record<string, KrkDirection>;
  ts_line?: Record<string, KrkRow[]>;
  ts_endstop?: Record<string, KrkRow[]>;
}

interface KrkRouteRef {
  number: string;
  kind: TransportKind;
  query: string;
  title?: string;
}

const KIND_BY_SUFFIX: [RegExp, TransportKind][] = [
  [/т$/, 'trolley'],
  [/тр$/, 'tram'],
  [/э$/, 'electro'],
];

export function krkKindOf(number: string): TransportKind {
  const s = number.trim().toLowerCase();
  if (s.endsWith('тр')) return 'tram';
  if (s.endsWith('т')) return 'trolley';
  if (s.endsWith('э')) return 'electro';
  return 'bus';
}

export function krkQueryOf(number: string, kind: TransportKind): string {
  const base = number.trim().replace(/(тр|т|э)$/i, '');
  switch (kind) {
    case 'trolley':
      return `${base}т`;
    case 'tram':
      return `${base}тр`;
    case 'electro':
      return `${base}э`;
    default:
      return base;
  }
}

/** Справочник маршрутов Красноярска. Собран из публичной WAP-версии портала. */
export const KRK_ROUTES: { number: string; kind: TransportKind; title?: string }[] = [
  // Автобусы
  ...[
    '2','3','5','6','7','8','9','10','11','12','14','18','19','21','22','23','26','27','30','31','33','36','37','38','39','43','49','50','52','55','56','58','59','60','61','63','64','65','66','67','69','70','71','73','77','78','80','81','83','85','87','88','90','92','94','95','98','99',
  ].map((n) => ({ number: n, kind: 'bus' as TransportKind })),
  // Троллейбусы
  ...['4т','5т','6т','13т','15т'].map((n) => ({ number: n, kind: 'trolley' as TransportKind })),
  // Трамваи
  ...['2тр','4тр','5тр','6тр','7тр'].map((n) => ({ number: n, kind: 'tram' as TransportKind })),
  // Электробусы
  ...['1э'].map((n) => ({ number: n, kind: 'electro' as TransportKind })),
];

export function krkAllRoutes(): Route[] {
  return KRK_ROUTES.map((r) => ({
    id: `${r.kind}:${r.number}`,
    city: 'krsk',
    kind: r.kind,
    number: r.number,
    sourceId: krkQueryOf(r.number, r.kind),
    from: undefined,
    to: undefined,
  }));
}

export interface KrskParsedRoute {
  route: KrkRouteRef;
  directions: Record<string, { first?: string; last?: string; lengthM?: number }>;
  /** Упорядоченные остановки по направлениям с прогнозами */
  stops: Record<string, { name: string; regnum?: number; eta?: Arrival }[]>;
  /** Позиции машин: направление, индекс остановки и «менее N метров» */
  vehicles: KrskParsedVehicle[];
  forecast?: string;
}

export interface KrskParsedVehicle {
  id: string;
  number: string;
  model?: string;
  direction: string;
  /** Индекс остановки в списке направления, у которой находится машина */
  stopIndex: number;
  /** «менее 370 метров» */
  distanceText?: string;
  /** Расстояние в метрах, если удалось разобрать */
  meters?: number;
  atEndstop?: boolean;
}

export function parseKrskPayload(raw: KrkPayload, query: string, kind: TransportKind): KrskParsedRoute {
  const route: KrkRouteRef = { number: raw.marsh_title ?? query, kind, query };
  const directions: KrskParsedRoute['directions'] = {};
  for (const [dir, info] of Object.entries(raw.directions ?? {})) {
    directions[dir] = { first: info.first, last: info.last, lengthM: info.length };
  }
  const forecastMinutes = hhmmToMinutes(raw.forecast ?? '');
  const stops: KrskParsedRoute['stops'] = {};
  const vehicles: KrskParsedVehicle[] = [];
  for (const [dir, rows] of Object.entries(raw.ts_line ?? {})) {
    const list: { name: string; regnum?: number; eta?: Arrival }[] = [];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row.obj === 'stop') {
        const name = String(row.st_title ?? '').trim();
        if (!name) continue;
        const time = String(row.st_arrive ?? '').trim();
        const target = /^\d{1,2}:\d{2}$/.test(time) ? hhmmToMinutes(time) : undefined;
        list.push({
          name,
          regnum: row.st_regnum,
          eta:
            target !== undefined && forecastMinutes !== undefined
              ? { stop: name, time, minutes: Math.max(0, minutesUntil(forecastMinutes, target)) }
              : undefined,
        });
      } else if (row.obj === 'ts') {
        const comment = String(row.ts_coment ?? '');
        const meters = parseMeters(comment);
        vehicles.push({
          id: `krsk:${row.ts_id ?? row.ts_numb ?? Math.random().toString(36).slice(2)}`,
          number: String(row.ts_numb ?? '').trim(),
          model: String(row.ts_model ?? '').trim() || undefined,
          direction: dir,
          stopIndex: Math.max(0, list.length - 1),
          distanceText: comment || undefined,
          meters,
        });
      }
    }
    stops[dir] = list;
  }
  for (const [dir, rows] of Object.entries(raw.ts_endstop ?? {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row.obj !== 'ts') continue;
      vehicles.push({
        id: `krsk:end:${row.ts_id ?? row.ts_numb ?? Math.random().toString(36).slice(2)}`,
        number: String(row.ts_numb ?? '').trim(),
        model: String(row.ts_model ?? '').trim() || undefined,
        direction: dir,
        stopIndex: 0,
        atEndstop: true,
      });
    }
  }
  return { route, directions, stops, vehicles, forecast: raw.forecast };
}

function parseMeters(comment: string): number | undefined {
  const m = /менее\s+(\d+)\s+метр/i.exec(comment);
  if (m) return Number(m[1]);
  return undefined;
}

export class KrskProvider implements TransitProvider {
  readonly id = 'krsk-live';
  readonly city = 'krsk' as const;
  readonly mode = 'live' as const;
  readonly label = 'Красноярскгортранс · онлайн';
  private opts: ProviderOptions;

  constructor(opts: ProviderOptions = {}) {
    this.opts = opts;
  }

  async routes(): Promise<Route[]> {
    return krkAllRoutes();
  }

  async fetchRaw(route: Route): Promise<KrskParsedRoute> {
    const query = route.sourceId || krkQueryOf(route.number, route.kind);
    const url = `${KRK_BASE}/informing/wap/marsh/?m=${encodeURIComponent(query)}&action=getMarshData`;
    const res = await httpGet(withProxy(url), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`getMarshData: HTTP ${res.status}`);
    const raw = parseJsonLoose<KrkPayload>(res.text);
    return parseKrskPayload(raw, query, route.kind);
  }

  /**
   * Координат машины нет — строим позицию «в очереди» по линии маршрута:
   * ставим машину в точку остановки, перед которой она едет (или на которой стоит).
   * Если линия маршрута неизвестна, отдаём пустой список — UI покажет табло.
   */
  async vehicles(route: Route, _direction?: string): Promise<Vehicle[]> {
    const parsed = await this.fetchRaw(route);
    return this.vehiclesFromParsed(parsed, route, []);
  }

  vehiclesFromParsed(parsed: KrskParsedRoute, route: Route, line: [number, number][]): Vehicle[] {
    const out: Vehicle[] = [];
    for (const v of parsed.vehicles) {
      const list = parsed.stops[v.direction] ?? [];
      const stopIdx = Math.min(Math.max(0, v.stopIndex), Math.max(0, list.length - 1));
      const point = line.length && list.length ? lineAtStopShare(line, stopIdx + 0.5, list.length) : undefined;
      if (!point) continue;
      out.push({
        id: v.id,
        routeId: route.id,
        routeNumber: route.number,
        kind: route.kind,
        lat: point[0],
        lon: point[1],
        approx: true,
        label: [v.number, v.model].filter(Boolean).join(' · '),
        status: v.distanceText ?? (v.atEndstop ? 'на конечной' : undefined),
        direction: v.direction,
        upcoming: list
          .slice(stopIdx, stopIdx + 4)
          .map((s) => s.eta ?? { stop: s.name })
          .filter((a): a is Arrival => !!a && !!a.stop),
        speedKmh: undefined,
      });
    }
    return out;
  }

  async stopBoard(stop: Stop): Promise<StopBoard> {
    const url = `${KRK_BASE}/informing/wap/online/?st_id=${encodeURIComponent(stop.sourceId ?? stop.id)}`;
    const res = await httpGet(withProxy(url), { timeoutMs: this.opts.timeoutMs });
    if (res.status !== 200) throw new Error(`stop board: HTTP ${res.status}`);
    return parseKrkStopBoard(res.text, stop);
  }

  async stops(): Promise<Stop[]> {
    return [];
  }
}

/** Точка на линии для k-й остановки из total (доля вдоль линии) */
export function lineAtStopShare(line: [number, number][], index: number, total: number): [number, number] | undefined {
  if (!line.length) return undefined;
  const t = total > 1 ? Math.min(1, Math.max(0, index / (total - 1))) : 0;
  const pos = t * (line.length - 1);
  const i = Math.floor(pos);
  const frac = pos - i;
  const a = line[i];
  const b = line[Math.min(line.length - 1, i + 1)];
  if (!a || !b) return a;
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}

function parseKrkStopBoard(html: string, stop: Stop): StopBoard {
  const entries: StopBoardEntry[] = [];
  const text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ');
  const re = /(\d{1,3})\s*(?:мин|минуты?|ч)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const route = /(\d{1,3}[а-яА-Я]?)/.exec(text.slice(Math.max(0, m.index - 40), m.index));
    if (!route) continue;
    entries.push({ routeNumber: route[1], kind: 'bus', minutes: parseInt(m[1], 10) });
    if (entries.length > 30) break;
  }
  return { stopId: stop.id, stopName: stop.name, entries, fetchedAt: Date.now() };
}
