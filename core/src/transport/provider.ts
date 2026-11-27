import type { Arrival, CityId, DataMode, Route, Stop, StopBoard, TransportKind, Vehicle } from './types';

/**
 * Интерфейс источника данных. Реализации: NskLive, KrskLive, DemoProvider.
 * Все методы возвращают уже нормализованные модели — UI ничего не знает о специфике источника.
 */
export interface TransitProvider {
  /** Идентификатор: nsk-live, krsk-live, nsk-demo… */
  readonly id: string;
  readonly city: CityId;
  readonly mode: DataMode;

  /** Список маршрутов города (кэшируется вызывающей стороной) */
  routes(): Promise<Route[]>;

  /** Положение машин на маршруте (± направление в источнике) */
  vehicles(route: Route, direction?: string): Promise<Vehicle[]>;

  /** Прогноз прибытия на остановку (если провайдер умеет) */
  stopBoard?(stop: Stop): Promise<StopBoard>;

  /** Остановки города/маршрута, если источник их отдаёт */
  stops?(query?: string): Promise<Stop[]>;

  /** Линия маршрута по улицам (геометрия + остановки), если источник умеет */
  trace?(route: Route): Promise<{ points: [number, number][]; stops: Stop[] }>;

  /** Человекопонятная подпись источника для UI */
  readonly label: string;
}

export interface ProviderOptions {
  /** Лимит времени на запрос, мс */
  timeoutMs?: number;
}

export type ProviderFactory = (city: CityId, mode: DataMode) => TransitProvider;

/** Утилита: разбор «чч:мм» в минуты от полуночи */
export function hhmmToMinutes(s: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Утилита: минуты до времени «чч:мм» относительно «сейчас» (в минутах от полуночи) */
export function minutesUntil(nowMinutes: number, target: number): number {
  let d = target - nowMinutes;
  while (d < -12 * 60) d += 24 * 60;
  while (d > 12 * 60) d -= 24 * 60;
  return d;
}

export function kindFromNskType(type: number): TransportKind {
  switch (type) {
    case 1:
      return 'trolley';
    case 2:
      return 'tram';
    case 7:
      return 'minibus';
    case 0:
    default:
      return 'bus';
  }
}

export function nskTypeFromKind(kind: TransportKind): number {
  switch (kind) {
    case 'trolley':
      return 1;
    case 'tram':
      return 2;
    case 'minibus':
      return 7;
    case 'bus':
    default:
      return 0;
  }
}

export function normRouteNumber(s: string): string {
  return s.trim().replace(/^0+(?=\d)/, '').toUpperCase();
}

export function sortRoutes(routes: Route[]): Route[] {
  const order: TransportKind[] = ['tram', 'trolley', 'bus', 'minibus', 'electro'];
  return [...routes].sort((a, b) => {
    const ka = order.indexOf(a.kind);
    const kb = order.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    const na = parseInt(a.number.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.number.replace(/\D/g, ''), 10) || 0;
    if (na !== nb) return na - nb;
    return a.number.localeCompare(b.number, 'ru');
  });
}

/** Безопасный JSON-парсинг ответов, которые иногда приходят с BOM/мусором */
export function parseJsonLoose<T>(text: string): T {
  let s = text.replace(/^\uFEFF/, '').trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const endObj = s.lastIndexOf('}');
  const endArr = s.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (end >= 0) s = s.slice(0, end + 1);
  return JSON.parse(s) as T;
}

export function nowMinutesIn(utcOffsetMinutes: number, date = new Date()): number {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const local = new Date(utc + utcOffsetMinutes * 60_000);
  return local.getHours() * 60 + local.getMinutes();
}

export function arrivalsFromRasp(rasp: string, nowMinutes: number): Arrival[] {
  if (!rasp) return [];
  return rasp
    .split('|')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [time, ...rest] = chunk.split('+');
      const stop = rest.join('+').replace(/_/g, ' ').trim();
      const target = hhmmToMinutes(time);
      const minutes = target === undefined ? undefined : Math.max(0, minutesUntil(nowMinutes, target));
      return { stop, time, minutes } as Arrival;
    })
    .filter((a) => !!a.stop);
}
