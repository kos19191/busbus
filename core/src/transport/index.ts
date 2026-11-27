import type { CityId, DataMode } from './types';
import type { TransitProvider } from './provider';
import { NskProvider } from './nsk';
import { KrskProvider } from './krsk';
import { DemoProvider } from '../data/demo';
import { SnapshotProvider } from './snapshot';
import { isNativeHttp } from './http';
import { demoLinesFor } from '../data/demo-lines';

export * from './types';
export * from './provider';
export * from './geo';
export {
  httpGet,
  httpGetDirect,
  setHttpImpl,
  setProxy,
  getProxy,
  withProxy,
  DEFAULT_PROXY,
  PUBLIC_PROXIES,
  installAndroidBridge,
} from './http';
export type { HttpImpl, HttpRequest, HttpResponse, ProxyConfig } from './http';
export { NskProvider, parseNskTime, parseNskTrace, parseNskForecast } from './nsk';
export { KrskProvider, krkAllRoutes, parseKrskPayload, krkKindOf } from './krsk';
export type { KrskParsedRoute, KrskParsedVehicle } from './krsk';
export { DemoProvider } from '../data/demo';
export { SnapshotProvider, loadSnapshot, snapshotUrl } from './snapshot';
export type { Snapshot, SnapshotCity } from './snapshot';
export { DEMO_LINES, demoLinesFor, demoLineFor } from '../data/demo-lines';
export type { DemoLine } from '../data/demo-lines';

export const PROVIDER_LABEL: Record<DataMode, string> = {
  live: 'живые данные',
  demo: 'демо',
};

const demos = new Map<string, DemoProvider>();

/** Фабрика провайдеров: живой источник либо демо-симуляция для выбранного города. */
export function createProvider(city: CityId, mode: DataMode): TransitProvider {
  if (mode === 'live' && !isNativeHttp() && typeof fetch === 'function') {
    // В браузере источники недоступны напрямую (нет CORS) — читаем снапшот CI.
    const snapshot = new SnapshotProvider(city);
    for (const line of demoLinesFor(city)) snapshot.setLine(`${line.kind}:${line.number}`, line.points);
    return snapshot;
  }
  if (mode === 'demo') {
    const key = `${city}`;
    let p = demos.get(key);
    if (!p) {
      p = new DemoProvider(city);
      demos.set(key, p);
    }
    return p;
  }
  return city === 'nsk' ? new NskProvider() : new KrskProvider();
}

/** Прямой живой источник (без снапшота) — для фонового собирателя данных в CI. */
export function createLiveProvider(city: CityId): TransitProvider {
  return city === 'nsk' ? new NskProvider() : new KrskProvider();
}

export function resetDemo(city?: CityId): void {
  if (city) {
    demos.get(city)?.reset();
    return;
  }
  demos.forEach((d) => d.reset());
}
