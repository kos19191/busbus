import type { CityId } from '../transport/types';
import geo from './demo-geo.json';

/**
 * Реальная геометрия по улицам (построена OSRM, см. scripts/build-geo.mjs).
 * Для маршрутов, которых ещё нет в geo, используется упрощённая схема ниже.
 */
const REAL_GEO = geo as unknown as Record<string, [number, number][]>;

/**
 * Упрощённые линии демонстрационных маршрутов (по осям улиц реальных городов).
 * Нужны для демо-режима и для отрисовки линии маршрута в Красноярске,
 * где источник не отдаёт геометрию.
 */

export interface DemoLine {
  city: CityId;
  kind: 'bus' | 'trolley' | 'tram' | 'minibus';
  number: string;
  from: string;
  to: string;
  /** Остановки (название + доля вдоль линии 0..1) */
  stops: { name: string; t: number }[];
  points: [number, number][];
}

export const DEMO_LINES: DemoLine[] = [
  {
    city: 'nsk',
    kind: 'bus',
    number: '13',
    from: 'ЖК «Северная корона»',
    to: 'Ключ-Камышенское плато',
    stops: [
      { name: 'ЖК «Северная корона»', t: 0 },
      { name: 'Торговый центр (Рассветная)', t: 0.12 },
      { name: 'М. «Заельцовская»', t: 0.26 },
      { name: 'Дом Ленина (Красный пр-кт)', t: 0.38 },
      { name: 'М. «Речной вокзал»', t: 0.47 },
      { name: 'ГПНТБ', t: 0.58 },
      { name: 'Поликлиника № 7', t: 0.72 },
      { name: 'Ключ-Камышенское плато', t: 1 },
    ],
    points: [
      [55.1095, 82.9722],
      [55.1048, 82.9499],
      [55.0859, 82.9716],
      [55.0716, 82.9461],
      [55.0589, 82.9134],
      [55.0347, 82.9189],
      [55.0161, 82.924],
      [55.0083, 82.9361],
      [54.999, 82.9573],
      [54.9887, 82.9836],
      [54.9887, 83.0427],
    ],
  },
  {
    city: 'nsk',
    kind: 'bus',
    number: '8',
    from: 'Вокзал «Новосибирск-Главный»',
    to: 'Биатлонный комплекс',
    stops: [
      { name: 'Вокзал «Новосибирск-Главный»', t: 0 },
      { name: 'Пл. им. Калинина', t: 0.2 },
      { name: 'М. «Заельцовская»', t: 0.42 },
      { name: 'ПКиО «Заельцовский»', t: 0.75 },
      { name: 'Биатлонный комплекс', t: 1 },
    ],
    points: [
      [55.0359, 82.8966],
      [55.045, 82.9109],
      [55.058, 82.925],
      [55.075, 82.945],
      [55.092, 82.964],
      [55.112, 82.982],
    ],
  },
  {
    city: 'nsk',
    kind: 'trolley',
    number: '8',
    from: 'Затулинский ж/м',
    to: 'Ключ-Камышенское плато',
    stops: [
      { name: 'Затулинский ж/м', t: 0 },
      { name: 'Пл. им. Кирова', t: 0.22 },
      { name: 'М. «Площадь Маркса»', t: 0.42 },
      { name: 'М. «Спортивная»', t: 0.58 },
      { name: 'Аллея Блокадников', t: 0.72 },
      { name: 'Ул. Воскова', t: 0.86 },
      { name: 'Ключ-Камышенское плато', t: 1 },
    ],
    points: [
      [54.9339, 82.9263],
      [54.951, 82.9012],
      [54.9694, 82.8989],
      [54.9829, 82.8886],
      [54.9979, 82.9125],
      [55.0094, 82.962],
      [55.0028, 83.0206],
      [54.9888, 83.0388],
    ],
  },
  {
    city: 'nsk',
    kind: 'tram',
    number: '13',
    from: 'Гусинобродское шоссе',
    to: 'Ул. Писарева',
    stops: [
      { name: 'Гусинобродское шоссе', t: 0 },
      { name: 'Ул. Лазурная', t: 0.3 },
      { name: 'М. «Площадь Маркса»', t: 0.62 },
      { name: 'Ул. Писарева', t: 1 },
    ],
    points: [
      [55.046, 83.02],
      [55.03, 82.99],
      [55.012, 82.95],
      [54.995, 82.93],
      [54.98, 82.91],
    ],
  },
  {
    city: 'krsk',
    kind: 'bus',
    number: '85',
    from: 'Аграрный университет',
    to: 'мкрн. Верхние Черемушки',
    stops: [
      { name: 'Аграрный университет', t: 0 },
      { name: '5-й мкрн. (Ветлужанка)', t: 0.06 },
      { name: 'Универмаг «Ветлужанка»', t: 0.12 },
      { name: 'Михайловский сквер', t: 0.2 },
      { name: 'Кинотеатр «Строитель»', t: 0.28 },
      { name: 'Спорткомплекс «Рассвет»', t: 0.36 },
      { name: 'Торговый квартал', t: 0.44 },
      { name: 'Копыловский мост', t: 0.52 },
      { name: 'площадь Революции', t: 0.62 },
      { name: 'Медицинский университет', t: 0.7 },
      { name: 'Центральный рынок', t: 0.78 },
      { name: 'о. Татышев', t: 0.86 },
      { name: 'Верхние Черёмушки', t: 1 },
    ],
    points: [
      [56.006, 92.772],
      [56.006, 92.79],
      [56.01, 92.82],
      [56.016, 92.86],
      [56.021, 92.892],
      [56.013, 92.92],
      [56.008, 92.945],
      [56.002, 92.97],
      [55.99, 92.99],
      [55.978, 93.01],
      [55.965, 93.02],
    ],
  },
  {
    city: 'krsk',
    kind: 'tram',
    number: '6тр',
    from: 'Железнодорожный вокзал',
    to: 'п. Энергетики',
    stops: [
      { name: 'Железнодорожный вокзал', t: 0 },
      { name: 'пл. Революции', t: 0.25 },
      { name: 'КрасТЭЦ', t: 0.55 },
      { name: 'Шинный завод', t: 0.78 },
      { name: 'п. Энергетики', t: 1 },
    ],
    points: [
      [56.014, 92.884],
      [56.011, 92.9],
      [56.02, 92.93],
      [56.035, 92.96],
      [56.045, 93.0],
    ],
  },
];

export function demoLinesFor(city: CityId): DemoLine[] {
  return DEMO_LINES.filter((l) => l.city === city).map(withRealGeo);
}

/** Подставить геометрию по улицам, если она есть. */
export function withRealGeo(line: DemoLine): DemoLine {
  const key = `${line.city}:${line.kind}:${line.number}`;
  const points = REAL_GEO[key];
  return points && points.length > 1 ? { ...line, points } : line;
}

export function realGeoFor(city: CityId, number: string, kind?: string): [number, number][] | undefined {
  if (kind) {
    const exact = REAL_GEO[`${city}:${kind}:${number}`];
    if (exact) return exact;
  }
  const hit = Object.entries(REAL_GEO).find(([k]) => k.startsWith(`${city}:`) && k.endsWith(`:${number}`));
  return hit?.[1];
}

export function demoLineFor(city: CityId, number: string, kind?: string): DemoLine | undefined {
  const lines = demoLinesFor(city);
  const direct = realGeoFor(city, number, kind);
  if (!direct) {
    const base = lines.find((l) => l.number === number && (!kind || l.kind === kind)) ?? lines.find((l) => l.number === number);
    return base;
  }
  const template = lines.find((l) => l.number === number && (!kind || l.kind === kind)) ?? lines.find((l) => l.number === number);
  if (!template) return undefined;
  return { ...template, points: direct };
}

/** Экспорт линий для отрисовки в Красноярске: линия по номеру маршрута */
export function lineForCityRoute(city: CityId, number: string): [number, number][] {
  const line = demoLineFor(city, number);
  return line ? line.points : [];
}
