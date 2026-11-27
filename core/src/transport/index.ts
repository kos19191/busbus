import type { CityId, DataMode } from './types';
import type { TransitProvider } from './provider';
import { NskProvider } from './nsk';
import { KrskProvider } from './krsk';
import { DemoProvider } from '../data/demo';

export * from './types';
export * from './provider';
export * from './geo';
export { httpGet, setHttpImpl, setProxy, getProxy, withProxy, DEFAULT_PROXY } from './http';
export type { HttpImpl, HttpRequest, HttpResponse, ProxyConfig } from './http';
export { NskProvider, parseNskTime } from './nsk';
export { KrskProvider, krkAllRoutes, parseKrskPayload, krkKindOf } from './krsk';
export type { KrskParsedRoute, KrskParsedVehicle } from './krsk';
export { DemoProvider } from '../data/demo';
export { DEMO_LINES, demoLinesFor, demoLineFor } from '../data/demo-lines';
export type { DemoLine } from '../data/demo-lines';

export const PROVIDER_LABEL: Record<DataMode, string> = {
  live: 'живые данные',
  demo: 'демо',
};

const demos = new Map<string, DemoProvider>();

/** Фабрика провайдеров: живой источник либо демо-симуляция для выбранного города. */
export function createProvider(city: CityId, mode: DataMode): TransitProvider {
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

export function resetDemo(city?: CityId): void {
  if (city) {
    demos.get(city)?.reset();
    return;
  }
  demos.forEach((d) => d.reset());
}
