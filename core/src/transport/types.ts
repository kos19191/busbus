/** Общие модели данных BusBus. Ничего платформенного — только типы. */

export type CityId = 'nsk' | 'krsk';

export type TransportKind = 'bus' | 'trolley' | 'tram' | 'minibus' | 'electro';

export const TRANSPORT_KINDS: TransportKind[] = ['bus', 'trolley', 'tram', 'minibus', 'electro'];

export const KIND_LABEL: Record<TransportKind, string> = {
  bus: 'Автобус',
  trolley: 'Троллейбус',
  tram: 'Трамвай',
  minibus: 'Маршрутка',
  electro: 'Электробус',
};

export const KIND_LABEL_PLURAL: Record<TransportKind, string> = {
  bus: 'Автобусы',
  trolley: 'Троллейбусы',
  tram: 'Трамваи',
  minibus: 'Маршрутки',
  electro: 'Электробусы',
};

export const KIND_COLOR: Record<TransportKind, string> = {
  bus: '#ff7a1a',
  trolley: '#3b82f6',
  tram: '#e11d48',
  minibus: '#8b5cf6',
  electro: '#059669',
};

export const KIND_EMOJI: Record<TransportKind, string> = {
  bus: '🚌',
  trolley: '🚎',
  tram: '🚋',
  minibus: '🚐',
  electro: '⚡',
};

export interface CityConfig {
  id: CityId;
  /** Отображаемое название */
  title: string;
  /** Центр города [lat, lon] */
  center: [number, number];
  zoom: number;
  /** Часовой сдвиг в минутах (для парсинга времени источника) */
  utcOffsetMinutes: number;
  /** Краткое описание источника данных */
  sourceNote: string;
  /** Ссылка на официальный сайт */
  sourceUrl: string;
  /** Есть ли у источника реальные ETA по остановкам */
  hasStopEta: boolean;
  /** Есть ли координаты машин */
  hasCoords: boolean;
}

export const CITIES: Record<CityId, CityConfig> = {
  nsk: {
    id: 'nsk',
    title: 'Новосибирск',
    center: [55.0084, 82.9357],
    zoom: 12,
    utcOffsetMinutes: 420,
    sourceNote: 'ЦУГАЭТ / map.nskgortrans.ru',
    sourceUrl: 'https://map.nskgortrans.ru/',
    hasStopEta: true,
    hasCoords: true,
  },
  krsk: {
    id: 'krsk',
    title: 'Красноярск',
    center: [56.0153, 92.8932],
    zoom: 12,
    utcOffsetMinutes: 420,
    sourceNote: 'Красноярскгортранс / mu-kgt.ru',
    sourceUrl: 'https://mu-kgt.ru/informing/wap/marsh/',
    hasStopEta: true,
    hasCoords: false,
  },
};

export type DataMode = 'live' | 'demo';

export interface Route {
  /** Стабильный ключ внутри города, например `bus:13` */
  id: string;
  city: CityId;
  kind: TransportKind;
  /** Номер маршрута для показа: «13», «45К», «1т» */
  number: string;
  /** Идентификатор маршрута в источнике (для запросов) */
  sourceId: string;
  /** Дополнительный идентификатор у источника (тип/направление) */
  sourceKind?: string;
  /** Начальная остановка */
  from?: string;
  /** Конечная остановка */
  to?: string;
}

export interface Vehicle {
  /** Уникальный в рамках города id */
  id: string;
  routeId: string;
  routeNumber: string;
  kind: TransportKind;
  lat: number;
  lon: number;
  /** Направление движения в градусах, 0 = север */
  bearing?: number;
  speedKmh?: number;
  /** Серверное время последнего обновления координаты, мс epoch */
  updatedAt?: number;
  /** Бортовой/государственный номер, если известен */
  label?: string;
  /** Текст состояния: «Обеденный перерыв», «Отстой»… */
  status?: string;
  /** Ближайшие остановки с прогнозом (если известны) */
  upcoming?: Arrival[];
  /** Направление («A» / «B» или подпись) */
  direction?: string;
  /** Насколько позиция приблизительна (0..1), для отрисовки «нечёткого» маркера */
  approx?: boolean;
}

export interface Arrival {
  /** Название остановки */
  stop: string;
  /** Идентификатор остановки в источнике (если есть) */
  stopId?: string;
  /** Время прибытия в минутах от «сейчас» (может быть 0..N) */
  minutes?: number;
  /** Текст времени в формате источника («11:45») */
  time?: string;
  /** Расстояние до остановки, метры */
  meters?: number;
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routes?: string[];
  /** Идентификатор в источнике (для табло) */
  sourceId?: string;
}

export interface StopBoardEntry {
  routeNumber: string;
  kind: TransportKind;
  minutes: number;
  /** Время «чч:мм» */
  time?: string;
  label?: string;
}

export interface StopBoard {
  stopId: string;
  stopName: string;
  entries: StopBoardEntry[];
  fetchedAt: number;
}

export interface CitySnapshot {
  city: CityId;
  mode: DataMode;
  fetchedAt: number;
  vehicles: Vehicle[];
  /** Источник сообщил, но данных нет (например, ночь) */
  empty?: boolean;
  message?: string;
}
